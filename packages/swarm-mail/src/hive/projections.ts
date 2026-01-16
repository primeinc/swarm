/**
 * cells Projections Layer - Update and query materialized views
 *
 * Projections are the read-side of CQRS. They update denormalized
 * materialized views when events are appended, and provide query methods.
 *
 * ## Architecture
 * - Event store is source of truth (write side)
 * - Projections are cached views (read side)
 * - Events trigger projection updates
 * - Queries read from projections (fast)
 *
 * ## Key projections:
 * - cells table: Main cell records
 * - cell_dependencies: Dependency relationships
 * - cell_labels: String tags
 * - cell_comments: Comments/notes
 * - blocked_cells_cache: Cached blocker lookups
 * - dirty_cells: Tracks changes for export
 *
 * @module hive/projections
 */

import type { DatabaseAdapter } from "../types/database.js";
import type {
	Cell,
	CellComment,
	CellDependency,
	CellLabel,
	CellStatus,
	CellType,
	QueryCellsOptions,
} from "../types/hive-adapter.js";

// Re-import event types (will be from opencode-swarm-plugin)
// For now, define minimal types for projection updates
type CellEvent = {
	type: string;
	project_key: string;
	cell_id: string;
	timestamp: number;
	[key: string]: unknown;
};

/**
 * Detect if database is libSQL (SQLite) vs PGlite (PostgreSQL)
 */
async function isLibSQL(db: DatabaseAdapter): Promise<boolean> {
	try {
		await db.query("SELECT name FROM sqlite_master LIMIT 1");
		return true;
	} catch {
		return false;
	}
}

// ============================================================================
// Event Handler - Main entry point for updating projections
// ============================================================================

/**
 * Update projections based on an event
 *
 * This is called by the event store after appending an event.
 * Routes to specific handlers based on event type.
 *
 * Uses Drizzle for write operations.
 */
export async function updateProjections(
	db: DatabaseAdapter,
	event: CellEvent,
): Promise<void> {
	const { toDrizzleDb } = await import("../libsql.convenience.js");
	const { updateProjectionsDrizzle } = await import("./projections-drizzle.js");

	const swarmDb = toDrizzleDb(db);
	await updateProjectionsDrizzle(swarmDb, event);
}

// ============================================================================
// Event Handlers - Migrated to Drizzle
// ============================================================================

// Event handlers have been moved to projections-drizzle.ts
// This file now delegates to the Drizzle implementation via updateProjectionsDrizzle()

// ============================================================================
// Query Functions - Read from projections
// ============================================================================

/**
 * Get a cell by ID
 */
export async function getCell(
	db: DatabaseAdapter,
	projectKey: string,
	cellId: string,
): Promise<Cell | null> {
	const result = await db.query<Cell>(
		`SELECT * FROM cells WHERE project_key = $1 AND id = $2 AND deleted_at IS NULL`,
		[projectKey, cellId],
	);
	return result.rows[0] ?? null;
}

/**
 * Query cells with filters
 */
