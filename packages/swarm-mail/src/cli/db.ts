/**
 * CLI DB Commands Implementation
 *
 * Implements swarm-db CLI commands:
 * - query: execute raw SQL
 * - analytics: run pre-built queries
 * - list: show available analytics
 */

import * as formatters from "../analytics/formatters.js";
import * as queries from "../analytics/queries/index.js";
import type { OutputFormat, QueryResult } from "../analytics/types.js";
import { createLibSQLAdapter } from "../libsql.js";
import type { DatabaseAdapter } from "../types/database.js";

/**
 * Analytics command definition
 */
export interface AnalyticsCommand {
	name: string;
	description: string;
}

/**
 * Options for executeQueryCommand
 */
export interface QueryOptions {
	sql: string;
	db: string;
	format: OutputFormat;
	limit?: number;
}

/**
 * Options for executeAnalyticsCommand
 */
export interface AnalyticsOptions {
	command: string;
	db: string;
	format: OutputFormat;
	since?: string;
	until?: string;
	project?: string;
	epic?: string;
}

/**
 * Validate SQL query is read-only (SELECT only).
 *
 * @param sql - SQL query to validate
 * @throws Error if query is not a SELECT
 */
export function validateSQL(sql: string): void {
	const trimmed = sql.trim();

	if (trimmed.length === 0) {
		throw new Error("SQL query cannot be empty");
	}

	// Check if query starts with SELECT (case-insensitive)
	if (!trimmed.match(/^select\s/i)) {
		throw new Error(
			"Only SELECT queries allowed for safety. Use analytics commands for pre-built queries.",
		);
	}
}

/**
 * Parse time range string (7d, 24h, 30m) into a Date.
 *
 * @param range - Time range string (e.g., "7d", "24h", "30m")
 * @returns Date object representing the point in time
 * @throws Error if format is invalid
 */
export function parseTimeRange(range: string): Date {
	const match = range.match(/^(\d+)(d|h|m)$/);

	if (!match) {
		throw new Error(
			"Invalid time range format. Use format like: 7d, 24h, 30m (days, hours, minutes)",
		);
	}

	const value = Number.parseInt(match[1], 10);
	const unit = match[2];

	if (value < 0) {
		throw new Error("Invalid time range format. Value must be positive.");
	}

	const now = Date.now();
	let offset = 0;

	switch (unit) {
		case "d":
			offset = value * 24 * 60 * 60 * 1000;
			break;
		case "h":
			offset = value * 60 * 60 * 1000;
			break;
		case "m":
			offset = value * 60 * 1000;
			break;
	}

	return new Date(now - offset);
}

/**
 * List all available analytics commands with descriptions.
 *
 * @returns Array of analytics command definitions
 */
export function listAnalyticsCommands(): AnalyticsCommand[] {
	return [
		{
			name: "failed-decompositions",
			description:
				"Analyze decomposition failures by strategy with failure counts and average duration",
		},
		{
			name: "strategy-success-rates",
			description:
				"Calculate success rate percentage per strategy with total/successful/failed counts",
		},
		{
			name: "lock-contention",
			description:
				"Identify files with most reservations and compute average hold time",
		},
		{
			name: "agent-activity",
			description:
				"Track agent event counts, first/last timestamps, and active time spans",
		},
		{
			name: "message-latency",
			description:
				"Compute p50/p95/p99 latency percentiles for inter-agent messaging",
		},
		{
			name: "scope-violations",
			description: "Detect when agents modify files outside their reservations",
		},
		{
			name: "task-duration",
			description: "Analyze task completion times grouped by type or strategy",
		},
		{
			name: "checkpoint-frequency",
			description: "Track checkpoint creation patterns across agents and epics",
		},
		{
			name: "recovery-success",
			description:
				"Measure success rate of task recovery from checkpoints after failures",
		},
		{
			name: "human-feedback",
			description:
				"Aggregate human review feedback scores and rejection reasons",
		},
	];
}

/**
 * Execute a raw SQL query command.
 *
 * @param options - Query options including SQL, database path, format, and limit
 * @returns Formatted query result as string
 */
