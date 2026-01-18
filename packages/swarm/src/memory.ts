/**
 * Memory Module - Semantic Memory Adapter
 *
 * Provides a high-level adapter around swarm-mail's MemoryStore + Ollama.
 * Used by semantic-memory_* tools in the plugin.
 */

import { Effect } from "effect";
import {
	type DatabaseAdapter,
	createMemoryStore,
	getDefaultConfig,
	makeOllamaLive,
	Ollama,
	type Memory,
	type SearchResult,
	toSwarmDb,
	createMemoryAdapter as createSwarmMailAdapter,
} from "swarm-mail";

// ============================================================================
// Types
// ============================================================================

/** Arguments for store operation */
export interface StoreArgs {
	readonly information: string;
	readonly collection?: string;
	readonly tags?: string;
	readonly metadata?: string;
	/** Confidence level (0.0-1.0) affecting decay rate. Higher = slower decay. Default 0.7 */
	readonly confidence?: number;
	/** Auto-generate tags using LLM. Default false */
	readonly autoTag?: boolean;
	/** Auto-link to related memories. Default false */
	readonly autoLink?: boolean;
	/** Extract entities (people, places, technologies). Default false */
	readonly extractEntities?: boolean;
}

/** Arguments for find operation */
export interface FindArgs {
	readonly query: string;
	readonly limit?: number;
	readonly collection?: string;
	readonly expand?: boolean;
	readonly fts?: boolean;
}

/** Arguments for get/remove/validate operations */
export interface IdArgs {
	readonly id: string;
}

/** Arguments for list operation */
export interface ListArgs {
	readonly collection?: string;
}

/** Result from store operation */
export interface StoreResult {
	readonly id: string;
	readonly message: string;
}

/** Result from find operation */
export interface FindResult {
	readonly results: Array<{
		readonly id: string;
		readonly content: string;
		readonly score: number;
		readonly collection: string;
		readonly metadata: Record<string, unknown>;
		readonly createdAt: string;
	}>;
	readonly count: number;
}

/** Result from stats operation */
export interface StatsResult {
	readonly memories: number;
	readonly embeddings: number;
}

/** Result from health check */
export interface HealthResult {
	readonly ollama: boolean;
	readonly message?: string;
}

/** Result from validate/remove operations */
export interface OperationResult {
	readonly success: boolean;
	readonly message?: string;
}

/** Arguments for upsert operation */
export interface UpsertArgs {
	readonly information: string;
	readonly collection?: string;
	readonly tags?: string;
	readonly metadata?: string;
	readonly confidence?: number;
	/** Auto-generate tags using LLM. Default true */
	readonly autoTag?: boolean;
	/** Auto-link to related memories. Default true */
	readonly autoLink?: boolean;
	/** Extract entities (people, places, technologies). Default false */
	readonly extractEntities?: boolean;
}

/** Auto-generated tags result */
export interface AutoTags {
	readonly tags: string[];
	readonly keywords: string[];
	readonly category: string;
}

/** Result from upsert operation */
export interface UpsertResult {
	readonly operation: "ADD" | "UPDATE" | "DELETE" | "NOOP";
	readonly reason: string;
	readonly memoryId?: string;
	readonly affectedMemoryIds?: string[];
	readonly autoTags?: AutoTags;
	readonly linksCreated?: number;
	readonly entitiesExtracted?: number;
}

/**
 * Memory Adapter Interface
 *
 * High-level API for semantic memory operations.
 */
export interface MemoryAdapter {
	readonly store: (args: StoreArgs) => Promise<StoreResult>;
	readonly find: (args: FindArgs) => Promise<FindResult>;
	readonly get: (args: IdArgs) => Promise<Memory | null>;
	readonly remove: (args: IdArgs) => Promise<OperationResult>;
	readonly validate: (args: IdArgs) => Promise<OperationResult>;
	readonly list: (args: ListArgs) => Promise<Memory[]>;
	readonly stats: () => Promise<StatsResult>;
	readonly checkHealth: () => Promise<HealthResult>;
	readonly upsert: (args: UpsertArgs) => Promise<UpsertResult>;
}

/**
 * Create Memory Adapter
 *
 * @param db - DatabaseAdapter from swarm-mail's getDatabase()
 * @returns Memory adapter with high-level operations
 */
