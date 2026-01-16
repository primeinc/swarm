import { join } from "node:path";
import type { Client, InArgs, ResultSet } from "@libsql/client";
import { DbClientFactory } from "../db/client-factory.js";
import { DbFileOps } from "../db/file-ops.js";
import { DbPathResolver } from "../db/paths.js";
import { createLibSQLStreamsSchema } from "./libsql-schema.js";

/**
 * Source database type
 */
export type SourceType = "libsql" | "none";

/**
 * Migration statistics for all tables
 */
export interface MigrationStats {
	events: number;
	agents: number;
	messages: number;
	messageRecipients: number;
	reservations: number;
	cursors: number;
	locks: number;
	beads: number;
	beadDependencies: number;
	beadLabels: number;
	beadComments: number;
	blockedBeadsCache: number;
	dirtyBeads: number;
	evalRecords: number;
	swarmContexts: number;
	deferred: number;
	errors: string[];
}

/**
 * Result of full project migration
 */
export interface MigrationResult {
	sourceType: SourceType;
	stats: MigrationStats;
	backupPath: string;
	globalDbPath: string;
}

/**
 * Check if project needs migration
 */
export function needsMigration(projectPath: string): boolean {
	const libsqlPath = join(projectPath, ".opencode", "streams.db");
	return DbFileOps.exists(libsqlPath);
}

/**
 * Get global database path
 */
export function getGlobalDbPath(): string {
	return DbPathResolver.getGlobalPath();
}

/**
 * Detect source database type
 */
export function detectSourceType(projectPath: string): SourceType {
	const libsqlPath = join(projectPath, ".opencode", "streams.db");
	if (DbFileOps.exists(libsqlPath)) return "libsql";
	return "none";
}

/**
 * Migrate project database to global database
 */
export async function migrateProjectToGlobal(
	projectPath: string,
	globalDbPath: string = getGlobalDbPath(),
): Promise<MigrationResult> {
	const sourceType = detectSourceType(projectPath);
	if (sourceType === "none") {
		throw new Error(`No database found at ${projectPath}/.opencode`);
	}

	// Ensure global DB schema exists
	const managedGlobal = await DbClientFactory.getOrCreate(
		`file:${globalDbPath}`,
	);
	await createLibSQLStreamsSchema(managedGlobal.adapter);

	let stats: MigrationStats;
	let sourcePath: string;

	if (sourceType === "libsql") {
		sourcePath = join(projectPath, ".opencode", "streams.db");
		stats = await migrateLibSQLToGlobal(sourcePath, managedGlobal.client);
	} else {
		throw new Error(`Unsupported source type: ${sourceType}`);
	}

	const backupPath = await backupOldDb(sourcePath);

	return { sourceType, stats, backupPath, globalDbPath };
}

/**
 * Migrate libSQL database to global database
 */