export async function executeQueryCommand(
	options: QueryOptions,
): Promise<string> {
	const { sql, db, format, limit = 1000 } = options;

	// Validate SQL is read-only
	validateSQL(sql);

	// Create database adapter
	const adapter = await createLibSQLAdapter({ url: db });

	// Execute query with row limit
	const limitedSQL = `${sql} LIMIT ${limit}`;
	const startTime = Date.now();
	const dbResult = await adapter.query<Record<string, unknown>>(limitedSQL);
	const executionTimeMs = Date.now() - startTime;

	// Transform to QueryResult format
	const rows = dbResult.rows;
	const columns = rows.length > 0 ? Object.keys(rows[0]) : [];
	const queryResult: QueryResult = {
		columns,
		rows,
		rowCount: rows.length,
		executionTimeMs,
	};

	// Format output
	return formatOutput(queryResult, format);
}

/**
 * Execute an analytics command.
 *
 * @param options - Analytics options including command name, filters, and format
 * @returns Formatted query result as string
 */
export async function executeAnalyticsCommand(
	options: AnalyticsOptions,
): Promise<string> {
	const { command, db, format, since, until, project, epic } = options;

	// Validate command exists
	const validCommands = listAnalyticsCommands().map((c) => c.name);
	if (!validCommands.includes(command)) {
		throw new Error(
			`Unknown analytics command: ${command}\nRun 'swarm-db list' to see available commands.`,
		);
	}

	// Build filters object
	const filters: Record<string, unknown> = {};
	if (project) filters.project_key = project;
	if (epic) filters.epic_id = epic;
	if (since) filters.since = parseTimeRange(since);
	if (until) filters.until = parseTimeRange(until);

	// Get the query builder function
	const queryFn = getQueryFunction(command);
	const analyticsQuery = queryFn(filters);

	// Create database adapter
	const adapter = await createLibSQLAdapter({ url: db });

	// Execute query
	const startTime = Date.now();
	const result = await executeAnalyticsQuery(adapter, analyticsQuery);
	const executionTimeMs = Date.now() - startTime;

	// Add execution time to result
	const queryResult: QueryResult = {
		...result,
		executionTimeMs,
	};

	// Format output
	return formatOutput(queryResult, format);
}

/**
 * Get query function by command name.
 *
 * @param command - Analytics command name
 * @returns Query builder function
 */
function getQueryFunction(command: string): (
	filters?: Record<string, unknown>,
) => {
	name: string;
	description: string;
	sql: string;
	parameters?: Record<string, unknown>;
} {
	// TypeScript has issues with the query function types, but they work correctly at runtime
	// biome-ignore lint/suspicious/noExplicitAny: Query functions have complex inferred types
	switch (command) {
		case "failed-decompositions":
			return queries.failedDecompositions as any;
		case "strategy-success-rates":
			return queries.strategySuccessRates as any;
		case "lock-contention":
			return queries.lockContention as any;
		case "agent-activity":
			return queries.agentActivity as any;
		case "message-latency":
			return queries.messageLatency as any;
		case "scope-violations":
			return queries.scopeViolations as any;
		case "task-duration":
			return queries.taskDuration as any;
		case "checkpoint-frequency":
			return queries.checkpointFrequency as any;
		case "recovery-success":
			return queries.recoverySuccess as any;
		case "human-feedback":
			return queries.humanFeedback as any;
		default:
			throw new Error(`Unknown analytics command: ${command}`);
	}
}

/**
 * Execute an analytics query against the database.
 *
 * @param db - Database adapter
 * @param query - Analytics query to execute
 * @returns Query result with columns and rows
 */
async function executeAnalyticsQuery(
	db: DatabaseAdapter,
	query: {
		sql: string;
		parameters?: Record<string, unknown>;
	},
): Promise<{
	columns: string[];
	rows: Record<string, unknown>[];
	rowCount: number;
}> {
	// Extract parameters as array (in order of appearance)
	const params = query.parameters ? Object.values(query.parameters) : [];

	// Execute query
	const dbResult = await db.query<Record<string, unknown>>(query.sql, params);

	// Extract columns from first row
	const rows = dbResult.rows;
	const columns = rows.length > 0 ? Object.keys(rows[0]) : [];

	return {
		columns,
		rows,
		rowCount: rows.length,
	};
}

/**
 * Format query result based on output format.
 *
 * @param result - Query result to format
 * @param format - Output format (table, json, csv, jsonl)
 * @returns Formatted string
 */
function formatOutput(result: QueryResult, format: OutputFormat): string {
	switch (format) {
		case "table":
			return formatters.formatTable(result);
		case "json":
			return formatters.formatJSON(result);
		case "csv":
			return formatters.formatCSV(result);
		case "jsonl":
			return formatters.formatJSONL(result);
		default:
			throw new Error(`Unknown output format: ${format}`);
	}
}