export async function queryCells(
	db: DatabaseAdapter,
	projectKey: string,
	options: QueryCellsOptions = {},
): Promise<Cell[]> {
	const isLibSQLDb = await isLibSQL(db);
	const conditions: string[] = ["project_key = $1"];
	const params: unknown[] = [projectKey];
	let paramIndex = 2;

	if (!options.include_deleted) {
		conditions.push("deleted_at IS NULL");
	}

	if (options.status) {
		const statuses = Array.isArray(options.status)
			? options.status
			: [options.status];
		if (isLibSQLDb) {
			// SQLite uses IN with individual placeholders
			const placeholders = statuses.map(() => `$${paramIndex++}`).join(", ");
			conditions.push(`status IN (${placeholders})`);
			params.push(...statuses);
		} else {
			// PostgreSQL uses ANY with array
			conditions.push(`status = ANY($${paramIndex++})`);
			params.push(statuses);
		}
	}

	if (options.type) {
		const types = Array.isArray(options.type) ? options.type : [options.type];
		if (isLibSQLDb) {
			// SQLite uses IN with individual placeholders
			const placeholders = types.map(() => `$${paramIndex++}`).join(", ");
			conditions.push(`type IN (${placeholders})`);
			params.push(...types);
		} else {
			// PostgreSQL uses ANY with array
			conditions.push(`type = ANY($${paramIndex++})`);
			params.push(types);
		}
	}

	if (options.parent_id) {
		conditions.push(`parent_id = $${paramIndex++}`);
		params.push(options.parent_id);
	}

	if (options.assignee) {
		conditions.push(`assignee = $${paramIndex++}`);
		params.push(options.assignee);
	}

	let query = `SELECT * FROM cells WHERE ${conditions.join(" AND ")} ORDER BY priority DESC, created_at ASC`;

	if (options.limit) {
		query += ` LIMIT $${paramIndex++}`;
		params.push(options.limit);
	}

	if (options.offset) {
		query += ` OFFSET $${paramIndex++}`;
		params.push(options.offset);
	}

	const result = await db.query<Cell>(query, params);
	return result.rows;
}

/**
 * Get dependencies for a cell
 */
export async function getDependencies(
	db: DatabaseAdapter,
	projectKey: string,
	cellId: string,
): Promise<CellDependency[]> {
	const result = await db.query<CellDependency>(
		`SELECT * FROM cell_dependencies WHERE cell_id = $1`,
		[cellId],
	);
	return result.rows;
}

/**
 * Get cells that depend on this cell
 */
export async function getDependents(
	db: DatabaseAdapter,
	projectKey: string,
	cellId: string,
): Promise<CellDependency[]> {
	const result = await db.query<CellDependency>(
		`SELECT * FROM cell_dependencies WHERE depends_on_id = $1`,
		[cellId],
	);
	return result.rows;
}

/**
 * Check if cell is blocked
 */
export async function isBlocked(
	db: DatabaseAdapter,
	projectKey: string,
	cellId: string,
): Promise<boolean> {
	// SQLite-compatible: use COUNT instead of EXISTS which returns boolean
	const result = await db.query<{ is_blocked: number }>(
		`SELECT COUNT(*) as is_blocked FROM blocked_cells_cache WHERE cell_id = $1 LIMIT 1`,
		[cellId],
	);
	return (result.rows[0]?.is_blocked ?? 0) > 0;
}

/**
 * Get blockers for a cell
 */
export async function getBlockers(
	db: DatabaseAdapter,
	projectKey: string,
	cellId: string,
): Promise<string[]> {
	const result = await db.query<{ blocker_ids: string }>(
		`SELECT blocker_ids FROM blocked_cells_cache WHERE cell_id = $1`,
		[cellId],
	);
	// SQLite stores arrays as JSON strings - parse them
	const blockerIdsJson = result.rows[0]?.blocker_ids;
	if (!blockerIdsJson) return [];
	try {
		return JSON.parse(blockerIdsJson) as string[];
	} catch {
		return [];
	}
}

/**
 * Get labels for a cell
 */
export async function getLabels(
	db: DatabaseAdapter,
	projectKey: string,
	cellId: string,
): Promise<string[]> {
	const result = await db.query<{ label: string }>(
		`SELECT label FROM cell_labels WHERE cell_id = $1 ORDER BY label`,
		[cellId],
	);
	return result.rows.map((r) => r.label);
}

/**
 * Get comments for a cell
 */
export async function getComments(
	db: DatabaseAdapter,
	projectKey: string,
	cellId: string,
): Promise<CellComment[]> {
	const result = await db.query<CellComment>(
		`SELECT * FROM cell_comments WHERE cell_id = $1 ORDER BY created_at ASC`,
		[cellId],
	);
	return result.rows;
}

/**
 * Get next ready cell (unblocked, highest priority)
 */
