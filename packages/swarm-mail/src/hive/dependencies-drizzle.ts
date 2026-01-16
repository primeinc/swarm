/**
 * Dependency Graph Operations - Drizzle Implementation
 *
 * Drizzle-based operations for blocked cache management.
 * Only handles write operations - complex graph queries stay in dependencies.ts
 *
 * @module hive/dependencies-drizzle
 */

import { eq, sql } from "drizzle-orm";
import type { SwarmDb } from "../db/client.js";
import { cellDependencies, blockedcellsCache } from "../db/schema/hive.js";

const MAX_DEPENDENCY_DEPTH = 100;

/**
 * Get all open blockers for a cell (including transitive)
 *
 * Uses raw SQL because recursive CTEs are complex in Drizzle.
 * Returns cell IDs of all cells blocking this one that aren't closed.
 * Only considers "blocks" relationship type.
 */
export async function getOpenBlockersDrizzle(
	db: SwarmDb,
	projectKey: string,
	cellId: string,
): Promise<string[]> {
	const result = await db.all<{ blocker_id: string }>(
		sql`WITH RECURSIVE blockers AS (
       -- Direct blockers
       SELECT depends_on_id as blocker_id, 1 as depth
       FROM cell_dependencies
       WHERE cell_id = ${cellId} AND relationship = 'blocks'
       
       UNION
       
       -- Transitive blockers
       SELECT bd.depends_on_id, b.depth + 1
       FROM cell_dependencies bd
       JOIN blockers b ON bd.cell_id = b.blocker_id
       WHERE bd.relationship = 'blocks' AND b.depth < ${MAX_DEPENDENCY_DEPTH}
     )
     SELECT DISTINCT b.blocker_id
     FROM blockers b
     JOIN cells cell ON b.blocker_id = cell.id
     WHERE cell.project_key = ${projectKey} AND cell.status != 'closed' AND cell.deleted_at IS NULL`,
	);

	return result.map((r) => r.blocker_id);
}

/**
 * Rebuild blocked cache for a specific cell using Drizzle
 *
 * Finds all open blockers and updates the cache.
 * If no open blockers, removes from cache (cell is unblocked).
 */
export async function rebuildcellBlockedCacheDrizzle(
	db: SwarmDb,
	projectKey: string,
	cellId: string,
): Promise<void> {
	const blockerIds = await getOpenBlockersDrizzle(db, projectKey, cellId);

	if (blockerIds.length > 0) {
		// Has open blockers - insert or update cache
		// SQLite: serialize array as JSON string
		const blockerIdsJson = JSON.stringify(blockerIds);
		await db
			.insert(blockedcellsCache)
			.values({
				cell_id: cellId,
				blocker_ids: blockerIdsJson,
				updated_at: Date.now(),
			})
			.onConflictDoUpdate({
				target: blockedcellsCache.cell_id,
				set: {
					blocker_ids: blockerIdsJson,
					updated_at: Date.now(),
				},
			});
	} else {
		// No open blockers - remove from cache
		await db
			.delete(blockedcellsCache)
			.where(eq(blockedcellsCache.cell_id, cellId));
	}
}

/**
 * Invalidate blocked cache when dependencies change using Drizzle
 *
 * Rebuilds cache for the cell and all its dependents.
 */
export async function invalidateBlockedCacheDrizzle(
	db: SwarmDb,
	projectKey: string,
	cellId: string,
): Promise<void> {
	await rebuildcellBlockedCacheDrizzle(db, projectKey, cellId);

	// Also invalidate dependents (cells that depend on this one)
	const dependents = await db
		.select({ cell_id: cellDependencies.cell_id })
		.from(cellDependencies)
		.where(eq(cellDependencies.depends_on_id, cellId));

	for (const row of dependents) {
		await rebuildcellBlockedCacheDrizzle(db, projectKey, row.cell_id);
	}
}