export async function migrateLibSQLToGlobal(
	sourcePath: string,
	globalDb: Client,
): Promise<MigrationStats> {
	const stats: MigrationStats = {
		events: 0,
		agents: 0,
		messages: 0,
		messageRecipients: 0,
		reservations: 0,
		cursors: 0,
		locks: 0,
		beads: 0,
		beadDependencies: 0,
		beadLabels: 0,
		beadComments: 0,
		blockedBeadsCache: 0,
		dirtyBeads: 0,
		evalRecords: 0,
		swarmContexts: 0,
		deferred: 0,
		errors: [],
	};

	const managedSource = await DbClientFactory.getOrCreate(`file:${sourcePath}`);
	const sourceDb = managedSource.client;

	const tablesResult = await sourceDb.execute(`
    SELECT name FROM sqlite_master 
    WHERE type='table' AND name NOT LIKE 'sqlite_%'
  `);

	const tableNames = new Set(tablesResult.rows.map((row) => String(row.name)));

	const tableCols: Record<string, string> = {
		events: "id, type, project_key, timestamp, data",
		agents:
			"id, project_key, name, program, model, task_description, registered_at, last_active_at",
		messages:
			"id, project_key, from_agent, subject, body, thread_id, importance, ack_required, created_at",
		message_recipients: "message_id, agent_name, read_at, acked_at",
		reservations:
			"id, project_key, agent_name, path_pattern, exclusive, reason, created_at, expires_at, released_at, lock_holder_id",
		cursors: "id, stream, checkpoint, position, updated_at",
		locks: "resource, holder, seq, acquired_at, expires_at",
		beads:
			"id, project_key, type, status, title, description, priority, parent_id, assignee, created_at, updated_at, closed_at, closed_reason, deleted_at, deleted_by, delete_reason, created_by",
		bead_dependencies:
			"cell_id, depends_on_id, relationship, created_at, created_by",
		bead_labels: "cell_id, label, created_at",
		bead_comments:
			"id, cell_id, author, body, parent_id, created_at, updated_at",
		blocked_beads_cache: "cell_id, blocker_ids, updated_at",
		dirty_beads: "cell_id, marked_at",
		eval_records:
			"id, project_key, task, context, strategy, epic_title, subtasks, outcomes, overall_success, total_duration_ms, total_errors, human_accepted, human_modified, human_notes, file_overlap_count, scope_accuracy, time_balance_ratio, created_at, updated_at",
		swarm_contexts:
			"id, project_key, epic_id, bead_id, strategy, files, dependencies, directives, recovery, created_at, checkpointed_at, recovered_at, recovered_from_checkpoint, updated_at",
		deferred: "id, url, resolved, value, error, expires_at, created_at",
	};

	const tableToStat: Record<string, keyof Omit<MigrationStats, "errors">> = {
		events: "events",
		agents: "agents",
		messages: "messages",
		message_recipients: "messageRecipients",
		reservations: "reservations",
		cursors: "cursors",
		locks: "locks",
		beads: "beads",
		bead_dependencies: "beadDependencies",
		bead_labels: "beadLabels",
		bead_comments: "beadComments",
		blocked_beads_cache: "blockedBeadsCache",
		dirty_beads: "dirtyBeads",
		eval_records: "evalRecords",
		swarm_contexts: "swarmContexts",
		deferred: "deferred",
	};

	for (const [table, cols] of Object.entries(tableCols)) {
		if (tableNames.has(table)) {
			const statKey = tableToStat[table];
			if (statKey) {
				stats[statKey] = await migrateTable(
					sourceDb,
					globalDb,
					table,
					cols,
					stats.errors,
				);
			}
		}
	}

	await managedSource.close();
	return stats;
}

/**
 * Migrate local libSQL database to global database
 */
