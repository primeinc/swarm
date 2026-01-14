/**
 * Embeddings Provider - Pluggable embedding generation with fallback
 *
 * Implements a provider chain: Ollama (primary) → Xenova (local fallback)
 * Uses Effect-TS for dependency injection and error handling.
 *
 * ## Architecture
 * - **Ollama**: Fast, high-quality embeddings via local server (1024-dim)
 * - **Xenova**: Always-available local inference (384-dim via all-MiniLM-L6-v2)
 * - **Fallback**: Automatic retry when primary provider fails
 * - **Caching**: Singleton model loading to avoid repeated initialization
 *
 * ## Usage
 * ```typescript
 * import { EmbeddingsProvider, makeEmbeddingsProviderLive } from './embeddings-provider';
 * import { Effect } from 'effect';
 *
 * const config = {
 *   ollamaHost: 'http://localhost:11434',
 *   ollamaModel: 'mxbai-embed-large',
 *   preferLocal: false,  // Try Ollama first
 * };
 *
 * const program = Effect.gen(function* () {
 *   const provider = yield* EmbeddingsProvider;
 *   const embedding = yield* provider.embed('hello world');
 *   // Returns: { embedding, source: 'ollama' | 'xenova', dimension: 1024 | 384 }
 *   return embedding;
 * });
 *
 * const layer = makeEmbeddingsProviderLive(config);
 * const result = await Effect.runPromise(program.pipe(Effect.provide(layer)));
 * ```
 *
 * ## Embedding Dimensions
 * - **Ollama**: 1024-dim (mxbai-embed-large) - high quality, slower
 * - **Xenova**: 384-dim (all-MiniLM-L6-v2) - fast, sufficient for most use cases
 *
 * The system handles mixed dimensions transparently in vector search.
 */

import { Context, Effect, Layer, Schema } from "effect";
import type { MemoryConfig } from "./ollama.js";

// ============================================================================
// Types & Errors
// ============================================================================

/**
 * Embedding with metadata about its source and dimension
 */
export interface EmbeddingWithMetadata {
  /** The embedding vector */
  readonly embedding: number[];
  /** Source provider: 'ollama' or 'xenova' */
  readonly source: "ollama" | "xenova";
  /** Embedding dimension: 1024 for Ollama, 384 for Xenova */
  readonly dimension: number;
}

/**
 * Xenova provider configuration (extends MemoryConfig)
 */
export interface XenovaConfig extends MemoryConfig {
  /** Prefer Xenova (local) over Ollama. Default: false (try Ollama first) */
  readonly preferLocal?: boolean;
  /** Xenova model to use. Default: 'Xenova/all-MiniLM-L6-v2' */
  readonly xenovaModel?: string;
}

/**
 * Embedding provider failure
 */
export class EmbeddingsProviderError extends Schema.TaggedError<EmbeddingsProviderError>()(
  "EmbeddingsProviderError",
  { reason: Schema.String }
) {}

// ============================================================================
// Service Definition
// ============================================================================

/**
 * Pluggable embeddings provider with fallback support
 */
export class EmbeddingsProvider extends Context.Tag("swarm-mail/EmbeddingsProvider")<
  EmbeddingsProvider,
  {
    /** Generate embedding for a single text */
    readonly embed: (text: string) => Effect.Effect<EmbeddingWithMetadata, EmbeddingsProviderError>;
    /** Generate embeddings for multiple texts with controlled concurrency */
    readonly embedBatch: (
      texts: string[],
      concurrency?: number
    ) => Effect.Effect<EmbeddingWithMetadata[], EmbeddingsProviderError>;
  }
>() {}

// ============================================================================
// Xenova Implementation (Local Fallback)
// ============================================================================

/**
 * Xenova embeddings provider - runs locally without external server
 * Uses transformers.js for in-process inference
 * 
 * Model: Xenova/all-MiniLM-L6-v2 (384-dim, ~80MB)
 * Speed: ~50-100ms per text on CPU
 * Quality: Excellent for semantic search and clustering
 */
class XenovaEmbeddingsProvider {
  private extractor: any = null;
  private modelName: string;

  constructor(modelName: string = "Xenova/all-MiniLM-L6-v2") {
    this.modelName = modelName;
  }

