/**
 * Database Consolidation Module
 *
 * Detects stray databases across a project and migrates them to the global database.
 */

import { join } from "node:path";
import type { Client, InArgs, ResultSet } from "@libsql/client";
import { DbClientFactory } from "./client-factory.js";
import { DbFileOps } from "./file-ops.js";

// ============================================================================
// Types
// ============================================================================

export type StrayLocation = "project-root" | "legacy-hive" | "nested-package";
export type SchemaVersion = "modern" | "legacy" | "unknown";
export type MigrationAction = "migrate" | "skip";

export interface StrayDatabase {
	path: string;
	location: StrayLocation;
}

export interface DatabaseAnalysis {
	tables: string[];
	rowCounts: Record<string, number>;
	schemaVersion: SchemaVersion;
	uniqueData: Record<string, number>;
	plan: {
		action: MigrationAction;
		reason?: string;
		estimatedRows: number;
	};
}

export interface MigrationResult {
	migrated: Record<string, number>;
	skipped: Record<string, number>;
	log: string[];
	summary: {
		totalMigrated: number;
		totalSkipped: number;
	};
	backupPath?: string;
}

export interface ConsolidationOptions {
	yes?: boolean;
	interactive?: boolean;
	skipBackup?: boolean;
}

export interface ConsolidationReport {
	straysFound: number;
	straysMigrated: number;
	totalRowsMigrated: number;
	migrations: Array<{
		path: string;
		location: StrayLocation;
		result: MigrationResult;
	}>;
	errors: string[];
}

// ============================================================================
// Detection Functions
// ============================================================================

export async function detectStrayDatabases(
	projectPath: string,
): Promise<StrayDatabase[]> {
	const strays: StrayDatabase[] = [];

	const checkDir = (dir: string, location: StrayLocation) => {
		if (DbFileOps.exists(dir)) {
			const files = DbFileOps.readdir(dir);
			for (const file of files) {
				if (
					file.endsWith(".db") &&
					!file.includes(".migrated") &&
					!file.includes(".backup-")
				) {
					strays.push({ path: join(dir, file), location });
				}
			}
		}
	};

	checkDir(join(projectPath, ".opencode"), "project-root");
	checkDir(join(projectPath, ".hive"), "legacy-hive");

	const packagesPath = join(projectPath, "packages");
	if (DbFileOps.exists(packagesPath)) {
		for (const pkg of DbFileOps.readdir(packagesPath)) {
			checkDir(join(packagesPath, pkg, ".opencode"), "nested-package");
		}
	}

	return strays;
}

// ============================================================================
// Analysis Functions
// ============================================================================

export async function analyzeStrayDatabase(
	strayPath: string,
	globalDbPath?: string,
): Promise<DatabaseAnalysis> {
	const managedStray = await DbClientFactory.getOrCreate(`file:${strayPath}`);
	const strayDb = managedStray.client;

	const tablesResult = await strayDb.execute(
		"SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
	);
	const tables = tablesResult.rows.map((row) => String(row.name));

	const rowCounts: Record<string, number> = {};
	for (const table of tables) {
		const countResult = await strayDb.execute(
			`SELECT COUNT(*) as count FROM ${table}`,
		);
		rowCounts[table] = Number(countResult.rows[0].count);
	}

	const schemaVersion = detectSchemaVersion(tables);
	const uniqueData: Record<string, number> = {};

	if (globalDbPath && DbFileOps.exists(globalDbPath)) {
		const managedGlobal = await DbClientFactory.getOrCreate(
			`file:${globalDbPath}`,
		);
		const globalDb = managedGlobal.client;

		for (const table of tables) {
			try {
				const globalCountResult = await globalDb.execute(
					`SELECT COUNT(*) as count FROM ${table}`,
				);
				uniqueData[table] = Math.max(
					0,
					rowCounts[table] - Number(globalCountResult.rows[0].count),
				);
			} catch {
				uniqueData[table] = rowCounts[table];
			}
		}
	} else {
		for (const table of tables) uniqueData[table] = rowCounts[table];
	}

	const totalRows = Object.values(rowCounts).reduce(
		(sum, count) => sum + count,
		0,
	);
	return {
		tables,
		rowCounts,
		schemaVersion,
		uniqueData,
		plan: {
			action: totalRows > 0 ? "migrate" : "skip",
			estimatedRows: totalRows,
		},
	};
}

function detectSchemaVersion(tables: string[]): SchemaVersion {
	const tableSet = new Set(tables);
	if (
		tableSet.has("events") &&
		tableSet.has("agents") &&
		tableSet.has("messages")
	)
		return "modern";
	if (tableSet.has("bead_events")) return "legacy";
	return "unknown";
}