export async function createMemoryAdapter(
	db: DatabaseAdapter,
): Promise<MemoryAdapter> {
	// Convert DatabaseAdapter to SwarmDb (Drizzle client) for real swarm-mail adapter
	const drizzleDb = toSwarmDb(db);
	const config = getDefaultConfig();
	
	// Create real swarm-mail adapter with Wave 1-3 features
	const realAdapter = createSwarmMailAdapter(drizzleDb, config);
	
	// For backward compatibility, keep legacy adapter for methods not yet in real adapter
	const store = createMemoryStore(drizzleDb);
	const ollamaLayer = makeOllamaLive(config);

	/**
	 * Truncate content for preview
	 */
	const truncateContent = (content: string, maxLength = 200): string => {
		if (content.length <= maxLength) return content;
		return `${content.substring(0, maxLength)}...`;
	};

	return {
		async store(args: StoreArgs): Promise<StoreResult> {
			const result = await realAdapter.store(args.information, {
				collection: args.collection,
				tags: args.tags,
				metadata: args.metadata,
				confidence: args.confidence,
				autoTag: args.autoTag,
				autoLink: args.autoLink,
				extractEntities: args.extractEntities,
			});

			let message = `Stored memory ${result.id} in collection: ${args.collection ?? "default"}`;
			if (result.autoTags) message += `\nAuto-tags: ${result.autoTags.tags.join(", ")}`;
			if (result.links && result.links.length > 0) message += `\nLinked to ${result.links.length} related memory/ies`;

			return { id: result.id, message };
		},

		async find(args: FindArgs): Promise<FindResult> {
			const limit = args.limit ?? 10;
			let results: SearchResult[];
			let usedFallback = false;

			if (args.fts) {
				results = await store.ftsSearch(args.query, { limit, collection: args.collection });
			} else {
				const program = Effect.gen(function* () {
					const ollama = yield* Ollama;
					return yield* ollama.embed(args.query);
				});

				try {
					const queryEmbedding = await Effect.runPromise(program.pipe(Effect.provide(ollamaLayer)));
					results = await store.search(queryEmbedding, { limit, threshold: 0.3, collection: args.collection });
				} catch (e) {
					usedFallback = true;
					results = await store.ftsSearch(args.query, { limit, collection: args.collection });
				}
			}

			const response: FindResult & { fallback_used?: boolean } = {
				results: results.map((r) => ({
					id: r.memory.id,
					content: args.expand ? r.memory.content : truncateContent(r.memory.content),
					score: r.score,
					collection: r.memory.collection,
					metadata: r.memory.metadata,
					createdAt: r.memory.createdAt.toISOString(),
				})),
				count: results.length,
			};

			if (usedFallback) response.fallback_used = true;
			return response;
		},

		async get(args: IdArgs): Promise<Memory | null> {
			return store.get(args.id);
		},

		async remove(args: IdArgs): Promise<OperationResult> {
			await store.delete(args.id);
			return { success: true, message: `Removed memory ${args.id}` };
		},

		async validate(args: IdArgs): Promise<OperationResult> {
			const memory = await store.get(args.id);
			if (!memory) return { success: false, message: `Memory ${args.id} not found` };
			return { success: true, message: `Memory ${args.id} validated` };
		},

		async list(args: ListArgs): Promise<Memory[]> {
			return store.list(args.collection);
		},

		async stats(): Promise<StatsResult> {
			return store.getStats();
		},

		async checkHealth(): Promise<HealthResult> {
			const program = Effect.gen(function* () {
				const ollama = yield* Ollama;
				return yield* ollama.checkHealth();
			});

			try {
				await Effect.runPromise(program.pipe(Effect.provide(ollamaLayer)));
				return { ollama: true };
			} catch (error) {
				return {
					ollama: false,
					message: error instanceof Error ? error.message : "Ollama not available",
				};
			}
		},

		async upsert(args: UpsertArgs): Promise<UpsertResult> {
			if (!args.information) throw new Error("information is required for upsert");
			const result = await realAdapter.upsert(args.information, {
				collection: args.collection,
				tags: args.tags,
				metadata: args.metadata,
				confidence: args.confidence,
				useSmartOps: true,
				autoTag: args.autoTag,
				autoLink: args.autoLink,
				extractEntities: args.extractEntities,
			});

			return {
				operation: result.operation,
				reason: result.reason,
				memoryId: result.id,
				affectedMemoryIds: [result.id],
			};
		},
	};
}
