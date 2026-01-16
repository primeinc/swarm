/**
 * Memory Operations - Mem0 Pattern Implementation
 *
 * Implements the core Mem0 pattern: LLM decides what to do with incoming information.
 *
 * ## The Pattern
 * When new information arrives, the LLM analyzes it against existing memories and decides:
 * - **ADD**: New information, no existing memory covers this
 * - **UPDATE**: Existing memory needs refinement/addition
 * - **DELETE**: Information contradicts or invalidates existing memory
 * - **NOOP**: Information already captured, no action needed
 *
 * ## Integration
 * This will be integrated into the memory adapter's store() method to make
 * memory storage intelligent and automatic.
 *
 * ## References
 * - Mem0 paper: "Memory is essential for communication: we recall past interactions,
 *   infer preferences, and construct evolving mental models"
 * - Our current gap: Just appends. Mem0/A-MEM treat memory as a living graph.
 *
 * @example
 * ```typescript
 * import { analyzeMemoryOperation, executeMemoryOperation } from './memory-operations.js';
 * import { createMemoryAdapter } from './adapter.js';
 *
 * // 1. Find similar existing memories
 * const similar = await adapter.find(newInformation, { limit: 5 });
 * const existingMemories = similar.map(r => r.memory);
 *
 * // 2. Let LLM decide what to do
 * const operation = await analyzeMemoryOperation(
 *   newInformation,
 *   existingMemories,
 *   { model: 'anthropic/claude-haiku-4-5', apiKey: process.env.AI_GATEWAY_API_KEY }
 * );
 *
 * // 3. Execute the decision
 * const result = await executeMemoryOperation(operation, db, config);
 * ```
 */

import { generateText, Output } from "ai";
import { eq } from "drizzle-orm";
import { Effect } from "effect";
import { z } from "zod";
import type { SwarmDb } from "../db/client.js";
import { memories } from "../db/schema/memory.js";
import { createMemoryAdapter, type MemoryConfig } from "./adapter.js";
import { makeOllamaLive, Ollama } from "./ollama.js";
import type { Memory } from "./store.js";

// ============================================================================
// Types
// ============================================================================

/**
 * Memory operation types following Mem0 pattern
 */
export type MemoryOperation =
	| { type: "ADD"; content: string; reason: string }
	| { type: "UPDATE"; memoryId: string; newContent: string; reason: string }
	| { type: "DELETE"; memoryId: string; reason: string }
	| { type: "NOOP"; reason: string };

/**
 * Result of executing a memory operation
 */
export interface MemoryOperationResult {
	/** The operation that was executed */
	readonly operation: MemoryOperation;
	/** IDs of memories that were affected (created, updated, or deleted) */
	readonly affectedMemoryIds: string[];
}

/**
 * Configuration for LLM-driven memory operations
 */
export interface MemoryOperationConfig {
	/** Model to use (e.g., "anthropic/claude-haiku-4-5") */
	readonly model: string;
	/** API key for AI Gateway */
	readonly apiKey: string;
}

// ============================================================================
// LLM Decision Schema
// ============================================================================

/**
 * Zod schema for LLM decision output
 *
 * Uses a flat object schema (not discriminatedUnion) because Anthropic's API
 * requires `type: object` at the top level of JSON schemas.
 *
 * Optional fields are used for action-specific properties:
 * - ADD: just action + reason
 * - UPDATE: action + reason + memoryId + newContent
 * - DELETE: action + reason + memoryId
 * - NOOP: just action + reason
 */
const MemoryOperationSchema = z.object({
	action: z
		.enum(["ADD", "UPDATE", "DELETE", "NOOP"])
		.describe(
			"The memory operation to perform: ADD (new info), UPDATE (refine existing), DELETE (contradicts existing), NOOP (already captured)",
		),
	reason: z.string().describe("Explanation for why this action was chosen"),
	memoryId: z
		.string()
		.optional()
		.describe(
			"ID of the memory to update or delete (required for UPDATE and DELETE)",
		),
	newContent: z
		.string()
		.optional()
		.describe(
			"Updated content combining existing memory with new information (required for UPDATE)",
		),
});

// ============================================================================
// Core Functions
// ============================================================================

/**
 * Analyze incoming information and decide what memory operation to perform
 *
 * Uses an LLM to intelligently decide whether to add, update, delete, or skip
 * based on semantic similarity to existing memories.
 *
 * @param newInformation - The new information to process
 * @param existingMemories - Semantically similar existing memories (typically top 5)
 * @param config - LLM configuration (model + API key)
 * @returns Memory operation decision
 * @throws Error if LLM call fails
 *
 * @example
 * ```typescript
 * const operation = await analyzeMemoryOperation(
 *   "OAuth tokens need 5-minute refresh buffer",
 *   existingMemories,
 *   { model: "anthropic/claude-haiku-4-5", apiKey: "..." }
 * );
 * ```
 */