  /**
   * Initialize the Xenova pipeline (lazy loading)
   * Done on first use to avoid overhead if provider isn't needed
   */
  private async initialize(): Promise<void> {
    if (this.extractor !== null) return;

    try {
      // Lazy import transformers.js only when needed
      const { pipeline } = await import("@huggingface/transformers");

      this.extractor = await pipeline(
        "feature-extraction",
        this.modelName,
        {
          device: "cpu", // Explicitly use CPU for consistency
        }
      );
    } catch (error) {
      throw new Error(
        `Failed to initialize Xenova: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Generate embedding using Xenova
   */
  async embed(text: string): Promise<number[]> {
    await this.initialize();

    const result = await this.extractor(text, {
      pooling: "mean", // Mean pooling for sentence embeddings
      normalize: true, // L2 normalization for cosine similarity
    });

    // Convert Tensor to array
    const embedding = result.tolist()[0];
    return embedding as number[];
  }

  /**
   * Generate embeddings for multiple texts
   */
  async embedBatch(texts: string[], concurrency: number = 1): Promise<number[][]> {
    await this.initialize();

    if (concurrency === 1) {
      // Sequential processing
      const embeddings: number[][] = [];
      for (const text of texts) {
        const embedding = await this.embed(text);
        embeddings.push(embedding);
      }
      return embeddings;
    }

    // Concurrent processing with limit
    const results: number[][] = [];
    const queue = [...texts];
    const active = new Set<Promise<void>>();

    return new Promise((resolve, reject) => {
      const processNext = async () => {
        if (queue.length === 0 && active.size === 0) {
          resolve(results);
          return;
        }

        if (queue.length > 0 && active.size < concurrency) {
          const text = queue.shift()!;
          const promise = this.embed(text)
            .then((embedding) => {
              results.push(embedding);
              active.delete(promise);
              processNext();
            })
            .catch((error) => {
              active.delete(promise);
              reject(error);
            });

          active.add(promise);
          processNext();
        }
      };

      processNext();
    });
  }
}

// ============================================================================
// Provider Factory with Fallback
// ============================================================================

/**
 * Create embeddings provider layer with fallback support
 *
 * Strategy:
 * 1. If preferLocal is true: use Xenova only
 * 2. If preferLocal is false: try Ollama first, fallback to Xenova on failure
 *
 * @param config - Configuration (ollamaHost, ollamaModel, preferLocal)
 * @returns Layer providing EmbeddingsProvider
 */
export const makeEmbeddingsProviderLive = (config: XenovaConfig) => {
  const xenova = new XenovaEmbeddingsProvider(config.xenovaModel);

  return Layer.succeed(
    EmbeddingsProvider,
    {
      embed: async (text: string): Promise<EmbeddingWithMetadata> => {
        if (config.preferLocal) {
          // Use Xenova directly
          const embedding = await xenova.embed(text);
          return {
            embedding,
            source: "xenova",
            dimension: 384,
          };
        }

        // Try Ollama first, fallback to Xenova
        try {
          // Import Ollama dynamically
          const { Ollama, makeOllamaLive } = await import("./ollama.js");
          const ollamaLayer = makeOllamaLive(config);

          const program = Effect.gen(function* () {
            const ollama = yield* Ollama;
            return yield* ollama.embed(text);
          });

          const result = await Effect.runPromise(
            program.pipe(Effect.provide(ollamaLayer), Effect.either)
          );

          if (result._tag === "Right") {
            return {
              embedding: result.right,
              source: "ollama",
              dimension: 1024,
            };
          }

          // Ollama failed, fall through to Xenova
        } catch (error) {
          // Ollama initialization failed, fall through to Xenova
        }

        // Fallback to Xenova
        const embedding = await xenova.embed(text);
        return {
          embedding,
          source: "xenova",
          dimension: 384,
        };
      },

      embedBatch: async (texts: string[], concurrency?: number): Promise<EmbeddingWithMetadata[]> => {
        if (config.preferLocal) {
          // Use Xenova directly
          const embeddings = await xenova.embedBatch(texts, concurrency);
          return embeddings.map((embedding) => ({
            embedding,
            source: "xenova",
            dimension: 384,
          }));
        }

        // Try Ollama first, fallback to Xenova
        try {
          // Import Ollama dynamically
          const { Ollama, makeOllamaLive } = await import("./ollama.js");
          const ollamaLayer = makeOllamaLive(config);

          const program = Effect.gen(function* () {
            const ollama = yield* Ollama;
            return yield* ollama.embedBatch(texts, concurrency);
          });

          const result = await Effect.runPromise(
            program.pipe(Effect.provide(ollamaLayer), Effect.either)
          );

          if (result._tag === "Right") {
            return result.right.map((embedding) => ({
              embedding,
              source: "ollama",
              dimension: 1024,
            }));
          }

          // Ollama failed, fall through to Xenova
        } catch (error) {
          // Ollama initialization failed, fall through to Xenova
        }

        // Fallback to Xenova
        const embeddings = await xenova.embedBatch(texts, concurrency);
        return embeddings.map((embedding) => ({
          embedding,
          source: "xenova",
          dimension: 384,
        }));
      },
    }
  );
};