export async function migrateLocalDbToGlobal(
	localDbPath: string,
	globalDbPath: string,
): Promise<MigrationStats> {
	const stats: MigrationStats = {
		events: 0,
		agents: 0,
		messages: 0,
		messageRecipients: 0,
		reservations: 0,
		cursors: 0,
		locks: 0,
		beads: 0,
		beadDependencies: 0,
		beadLabels: 0,
		beadComments: 0,
		blockedBeadsCache: 0,
		dirtyBeads: 0,
		evalRecords: 0,
		swarmContexts: 0,
		deferred: 0,
		errors: [],
	};

	const migratedPath = `${localDbPath}.migrated`;
	if (DbFileOps.exists(migratedPath)) return stats;
	if (!DbFileOps.exists(localDbPath)) return stats;

	const managedGlobal = await DbClientFactory.getOrCreate(
		`file:${globalDbPath}`,
	);
	const globalDb = managedGlobal.client;
	const managedLocal = await DbClientFactory.getOrCreate(`file:${localDbPath}`);
	const localDb = managedLocal.client;

	const tablesResult = await localDb.execute(`
    SELECT name FROM sqlite_master 
    WHERE type='table' AND name NOT LIKE 'sqlite_%'
  `);
	const tableNames = new Set(tablesResult.rows.map((row) => String(row.name)));

	const tableCols: Record<string, string> = {
		events: "id, type, project_key, timestamp, data",
		agents:
			"id, project_key, name, program, model, task_description, registered_at, last_active_at",
		messages:
			"id, project_key, from_agent, subject, body, thread_id, importance, ack_required, created_at",
		message_recipients: "message_id, agent_name, read_at, acked_at",
		reservations:
			"id, project_key, agent_name, path_pattern, exclusive, reason, created_at, expires_at, released_at, lock_holder_id",
		cursors: "id, stream, checkpoint, position, updated_at",
		locks: "resource, holder, seq, acquired_at, expires_at",
		beads:
			"id, project_key, type, status, title, description, priority, parent_id, assignee, created_at, updated_at, closed_at, closed_reason, deleted_at, deleted_by, delete_reason, created_by",
		bead_dependencies:
			"cell_id, depends_on_id, relationship, created_at, created_by",
		bead_labels: "cell_id, label, created_at",
		bead_comments:
			"id, cell_id, author, body, parent_id, created_at, updated_at",
		blocked_beads_cache: "cell_id, blocker_ids, updated_at",
		dirty_beads: "cell_id, marked_at",
		eval_records:
			"id, project_key, task, context, strategy, epic_title, subtasks, outcomes, overall_success, total_duration_ms, total_errors, human_accepted, human_modified, human_notes, file_overlap_count, scope_accuracy, time_balance_ratio, created_at, updated_at",
		swarm_contexts:
			"id, project_key, epic_id, bead_id, strategy, files, dependencies, directives, recovery, created_at, checkpointed_at, recovered_at, recovered_from_checkpoint, updated_at",
		deferred: "id, url, resolved, value, error, expires_at, created_at",
	};

	const tableToStat: Record<string, keyof Omit<MigrationStats, "errors">> = {
		events: "events",
		agents: "agents",
		messages: "messages",
		message_recipients: "messageRecipients",
		reservations: "reservations",
		cursors: "cursors",
		locks: "locks",
		beads: "beads",
		bead_dependencies: "beadDependencies",
		bead_labels: "beadLabels",
		bead_comments: "beadComments",
		blocked_beads_cache: "blockedBeadsCache",
		dirty_beads: "dirtyBeads",
		eval_records: "evalRecords",
		swarm_contexts: "swarmContexts",
		deferred: "deferred",
	};

	for (const [table, cols] of Object.entries(tableCols)) {
		if (tableNames.has(table)) {
			const statKey = tableToStat[table];
			if (statKey) {
				stats[statKey] = await migrateTable(
					localDb,
					globalDb,
					table,
					cols,
					stats.errors,
				);
			}
		}
	}

	await managedLocal.close();
	await DbFileOps.rename(localDbPath, migratedPath);
	return stats;
}

/**
 * Backup old database
 */
export async function backupOldDb(path: string): Promise<string> {
	if (!DbFileOps.exists(path)) throw new Error(`Database not found: ${path}`);
	const timestamp = new Date().toISOString().replace(/:/g, "-");
	const backupPath = `${path}.backup-${timestamp}`;
	await DbFileOps.rename(path, backupPath);
	return backupPath;
}

/**
 * Migrate a single table using INSERT OR IGNORE
 */
async function migrateTable(
	sourceDb: Client,
	globalDb: Client,
	tableName: string,
	targetColumns: string,
	errors: string[],
): Promise<number> {
	try {
		const schemaResult = await sourceDb.execute(
			`PRAGMA table_info(${tableName})`,
		);
		const sourceColumnNames = new Set(
			schemaResult.rows.map((row) => row.name as string),
		);
		const targetColumnList = targetColumns.split(",").map((c) => c.trim());
		const columnList = targetColumnList.filter((col) =>
			sourceColumnNames.has(col),
		);

		if (columnList.length === 0) {
			errors.push(`${tableName}: No compatible columns`);
			return 0;
		}

		const columns = columnList.join(", ");
		const rows = await sourceDb.execute(`SELECT ${columns} FROM ${tableName}`);
		if (rows.rows.length === 0) return 0;

		const placeholders = columnList.map(() => "?").join(", ");
		let migrated = 0;

		for (const row of rows.rows) {
			try {
				const values = columnList.map((col) => row[col]);
				const result = await globalDb.execute({
					sql: `INSERT OR IGNORE INTO ${tableName} (${columns}) VALUES (${placeholders})`,
					args: values as InArgs,
				});
				if (result.rowsAffected > 0) migrated++;
			} catch (err) {
				errors.push(
					`${tableName}: ${err instanceof Error ? err.message : String(err)}`,
				);
			}
		}
		return migrated;
	} catch (err) {
		errors.push(
			`${tableName} (table): ${err instanceof Error ? err.message : String(err)}`,
		);
		return 0;
	}
}
