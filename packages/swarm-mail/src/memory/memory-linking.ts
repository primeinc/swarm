/**
 * Memory Linking - Zettelkasten-style bidirectional connections
 *
 * Implements semantic memory linking with vector similarity:
 * - Find related memories via vector search
 * - Create typed bidirectional links
 * - Track link strength (reinforcement/decay)
 * - Auto-linking on memory creation
 *
 * ## Link Types
 * - **related**: General semantic similarity
 * - **contradicts**: Information conflicts with existing memory
 * - **supersedes**: New info replaces old (temporal validity)
 * - **elaborates**: New info expands on existing memory
 *
 * ## Design
 * - Uses vector_distance_cos() for similarity (0 = identical, 2 = opposite)
 * - Similarity score = 1 - distance (so 1 = identical, -1 = opposite)
 * - Links stored in memory_links table with CASCADE delete
 * - UNIQUE constraint prevents duplicate (source, target, type) tuples
 * - Queries return links from both source and target perspectives
 *
 * @module memory/memory-linking
 */

import { sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import type { SwarmDb } from "../db/client.js";

// ============================================================================
// Types
// ============================================================================

/** Link type between memories */
export type LinkType = "related" | "contradicts" | "supersedes" | "elaborates";

/** Memory link with metadata */
export interface MemoryLink {
	readonly id: string;
	readonly sourceId: string;
	readonly targetId: string;
	readonly linkType: LinkType;
	readonly strength: number; // 0-1, decays or reinforces
	readonly createdAt: Date;
}

/** Configuration for linking behavior */
export interface LinkingConfig {
	readonly similarityThreshold: number; // Min similarity to create link (default 0.7)
	readonly maxLinks: number; // Max links per memory (default 10)
}

/** Default linking configuration */
const DEFAULT_CONFIG: LinkingConfig = {
	similarityThreshold: 0.7,
	maxLinks: 10,
};

// ============================================================================
// Implementation
// ============================================================================

/**
 * Find related memories using vector similarity search
 *
 * Uses vector_distance_cos() to find semantically similar memories.
 * Excludes the source memory itself from results.
 *
 * @param memoryId - Source memory ID (excluded from results)
 * @param db - Database instance
 * @param embedding - 1024-dimensional query vector
 * @param config - Linking configuration (threshold, maxLinks)
 * @returns Array of related memory IDs with similarity scores
 *
 * @example
 * ```typescript
 * const related = await findRelatedMemories('mem-123', db, embedding, {
 *   similarityThreshold: 0.7,
 *   maxLinks: 5
 * });
 * // Returns: [{ memoryId: 'mem-456', similarity: 0.85 }, ...]
 * ```
 */
export async function findRelatedMemories(
	memoryId: string,
	db: SwarmDb,
	embedding: number[],
	config?: Partial<LinkingConfig>,
): Promise<Array<{ memoryId: string; similarity: number }>> {
	const { similarityThreshold, maxLinks } = {
		...DEFAULT_CONFIG,
		...config,
	};

	const vectorStr = JSON.stringify(embedding);

	// Use vector_top_k for efficient ANN search
	// Note: similarity = 1 - distance (cosine distance: 0 = identical, 2 = opposite)
	const results = await db.all<{
		id: string;
		distance: number;
	}>(sql`
    SELECT 
      m.id,
      vector_distance_cos(m.embedding, vector(${vectorStr})) as distance
    FROM vector_top_k('idx_memories_embedding', vector(${vectorStr}), ${maxLinks + 1}) AS v
    JOIN memories m ON m.rowid = v.id
    WHERE m.id != ${memoryId}
      AND (1 - vector_distance_cos(m.embedding, vector(${vectorStr}))) >= ${similarityThreshold}
    ORDER BY distance ASC
    LIMIT ${maxLinks}
  `);

	return results.map((row) => ({
		memoryId: row.id,
		similarity: 1 - row.distance, // Convert distance to similarity
	}));
}

/**
 * Create a bidirectional link between two memories
 *
 * Links are stored with UNIQUE(source_id, target_id, link_type) constraint.
 * Duplicate links will throw an error.
 *
 * @param sourceId - Source memory ID
 * @param targetId - Target memory ID
 * @param linkType - Type of link (related, contradicts, supersedes, elaborates)
 * @param db - Database instance
 * @param strength - Link strength (0-1, default 1.0)
 * @returns Created memory link
 * @throws Error if link already exists or memories don't exist
 *
 * @example
 * ```typescript
 * const link = await createLink('mem-1', 'mem-2', 'related', db, 0.8);
 * ```
 */
export async function createLink(
	sourceId: string,
	targetId: string,
	linkType: LinkType,
	db: SwarmDb,
	strength = 1.0,
): Promise<MemoryLink> {
	const id = nanoid();
	const createdAt = new Date();

	// Clamp strength to [0, 1]
	const clampedStrength = Math.max(0, Math.min(1, strength));

	await db.run(
		sql`
    INSERT INTO memory_links (id, source_id, target_id, link_type, strength, created_at)
    VALUES (${id}, ${sourceId}, ${targetId}, ${linkType}, ${clampedStrength}, ${createdAt.toISOString()})
  `,
	);

	return {
		id,
		sourceId,
		targetId,
		linkType,
		strength: clampedStrength,
		createdAt,
	};
}

/**
 * Get all links for a memory (both directions)
 *
 * Returns links where the memory is either source or target.
 * Optionally filter by link type.
 *
 * @param memoryId - Memory ID
 * @param db - Database instance
 * @param linkType - Optional link type filter
 * @returns Array of memory links
 *
 * @example
 * ```typescript
 * // Get all links
 * const allLinks = await getLinks('mem-123', db);
 *
 * // Get only 'related' links
 * const relatedLinks = await getLinks('mem-123', db, 'related');
 * ```
 */
export async function getLinks(
	memoryId: string,
	db: SwarmDb,
	linkType?: LinkType,
): Promise<MemoryLink[]> {
	const linkTypeFilter = linkType ? sql`AND link_type = ${linkType}` : sql``;

	const results = await db.all<{
		id: string;
		source_id: string;
		target_id: string;
		link_type: string;
		strength: number;
		created_at: string;
	}>(sql`
    SELECT id, source_id, target_id, link_type, strength, created_at
    FROM memory_links
    WHERE (source_id = ${memoryId} OR target_id = ${memoryId})
      ${linkTypeFilter}
    ORDER BY strength DESC, created_at DESC
  `);

	return results.map((row) => ({
		id: row.id,
		sourceId: row.source_id,
		targetId: row.target_id,
		linkType: row.link_type as LinkType,
		strength: row.strength,
		createdAt: new Date(row.created_at),
	}));
}

/**
 * Auto-link a memory to related memories
 *
 * Finds semantically similar memories and creates 'related' links.
 * Used during memory storage to build the knowledge graph.
 *
 * @param memoryId - Memory to link
 * @param embedding - Memory's embedding vector
 * @param db - Database instance
 * @param config - Linking configuration (threshold, maxLinks)
 * @returns Array of created links
 *
 * @example
 * ```typescript
 * // After storing a new memory
 * const links = await autoLinkMemory('mem-123', embedding, db, {
 *   similarityThreshold: 0.7,
 *   maxLinks: 5
 * });
 * ```
 */
export async function autoLinkMemory(
	memoryId: string,
	embedding: number[],
	db: SwarmDb,
	config?: Partial<LinkingConfig>,
): Promise<MemoryLink[]> {
	const related = await findRelatedMemories(memoryId, db, embedding, config);

	const links: MemoryLink[] = [];

	for (const { memoryId: targetId, similarity } of related) {
		try {
			const link = await createLink(
				memoryId,
				targetId,
				"related",
				db,
				similarity,
			);
			links.push(link);
		} catch {
			// Skip if link already exists (UNIQUE constraint violation)
			// This can happen if auto-linking is called multiple times
		}
	}

	return links;
}

/**
 * Update link strength (reinforcement or decay)
 *
 * Adds delta to current strength, clamped to [0, 1].
 * Positive delta = reinforcement, negative delta = decay.
 *
 * @param linkId - Link ID
 * @param delta - Change in strength (can be negative)
 * @param db - Database instance
 *
 * @example
 * ```typescript
 * // Reinforce link
 * await updateLinkStrength('link-123', 0.1, db);
 *
 * // Decay link
 * await updateLinkStrength('link-456', -0.2, db);
 * ```
 */
export async function updateLinkStrength(
	linkId: string,
	delta: number,
	db: SwarmDb,
): Promise<void> {
	// Use SQL to clamp to [0, 1] during update
	await db.run(
		sql`
    UPDATE memory_links
    SET strength = CASE
      WHEN strength + ${delta} > 1.0 THEN 1.0
      WHEN strength + ${delta} < 0.0 THEN 0.0
      ELSE strength + ${delta}
    END
    WHERE id = ${linkId}
  `,
	);
}
