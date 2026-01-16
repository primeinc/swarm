/**
 * Hive Adapter - Factory for creating HiveAdapter instances
 *
 * This file implements the adapter pattern for hive event sourcing,
 * enabling dependency injection of the database.
 *
 * ## Design Pattern
 * - Accept DatabaseAdapter via factory parameter
 * - Return HiveAdapter interface
 * - Delegate to store.ts for event operations
 * - Delegate to projections.ts for queries
 * - No direct database access (all via adapter)
 *
 * ## Usage
 * ```typescript
 * import { createInMemorySwarmMailLibSQL } from 'swarm-mail';
 * import { createHiveAdapter } from 'swarm-mail';
 *
 * const swarmMail = await createInMemorySwarmMailLibSQL('my-project');
 * const db = await swarmMail.getDatabase();
 * const hive = createHiveAdapter(db, '/path/to/project');
 *
 * // Use the adapter
 * await hive.createCell(projectKey, { title: "Task", type: "task", priority: 2 });
 * const cell = await hive.getCell(projectKey, "cell-123");
 * ```
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { DatabaseAdapter } from "../types/database.js";
import type { HiveAdapter } from "../types/hive-adapter.js";
// Import event types (will be from opencode-swarm-plugin)
import type {
	CellAssignedEvent,
	CellClosedEvent,
	CellCommentAddedEvent,
	CellCommentDeletedEvent,
	CellCommentUpdatedEvent,
	CellCreatedEvent,
	CellDeletedEvent,
	CellDependencyAddedEvent,
	CellDependencyRemovedEvent,
	CellEpicChildAddedEvent,
	CellEpicChildRemovedEvent,
	CellEvent,
	CellLabelAddedEvent,
	CellLabelRemovedEvent,
	CellReopenedEvent,
	CellStatusChangedEvent,
	CellUpdatedEvent,
} from "./events.js";

// Import projections functions - NOTE: some still use legacy 'cell' naming in exports
import {
	clearDirtycell as clearDirtyCell,
	getBlockedCells,
	getBlockers,
	getCell,
	getComments,
	getDependencies,
	getDependents,
	getDirtyCells,
	getInProgressCells,
	getLabels,
	getNextReadyCell,
	isBlocked,
	markcellDirty as markCellDirty,
	queryCells,
} from "./projections.js";
// Import implementation functions from store.ts and projections.ts
import { appendCellEvent, readCellEvents, replayCellEvents } from "./store.js";

/**
 * Create a HiveAdapter instance
 *
 * @param db - DatabaseAdapter instance (libSQL, SQLite, etc.)
 * @param projectKey - Project identifier (typically the project path)
 * @returns HiveAdapter interface
 */