export async function analyzeMemoryOperation(
	newInformation: string,
	existingMemories: Memory[],
	config: MemoryOperationConfig,
): Promise<MemoryOperation> {
	// Build prompt with existing memories context
	const memoriesContext =
		existingMemories.length === 0
			? "No existing memories."
			: existingMemories
					.map(
						(m, i) =>
							`[${i + 1}] ID: ${m.id}\n    Content: ${m.content}\n    Tags: ${JSON.stringify(m.metadata.tags || [])}`,
					)
					.join("\n");

	const prompt = `You are a memory management system. Given new information and existing memories,
decide the appropriate action.

NEW INFORMATION:
${newInformation}

EXISTING RELEVANT MEMORIES:
${memoriesContext}

Decide ONE of the following actions:

1. **ADD**: If this is genuinely new information not covered by existing memories
   - Return: { action: "ADD", reason: "..." }

2. **UPDATE**: If an existing memory should be refined/extended with this new info
   - Return: { action: "UPDATE", memoryId: "...", newContent: "...", reason: "..." }
   - newContent should combine the existing memory with the new information

3. **DELETE**: If this contradicts/invalidates an existing memory
   - Return: { action: "DELETE", memoryId: "...", reason: "..." }

4. **NOOP**: If this information is already adequately captured
   - Return: { action: "NOOP", reason: "..." }

Be conservative with NOOP - only use if the information is truly redundant.
Prefer UPDATE when new information adds nuance or context.`;

	try {
		const result = await generateText({
			model: config.model,
			output: Output.object({
				schema: MemoryOperationSchema,
			}),
			prompt,
		});

		// Convert schema output to our MemoryOperation type (AI SDK v6 uses 'output' property)
		const decision = result.output;

		switch (decision.action) {
			case "ADD":
				return {
					type: "ADD",
					content: newInformation,
					reason: decision.reason,
				};
			case "UPDATE":
				if (!decision.memoryId || !decision.newContent) {
					throw new Error("UPDATE action requires memoryId and newContent");
				}
				return {
					type: "UPDATE",
					memoryId: decision.memoryId,
					newContent: decision.newContent,
					reason: decision.reason,
				};
			case "DELETE":
				if (!decision.memoryId) {
					throw new Error("DELETE action requires memoryId");
				}
				return {
					type: "DELETE",
					memoryId: decision.memoryId,
					reason: decision.reason,
				};
			case "NOOP":
				return {
					type: "NOOP",
					reason: decision.reason,
				};
			default:
				throw new Error(`Unhandled decision action: ${decision.action}`);
		}
	} catch (error) {
		throw new Error(
			`Failed to analyze memory operation: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
}

/**
 * Execute the decided memory operation
 *
 * Performs the actual database operations based on the LLM's decision.
 *
 * @param operation - The memory operation to execute
 * @param db - Drizzle database instance
 * @param config - Memory adapter configuration (for Ollama)
 * @returns Result with operation and affected memory IDs
 * @throws Error if operation fails or memory not found
 *
 * @example
 * ```typescript
 * const result = await executeMemoryOperation(
 *   { type: "ADD", content: "New info", reason: "..." },
 *   db,
 *   { ollamaHost: "http://localhost:11434", ollamaModel: "mxbai-embed-large" }
 * );
 * console.log(`Created memory: ${result.affectedMemoryIds[0]}`);
 * ```
 */
export async function executeMemoryOperation(
	operation: MemoryOperation,
	db: SwarmDb,
	config: MemoryConfig,
): Promise<MemoryOperationResult> {
	const adapter = createMemoryAdapter(db, config);

	switch (operation.type) {
		case "ADD": {
			const { id } = await adapter.store(operation.content, {
				collection: "default",
			});
			return {
				operation,
				affectedMemoryIds: [id],
			};
		}

		case "UPDATE": {
			// Verify memory exists
			const existing = await adapter.get(operation.memoryId);
			if (!existing) {
				throw new Error(`Memory not found: ${operation.memoryId}`);
			}

			// Generate new embedding for updated content
			const ollamaLayer = makeOllamaLive(config);
			const program = Effect.gen(function* () {
				const ollama = yield* Ollama;
				return yield* ollama.embed(operation.newContent);
			});

			const result = await Effect.runPromise(
				program.pipe(Effect.provide(ollamaLayer), Effect.either),
			);

			if (result._tag === "Left") {
				throw new Error("Failed to generate embedding for updated memory");
			}

			// Update memory directly via Drizzle
			await db
				.update(memories)
				.set({
					content: operation.newContent,
					updated_at: new Date().toISOString(),
					embedding: result.right as any, // Drizzle handles Buffer conversion
				})
				.where(eq(memories.id, operation.memoryId));

			return {
				operation,
				affectedMemoryIds: [operation.memoryId],
			};
		}

		case "DELETE": {
			// Verify memory exists
			const existing = await adapter.get(operation.memoryId);
			if (!existing) {
				throw new Error(`Memory not found: ${operation.memoryId}`);
			}

			await adapter.remove(operation.memoryId);
			return {
				operation,
				affectedMemoryIds: [operation.memoryId],
			};
		}

		case "NOOP": {
			return {
				operation,
				affectedMemoryIds: [],
			};
		}
	}
}