// ============================================================================
// Migration Functions
// ============================================================================

const TABLE_COLUMNS: Record<string, string> = {
	events: "type, project_key, timestamp, data",
	agents:
		"project_key, name, program, model, task_description, registered_at, last_active_at",
	messages:
		"project_key, from_agent, subject, body, thread_id, importance, ack_required, created_at",
	message_recipients: "message_id, agent_name, read_at, acked_at",
	reservations:
		"project_key, agent_name, path_pattern, exclusive, reason, created_at, expires_at, released_at, lock_holder_id",
	cursors: "stream, checkpoint, position, updated_at",
	locks: "resource, holder, seq, acquired_at, expires_at",
	beads:
		"project_key, type, status, title, description, priority, parent_id, assignee, created_at, updated_at, closed_at, closed_reason, deleted_at, deleted_by, delete_reason, created_by",
	bead_dependencies:
		"cell_id, depends_on_id, relationship, created_at, created_by",
	bead_labels: "cell_id, label, created_at",
	bead_comments: "cell_id, author, body, parent_id, created_at, updated_at",
	blocked_beads_cache: "cell_id, blocker_ids, updated_at",
	dirty_beads: "cell_id, marked_at",
	eval_records:
		"project_key, task, context, strategy, epic_title, subtasks, outcomes, overall_success, total_duration_ms, total_errors, human_accepted, human_modified, human_notes, file_overlap_count, scope_accuracy, time_balance_ratio, created_at, updated_at",
	swarm_contexts:
		"project_key, epic_id, bead_id, strategy, files, dependencies, directives, recovery, created_at, checkpointed_at, recovered_at, recovered_from_checkpoint, updated_at",
	deferred: "url, resolved, value, error, expires_at, created_at",
};

export async function migrateToGlobal(
	strayPath: string,
	globalDbPath: string,
	options: { skipBackup?: boolean } = {},
): Promise<MigrationResult> {
	const migrated: Record<string, number> = {};
	const skipped: Record<string, number> = {};
	const log: string[] = [];

	const managedStray = await DbClientFactory.getOrCreate(`file:${strayPath}`);
	const managedGlobal = await DbClientFactory.getOrCreate(
		`file:${globalDbPath}`,
	);

	const tablesResult = await managedStray.client.execute(
		"SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
	);
	const tables = tablesResult.rows.map((row) => String(row.name));

	for (const table of tables) {
		const cols = TABLE_COLUMNS[table];
		if (!cols) continue;

		try {
			const rows = await managedStray.client.execute(
				`SELECT ${cols} FROM ${table}`,
			);
			let tableMigrated = 0;
			let tableSkipped = 0;

			for (const row of rows.rows) {
				const columnList = cols.split(",").map((c) => c.trim());
				const placeholders = columnList.map(() => "?").join(", ");
				const values = columnList.map((c) => row[c]);

				const result = await managedGlobal.client.execute({
					sql: `INSERT OR IGNORE INTO ${table} (${cols}) VALUES (${placeholders})`,
					args: values as InArgs,
				});

				if (result.rowsAffected > 0) tableMigrated++;
				else tableSkipped++;
			}

			migrated[table] = tableMigrated;
			skipped[table] = tableSkipped;
			if (tableMigrated > 0)
				log.push(`Migrated ${tableMigrated} from ${table}`);
		} catch (e) {
			log.push(`Failed table ${table}: ${e}`);
		}
	}

	await managedStray.close();
	const migratedPath = `${strayPath}.migrated`;
	await DbFileOps.rename(strayPath, migratedPath);

	const totalMigrated = Object.values(migrated).reduce((s, c) => s + c, 0);
	const totalSkipped = Object.values(skipped).reduce((s, c) => s + c, 0);

	return {
		migrated,
		skipped,
		log,
		summary: { totalMigrated, totalSkipped },
		backupPath: options.skipBackup ? undefined : migratedPath,
	};
}

export async function consolidateDatabases(
	projectPath: string,
	globalDbPath: string,
	options: ConsolidationOptions = {},
): Promise<ConsolidationReport> {
	const report: ConsolidationReport = {
		straysFound: 0,
		straysMigrated: 0,
		totalRowsMigrated: 0,
		migrations: [],
		errors: [],
	};
	const strays = await detectStrayDatabases(projectPath);
	report.straysFound = strays.length;

	for (const stray of strays) {
		try {
			const result = await migrateToGlobal(stray.path, globalDbPath, options);
			report.migrations.push({
				path: stray.path,
				location: stray.location,
				result,
			});
			report.straysMigrated++;
			report.totalRowsMigrated += result.summary.totalMigrated;
		} catch (err) {
			report.errors.push(`Failed ${stray.path}: ${err}`);
		}
	}

	return report;
}