export function createHiveAdapter(
	db: DatabaseAdapter,
	projectKey: string,
): HiveAdapter {
	return {
		// ============================================================================
		// Core Cell Operations
		// ============================================================================

		async createCell(projectKeyParam, options, projectPath?) {
			// Create cell_created event
			const event: CellCreatedEvent = {
				type: "cell_created",
				project_key: projectKeyParam,
				cell_id: generateCellId(projectKeyParam),
				timestamp: Date.now(),
				title: options.title,
				description: options.description || undefined,
				issue_type: options.type as
					| "bug"
					| "feature"
					| "task"
					| "epic"
					| "chore"
					| "message",
				priority: options.priority ?? 2,
				parent_id: options.parent_id || undefined,
				created_by: options.created_by || undefined,
				metadata: options.metadata || undefined,
			};

			await appendCellEvent(event, projectPath, db);

			// If assignee provided, emit cell_assigned event
			if (options.assignee) {
				const assignEvent: CellAssignedEvent = {
					type: "cell_assigned",
					project_key: projectKeyParam,
					cell_id: event.cell_id,
					timestamp: Date.now(),
					agent_name: options.assignee,
					task_description: options.created_by || undefined,
				};
				await appendCellEvent(assignEvent, projectPath, db);
			}

			// Return the created cell from projection
			const cell = await getCell(db, projectKeyParam, event.cell_id);
			if (!cell) {
				throw new Error(
					`[HiveAdapter] Failed to create cell - not found after insert`,
				);
			}
			return cell;
		},

		async getCell(projectKeyParam, cellId, _projectPath?) {
			return getCell(db, projectKeyParam, cellId);
		},

		async queryCells(projectKeyParam, options?, _projectPath?) {
			return queryCells(db, projectKeyParam, options);
		},

		async updateCell(projectKeyParam, cellId, options, projectPath?) {
			const existingCell = await getCell(db, projectKeyParam, cellId);
			if (!existingCell) {
				throw new Error(`[HiveAdapter] Cell not found: ${cellId}`);
			}

			const changes: CellUpdatedEvent["changes"] = {};

			if (options.title && options.title !== existingCell.title) {
				changes.title = { old: existingCell.title, new: options.title };
			}
			if (
				options.description !== undefined &&
				options.description !== existingCell.description
			) {
				changes.description = {
					old: existingCell.description,
					new: options.description || null,
				};
			}
			if (
				options.priority !== undefined &&
				options.priority !== existingCell.priority
			) {
				changes.priority = {
					old: existingCell.priority,
					new: options.priority,
				};
			}
			if (
				options.assignee !== undefined &&
				options.assignee !== existingCell.assignee
			) {
				changes.assignee = {
					old: existingCell.assignee,
					new: options.assignee || null,
				};
			}

			if (Object.keys(changes).length === 0) {
				return existingCell; // No changes
			}

			const event: CellUpdatedEvent = {
				type: "cell_updated",
				project_key: projectKeyParam,
				cell_id: cellId,
				timestamp: Date.now(),
				changes,
				updated_by: options.updated_by || undefined,
			};

			await appendCellEvent(event, projectPath, db);

			const updated = await getCell(db, projectKeyParam, cellId);
			if (!updated) {
				throw new Error(
					`[HiveAdapter] Cell disappeared after update: ${cellId}`,
				);
			}
			return updated;
		},

		async changeCellStatus(
			projectKeyParam,
			cellId,
			toStatus,
			options?,
			projectPath?,
		) {
			const existingCell = await getCell(db, projectKeyParam, cellId);
			if (!existingCell) {
				throw new Error(`[HiveAdapter] Cell not found: ${cellId}`);
			}

			const event: CellStatusChangedEvent = {
				type: "cell_status_changed",
				project_key: projectKeyParam,
				cell_id: cellId,
				timestamp: Date.now(),
				from_status: existingCell.status,
				to_status: toStatus,
				reason: options?.reason || undefined,
				changed_by: options?.changed_by || undefined,
			};

			await appendCellEvent(event, projectPath, db);

			const updated = await getCell(db, projectKeyParam, cellId);
			if (!updated) {
				throw new Error(
					`[HiveAdapter] Cell disappeared after status change: ${cellId}`,
				);
			}
			return updated;
		},

		async closeCell(projectKeyParam, cellId, reason, options?, projectPath?) {
			const existingCell = await getCell(db, projectKeyParam, cellId);
			if (!existingCell) {
				throw new Error(`[HiveAdapter] Cell not found: ${cellId}`);
			}

			const event: CellClosedEvent = {
				type: "cell_closed",
				project_key: projectKeyParam,
				cell_id: cellId,
				timestamp: Date.now(),
				reason,
				closed_by: options?.closed_by || undefined,
				files_touched: options?.files_touched || undefined,
				duration_ms: options?.duration_ms || undefined,
			};

			await appendCellEvent(event, projectPath, db);

			const updated = await getCell(db, projectKeyParam, cellId);
			if (!updated) {
				throw new Error(
					`[HiveAdapter] Cell disappeared after close: ${cellId}`,
				);
			}
			return updated;
		},

		async reopenCell(projectKeyParam, cellId, options?, projectPath?) {
			const existingCell = await getCell(db, projectKeyParam, cellId);
			if (!existingCell) {
				throw new Error(`[HiveAdapter] Cell not found: ${cellId}`);
			}

			const event: CellReopenedEvent = {
				type: "cell_reopened",
				project_key: projectKeyParam,
				cell_id: cellId,
				timestamp: Date.now(),
				reason: options?.reason || undefined,
				reopened_by: options?.reopened_by || undefined,
			};

			await appendCellEvent(event, projectPath, db);

			const updated = await getCell(db, projectKeyParam, cellId);
			if (!updated) {
				throw new Error(
					`[HiveAdapter] Cell disappeared after reopen: ${cellId}`,
				);
			}
			return updated;
		},

		async deleteCell(projectKeyParam, cellId, options?, projectPath?) {
			const existingCell = await getCell(db, projectKeyParam, cellId);
			if (!existingCell) {
				throw new Error(`[HiveAdapter] Cell not found: ${cellId}`);
			}

			const event: CellDeletedEvent = {
				type: "cell_deleted",
				project_key: projectKeyParam,
				cell_id: cellId,
				timestamp: Date.now(),
				reason: options?.reason || undefined,
				deleted_by: options?.deleted_by || undefined,
			};

			await appendCellEvent(event, projectPath, db);
		},

		// ============================================================================
		// Dependency Operations
		// ============================================================================

		async addDependency(
			projectKeyParam,
			cellId,
			dependsOnId,
			relationship,
			options?,
			projectPath?,
		) {
			// Validate both cells exist
			const sourceCell = await getCell(db, projectKeyParam, cellId);
			if (!sourceCell) {
				throw new Error(`[HiveAdapter] Cell not found: ${cellId}`);
			}

			const targetCell = await getCell(db, projectKeyParam, dependsOnId);
			if (!targetCell) {
				throw new Error(`[HiveAdapter] Target cell not found: ${dependsOnId}`);
			}

			// Prevent self-dependency
			if (cellId === dependsOnId) {
				throw new Error(`[HiveAdapter] Cell cannot depend on itself`);
			}

			// Check for cycles (import at runtime to avoid circular deps)
			const { wouldCreateCycle } = await import("./dependencies.js");
			const hasCycle = await wouldCreateCycle(db, cellId, dependsOnId);
			if (hasCycle) {
				throw new Error(`[HiveAdapter] Adding dependency would create a cycle`);
			}

			const event: CellDependencyAddedEvent = {
				type: "cell_dependency_added",
				project_key: projectKeyParam,
				cell_id: cellId,
				timestamp: Date.now(),
				dependency: {
					target: dependsOnId,
					type: relationship,
				},
				reason: options?.reason || undefined,
				added_by: options?.added_by || undefined,
			};

			await appendCellEvent(event, projectPath, db);

			const deps = await getDependencies(db, projectKeyParam, cellId);
			const dep = deps.find(
				(d) =>
					d.depends_on_id === dependsOnId && d.relationship === relationship,
			);
			if (!dep) {
				throw new Error(`[HiveAdapter] Dependency not found after insert`);
			}
			return dep;
		},

		async removeDependency(
			projectKeyParam,
			cellId,
			dependsOnId,
			relationship,
			options?,
			projectPath?,
		) {
			const event: CellDependencyRemovedEvent = {
				type: "cell_dependency_removed",
				project_key: projectKeyParam,
				cell_id: cellId,
				timestamp: Date.now(),
				dependency: {
					target: dependsOnId,
					type: relationship,
				},
				reason: options?.reason || undefined,
				removed_by: options?.removed_by || undefined,
			};

			await appendCellEvent(event, projectPath, db);
		},

		async getDependencies(projectKeyParam, cellId, _projectPath?) {
			return getDependencies(db, projectKeyParam, cellId);
		},

		async getDependents(projectKeyParam, cellId, _projectPath?) {
			return getDependents(db, projectKeyParam, cellId);
		},

		async isBlocked(projectKeyParam, cellId, _projectPath?) {
			return isBlocked(db, projectKeyParam, cellId);
		},

		async getBlockers(projectKeyParam, cellId, _projectPath?) {
			return getBlockers(db, projectKeyParam, cellId);
		},

		// ============================================================================
		// Label Operations
		// ============================================================================

		async addLabel(projectKeyParam, cellId, label, options?, projectPath?) {
			const event: CellLabelAddedEvent = {
				type: "cell_label_added",
				project_key: projectKeyParam,
				cell_id: cellId,
				timestamp: Date.now(),
				label,
				added_by: options?.added_by || undefined,
			};

			await appendCellEvent(event, projectPath, db);

			return {
				cell_id: cellId,
				label,
				created_at: event.timestamp,
			};
		},

		async removeLabel(projectKeyParam, cellId, label, options?, projectPath?) {
			const event: CellLabelRemovedEvent = {
				type: "cell_label_removed",
				project_key: projectKeyParam,
				cell_id: cellId,
				timestamp: Date.now(),
				label,
				removed_by: options?.removed_by || undefined,
			};

			await appendCellEvent(event, projectPath, db);
		},

		async getLabels(projectKeyParam, cellId, _projectPath?) {
			return getLabels(db, projectKeyParam, cellId);
		},

		async getCellsWithLabel(projectKeyParam, label, _projectPath?) {
			return queryCells(db, projectKeyParam, { labels: [label] });
		},

		// ============================================================================
		// Comment Operations
		// ============================================================================

		async addComment(
			projectKeyParam,
			cellId,
			author,
			body,
			options?,
			projectPath?,
		) {
			const event: CellCommentAddedEvent = {
				type: "cell_comment_added",
				project_key: projectKeyParam,
				cell_id: cellId,
				timestamp: Date.now(),
				author,
				body,
				parent_comment_id: options?.parent_id || undefined,
				metadata: options?.metadata || undefined,
			};

			await appendCellEvent(event, projectPath, db);

			// Get the comment from projection
			const comments = await getComments(db, projectKeyParam, cellId);
			const comment = comments[comments.length - 1]; // Last inserted
			if (!comment) {
				throw new Error(`[HiveAdapter] Comment not found after insert`);
			}
			return comment;
		},

		async updateComment(
			projectKeyParam,
			commentId,
			newBody,
			updated_by,
			projectPath?,
		) {
			const event: CellCommentUpdatedEvent = {
				type: "cell_comment_updated",
				project_key: projectKeyParam,
				cell_id: "", // Not needed for comment update
				timestamp: Date.now(),
				comment_id: commentId,
				old_body: "", // Will be filled by projection
				new_body: newBody,
				updated_by,
			};

			await appendCellEvent(event, projectPath, db);

			// Would need a getCommentById function in projections
			// For now, return a placeholder
			return {
				id: commentId,
				cell_id: "",
				author: updated_by,
				body: newBody,
				parent_id: null,
				created_at: Date.now(),
				updated_at: event.timestamp,
			};
		},

		async deleteComment(
			projectKeyParam,
			commentId,
			deleted_by,
			options?,
			projectPath?,
		) {
			const event: CellCommentDeletedEvent = {
				type: "cell_comment_deleted",
				project_key: projectKeyParam,
				cell_id: "", // Not needed for comment delete
				timestamp: Date.now(),
				comment_id: commentId,
				deleted_by,
				reason: options?.reason || undefined,
			};

			await appendCellEvent(event, projectPath, db);
		},

		async getComments(projectKeyParam, cellId, _projectPath?) {
			return getComments(db, projectKeyParam, cellId);
		},

		// ============================================================================
		// Epic Operations
		// ============================================================================

		async addChildToEpic(
			projectKeyParam,
			epicId,
			childId,
			options?,
			projectPath?,
		) {
			const event: CellEpicChildAddedEvent = {
				type: "cell_epic_child_added",
				project_key: projectKeyParam,
				cell_id: epicId,
				timestamp: Date.now(),
				child_id: childId,
				child_index: options?.child_index || undefined,
				added_by: options?.added_by || undefined,
			};

			await appendCellEvent(event, projectPath, db);
		},

		async removeChildFromEpic(
			projectKeyParam,
			epicId,
			childId,
			options?,
			projectPath?,
		) {
			const event: CellEpicChildRemovedEvent = {
				type: "cell_epic_child_removed",
				project_key: projectKeyParam,
				cell_id: epicId,
				timestamp: Date.now(),
				child_id: childId,
				reason: options?.reason || undefined,
				removed_by: options?.removed_by || undefined,
			};

			await appendCellEvent(event, projectPath, db);
		},

		async getEpicChildren(projectKeyParam, epicId, _projectPath?) {
			return queryCells(db, projectKeyParam, { parent_id: epicId });
		},

		async isEpicClosureEligible(projectKeyParam, epicId, _projectPath?) {
			const children = await queryCells(db, projectKeyParam, {
				parent_id: epicId,
			});
			return children.every((child) => child.status === "closed");
		},

		// ============================================================================
		// Query Helpers
		// ============================================================================

		async getNextReadyCell(projectKeyParam, _projectPath?) {
			return getNextReadyCell(db, projectKeyParam);
		},

		async getInProgressCells(projectKeyParam, _projectPath?) {
			return getInProgressCells(db, projectKeyParam);
		},

		async getBlockedCells(projectKeyParam, _projectPath?) {
			return getBlockedCells(db, projectKeyParam);
		},

		async markDirty(projectKeyParam, cellId, _projectPath?) {
			await markCellDirty(db, projectKeyParam, cellId);
		},

		async getDirtyCells(projectKeyParam, _projectPath?) {
			return getDirtyCells(db, projectKeyParam);
		},

		async clearDirty(projectKeyParam, cellId, _projectPath?) {
			await clearDirtyCell(db, projectKeyParam, cellId);
		},

		// ============================================================================
		// Schema Operations
		// ============================================================================

		async runMigrations(_projectPath?) {
			// Detect database dialect by checking for SQLite/LibSQL-specific features
			// LibSQL and SQLite use sqlite_master, PostgreSQL uses information_schema
			let isLibSQL = false;
			try {
				await db.query("SELECT name FROM sqlite_master LIMIT 1");
				isLibSQL = true;
			} catch {
				isLibSQL = false;
			}

			// Ensure schema_version table exists (idempotent)
			if (isLibSQL) {
				await db.exec(`
          CREATE TABLE IF NOT EXISTS schema_version (
            version INTEGER PRIMARY KEY,
            applied_at INTEGER NOT NULL,
            description TEXT
          )
        `);
			} else {
				await db.exec(`
          CREATE TABLE IF NOT EXISTS schema_version (
            version INTEGER PRIMARY KEY,
            applied_at BIGINT NOT NULL,
            description TEXT
          )
        `);
			}

			// Import the correct migration set based on dialect
			const { hiveMigrations, hiveMigrationsLibSQL } = await import(
				"./migrations.js"
			);
			const migrations = isLibSQL ? hiveMigrationsLibSQL : hiveMigrations;

			// Get current schema version
			const versionResult = await db.query<{ version: number }>(
				"SELECT MAX(version) as version FROM schema_version",
			);
			const currentVersion = versionResult.rows[0]?.version ?? 0;

			// Apply pending migrations
			for (const migration of migrations) {
				if (migration.version > currentVersion) {
					// libSQL's executeMultiple handles transactions internally,
					// so we don't wrap in BEGIN/COMMIT for libSQL
					if (isLibSQL) {
						await db.exec(migration.up);
						await db.query(
							`INSERT INTO schema_version (version, applied_at, description) VALUES (?, ?, ?)
               ON CONFLICT (version) DO NOTHING`,
							[migration.version, Date.now(), migration.description],
						);
					} else {
						// PGLite needs explicit transaction
						await db.exec("BEGIN");
						try {
							await db.exec(migration.up);
							await db.query(
								`INSERT INTO schema_version (version, applied_at, description) VALUES ($1, $2, $3)
                 ON CONFLICT (version) DO NOTHING`,
								[migration.version, Date.now(), migration.description],
							);
							await db.exec("COMMIT");
						} catch (error) {
							await db.exec("ROLLBACK");
							throw error;
						}
					}
				}
			}

			// Force checkpoint after migrations to prevent WAL bloat
			// Critical for embedded PGLite - prevents 930 WAL file accumulation
			if (db.checkpoint) {
				await db.checkpoint();
			}
		},

		async getCellsStats(_projectPath?) {
			const [
				totalResult,
				openResult,
				inProgressResult,
				blockedResult,
				closedResult,
			] = await Promise.all([
				db.query<{ count: string }>(
					"SELECT COUNT(*) as count FROM cells WHERE project_key = $1",
					[projectKey],
				),
				db.query<{ count: string }>(
					"SELECT COUNT(*) as count FROM cells WHERE project_key = $1 AND status = 'open'",
					[projectKey],
				),
				db.query<{ count: string }>(
					"SELECT COUNT(*) as count FROM cells WHERE project_key = $1 AND status = 'in_progress'",
					[projectKey],
				),
				db.query<{ count: string }>(
					"SELECT COUNT(*) as count FROM cells WHERE project_key = $1 AND status = 'blocked'",
					[projectKey],
				),
				db.query<{ count: string }>(
					"SELECT COUNT(*) as count FROM cells WHERE project_key = $1 AND status = 'closed'",
					[projectKey],
				),
			]);

			const byTypeResult = await db.query<{ type: string; count: string }>(
				"SELECT type, COUNT(*) as count FROM cells WHERE project_key = $1 GROUP BY type",
				[projectKey],
			);

			const by_type: Record<string, number> = {};
			for (const row of byTypeResult.rows) {
				by_type[row.type] = parseInt(row.count);
			}

			return {
				total_cells: parseInt(totalResult.rows[0]?.count || "0"),
				open: parseInt(openResult.rows[0]?.count || "0"),
				in_progress: parseInt(inProgressResult.rows[0]?.count || "0"),
				blocked: parseInt(blockedResult.rows[0]?.count || "0"),
				closed: parseInt(closedResult.rows[0]?.count || "0"),
				by_type,
			};
		},

		async rebuildBlockedCache(projectKeyParam, _projectPath?) {
			// Rebuild cache for all cells in project (import at runtime)
			const { rebuildAllBlockedCaches } = await import("./dependencies.js");
			await rebuildAllBlockedCaches(db, projectKeyParam);
		},

		// ============================================================================
		// Database Connection Management
		// ============================================================================

		// ============================================================================
		// Session Operations (Chainlink-inspired)
		// ============================================================================

		async startSession(projectKeyParam, options?, _projectPath?) {
			// Get previous session's handoff notes
			const previousSession = await db.query<{
				handoff_notes: string | null;
			}>(
				`SELECT handoff_notes FROM sessions 
         WHERE project_key = $1 AND ended_at IS NOT NULL
         ORDER BY started_at DESC LIMIT 1`,
				[projectKeyParam],
			);

			const previousNotes = previousSession.rows[0]?.handoff_notes || null;

			// Create new session
			const now = Date.now();
			await db.query(
				`INSERT INTO sessions (project_key, started_at, active_cell_id, created_by)
         VALUES ($1, $2, $3, $4)`,
				[
					projectKeyParam,
					now,
					options?.active_cell_id || null,
					options?.created_by || null,
				],
			);

			// Get the newly created session
			const result = await db.query<{
				id: number;
				project_key: string;
				started_at: number;
				ended_at: number | null;
				active_cell_id: string | null;
				handoff_notes: string | null;
				created_by: string | null;
			}>(`SELECT * FROM sessions WHERE project_key = $1 AND started_at = $2`, [
				projectKeyParam,
				now,
			]);

			const session = result.rows[0];
			if (!session) {
				throw new Error("[HiveAdapter] Session creation failed");
			}

			return {
				...session,
				previous_handoff_notes: previousNotes,
			};
		},

		async endSession(projectKeyParam, sessionId, options?, _projectPath?) {
			// Check if session exists and is active
			const existing = await db.query<{
				id: number;
				ended_at: number | null;
			}>(
				`SELECT id, ended_at FROM sessions WHERE id = $1 AND project_key = $2`,
				[sessionId, projectKeyParam],
			);

			if (existing.rows.length === 0) {
				throw new Error(`[HiveAdapter] Session not found: ${sessionId}`);
			}

			if (existing.rows[0].ended_at !== null) {
				throw new Error("[HiveAdapter] Session already ended");
			}

			// End the session
			const now = Date.now();
			await db.query(
				`UPDATE sessions SET ended_at = $1, handoff_notes = $2 WHERE id = $3`,
				[now, options?.handoff_notes || null, sessionId],
			);

			// Return updated session
			const result = await db.query<{
				id: number;
				project_key: string;
				started_at: number;
				ended_at: number | null;
				active_cell_id: string | null;
				handoff_notes: string | null;
				created_by: string | null;
			}>(`SELECT * FROM sessions WHERE id = $1`, [sessionId]);

			const session = result.rows[0];
			if (!session) {
				throw new Error("[HiveAdapter] Session disappeared after update");
			}

			return session;
		},

		async getSession(projectKeyParam, sessionId, _projectPath?) {
			const result = await db.query<{
				id: number;
				project_key: string;
				started_at: number;
				ended_at: number | null;
				active_cell_id: string | null;
				handoff_notes: string | null;
				created_by: string | null;
			}>(`SELECT * FROM sessions WHERE id = $1 AND project_key = $2`, [
				sessionId,
				projectKeyParam,
			]);

			return result.rows[0] || null;
		},

		async getCurrentSession(projectKeyParam, _projectPath?) {
			const result = await db.query<{
				id: number;
				project_key: string;
				started_at: number;
				ended_at: number | null;
				active_cell_id: string | null;
				handoff_notes: string | null;
				created_by: string | null;
			}>(
				`SELECT * FROM sessions 
         WHERE project_key = $1 AND ended_at IS NULL 
         ORDER BY started_at DESC LIMIT 1`,
				[projectKeyParam],
			);

			return result.rows[0] || null;
		},

		async getSessionHistory(projectKeyParam, options?, _projectPath?) {
			const limit = options?.limit || 10;
			const offset = options?.offset || 0;

			const result = await db.query<{
				id: number;
				project_key: string;
				started_at: number;
				ended_at: number | null;
				active_cell_id: string | null;
				handoff_notes: string | null;
				created_by: string | null;
			}>(
				`SELECT * FROM sessions 
         WHERE project_key = $1 
         ORDER BY started_at DESC 
         LIMIT $2 OFFSET $3`,
				[projectKeyParam, limit, offset],
			);

			return result.rows;
		},

		async getDatabase(_projectPath?) {
			return db;
		},

		async close(_projectPath?) {
			if (db.close) {
				await db.close();
			}
		},

		async closeAll() {
			if (db.close) {
				await db.close();
			}
		},
	};
}