export async function getNextReadyCell(
	db: DatabaseAdapter,
	projectKey: string,
): Promise<Cell | null> {
	const result = await db.query<Cell>(
		`SELECT b.* FROM cells b
     WHERE b.project_key = $1 
       AND b.status = 'open'
       AND b.deleted_at IS NULL
       AND NOT EXISTS (
         SELECT 1 FROM blocked_cells_cache bbc WHERE bbc.cell_id = b.id
       )
     ORDER BY b.priority DESC, b.created_at ASC
     LIMIT 1`,
		[projectKey],
	);
	return result.rows[0] ?? null;
}

/**
 * Get all in-progress cells
 */
export async function getInProgressCells(
	db: DatabaseAdapter,
	projectKey: string,
): Promise<Cell[]> {
	const result = await db.query<Cell>(
		`SELECT * FROM cells 
     WHERE project_key = $1 AND status = 'in_progress' AND deleted_at IS NULL
     ORDER BY priority DESC, created_at ASC`,
		[projectKey],
	);
	return result.rows;
}

/**
 * Get all blocked cells with their blockers
 */
export async function getBlockedCells(
	db: DatabaseAdapter,
	projectKey: string,
): Promise<Array<{ cell: Cell; blockers: string[] }>> {
	const result = await db.query<Cell & { blocker_ids: string[] }>(
		`SELECT b.*, bbc.blocker_ids 
     FROM cells b
     JOIN blocked_cells_cache bbc ON b.id = bbc.cell_id
     WHERE b.project_key = $1 AND b.deleted_at IS NULL
     ORDER BY b.priority DESC, b.created_at ASC`,
		[projectKey],
	);
	return result.rows.map((r) => {
		const { blocker_ids, ...cellData } = r;
		return { cell: cellData as Cell, blockers: blocker_ids };
	});
}

// ============================================================================
// Cache Management
// ============================================================================

// Cache management is now handled in dependencies.ts

// ============================================================================
// Dirty Tracking
// ============================================================================

/**
 * Mark cell as dirty for JSONL export
 *
 * Uses Drizzle for write operations.
 */
export async function markCellDirty(
	db: DatabaseAdapter,
	projectKey: string,
	cellId: string,
): Promise<void> {
	const { toDrizzleDb } = await import("../libsql.convenience.js");
	const { markCellDirtyDrizzle } = await import("./projections-drizzle.js");

	const swarmDb = toDrizzleDb(db);
	await markCellDirtyDrizzle(swarmDb, projectKey, cellId);
}

/**
 * Get all dirty cells
 */
export async function getDirtyCells(
	db: DatabaseAdapter,
	projectKey: string,
): Promise<string[]> {
	const result = await db.query<{ cell_id: string }>(
		`SELECT db.cell_id FROM dirty_cells db
     JOIN cells b ON db.cell_id = b.id
     WHERE b.project_key = $1
     ORDER BY db.marked_at ASC`,
		[projectKey],
	);
	return result.rows.map((r) => r.cell_id);
}

/**
 * Clear dirty flag after export
 *
 * Uses Drizzle for write operations.
 */
export async function clearDirtyCell(
	db: DatabaseAdapter,
	projectKey: string,
	cellId: string,
): Promise<void> {
	const { toDrizzleDb } = await import("../libsql.convenience.js");
	const { clearDirtyCellDrizzle } = await import("./projections-drizzle.js");

	const swarmDb = toDrizzleDb(db);
	await clearDirtyCellDrizzle(swarmDb, projectKey, cellId);
}

/**
 * Clear all dirty flags
 *
 * Uses Drizzle for write operations.
 */
export async function clearAllDirtyCells(
	db: DatabaseAdapter,
	projectKey: string,
): Promise<void> {
	const { toDrizzleDb } = await import("../libsql.convenience.js");
	const { clearAllDirtyCellsDrizzle } = await import(
		"./projections-drizzle.js"
	);

	const swarmDb = toDrizzleDb(db);
	await clearAllDirtyCellsDrizzle(swarmDb, projectKey);
}