/**
 * Generate a unique cell ID with project-name prefix
 *
 * Format: {project-name}-{project-hash}-{timestamp}{random}
 * Example: swarm-mail-lf2p4u-mjbneh7mqah
 * Fallback: cell-{hash}-{timestamp}{random} (when no package.json or name)
 */
function generateCellId(projectKey: string): string {
	// Get project name prefix from package.json
	const prefix = getProjectPrefix(projectKey);

	// Simple hash of project key
	const hash = projectKey
		.split("")
		.reduce((acc, char) => ((acc << 5) - acc + char.charCodeAt(0)) | 0, 0)
		.toString(36)
		.slice(0, 6);

	// Use timestamp + random for uniqueness
	const timestamp = Date.now().toString(36);
	const random = Math.random().toString(36).slice(2, 5);

	return `${prefix}-${hash}-${timestamp}${random}`;
}

/**
 * Get project name prefix from package.json
 * Reads package.json from projectKey path and slugifies the name field
 * Falls back to 'cell' if package.json not found or has no name
 */
function getProjectPrefix(projectKey: string): string {
	try {
		// Try to read package.json from the project path
		const packageJsonPath = join(projectKey, "package.json");

		if (!existsSync(packageJsonPath)) {
			return "cell";
		}

		const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf-8"));

		if (!packageJson.name || typeof packageJson.name !== "string") {
			return "cell";
		}

		return slugifyProjectName(packageJson.name);
	} catch {
		// If anything goes wrong (read error, parse error, etc.), fallback to 'cell'
		return "cell";
	}
}

/**
 * Slugify project name for use in cell ID prefix
 * - Lowercase
 * - Replace spaces and special chars with dashes
 * - Remove leading/trailing dashes
 *
 * Examples:
 * - "My Cool App" -> "my-cool-app"
 * - "app@v2.0" -> "app-v2-0"
 * - "@scope/package" -> "scope-package"
 */
function slugifyProjectName(name: string): string {
	return name
		.toLowerCase()
		.replace(/[@/]/g, "-") // Replace @ and / with dash
		.replace(/[^a-z0-9-]/g, "-") // Replace any other non-alphanumeric with dash
		.replace(/-+/g, "-") // Collapse multiple dashes
		.replace(/^-+|-+$/g, ""); // Remove leading/trailing dashes
}
