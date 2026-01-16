import type { DatabaseAdapter } from "./types/database.js";

/**
 * Analytics query definition for pre-built queries.
 * Based on Google's Four Golden Signals: Latency, Traffic, Errors, Saturation.
 */
export interface AnalyticsQuery {
	/** Short name for CLI reference (e.g., "latency", "traffic") */
	name: string;
	/** Human-readable description */
	description: string;
	/** Parameterized SQL query (use ? placeholders for since/until) */
	sql: string;
	/** Format query results as string (table/json/csv handled by caller) */
	format: (rows: unknown[]) => string;
}

/**
 * Pre-built analytics queries for swarm-db CLI.
 * Based on Four Golden Signals monitoring framework.
 */
export const ANALYTICS_QUERIES: AnalyticsQuery[] = [
	{
		name: "latency",
		description:
			"Task Duration by Strategy - Average and P95 task completion times",
		sql: `
			SELECT 
				json_extract(data, '$.strategy') as strategy,
				COUNT(*) as task_count,
				CAST(AVG(json_extract(data, '$.duration_ms')) AS INTEGER) as avg_duration_ms,
				CAST(AVG(json_extract(data, '$.duration_ms')) / 1000 AS INTEGER) as avg_duration_sec
			FROM events
			WHERE type = 'subtask_outcome'
				AND (? IS NULL OR timestamp >= ?)
				AND (? IS NULL OR timestamp <= ?)
			GROUP BY json_extract(data, '$.strategy')
			ORDER BY avg_duration_ms DESC
		`,
		format: (rows) => {
			if (!Array.isArray(rows) || rows.length === 0) {
				return "No data";
			}
			return JSON.stringify(rows, null, 2);
		},
	},
	{
		name: "traffic",
		description: "Events per Hour - Event volume over time",
		sql: `
			SELECT 
				strftime('%Y-%m-%d %H:00', datetime(timestamp / 1000, 'unixepoch')) as hour,
				COUNT(*) as event_count,
				type as event_type
			FROM events
			WHERE (? IS NULL OR timestamp >= ?)
				AND (? IS NULL OR timestamp <= ?)
			GROUP BY hour, type
			ORDER BY hour DESC, event_count DESC
		`,
		format: (rows) => {
			if (!Array.isArray(rows) || rows.length === 0) {
				return "No data";
			}
			return JSON.stringify(rows, null, 2);
		},
	},
	{
		name: "errors",
		description: "Failed Tasks by Agent - Track failure rates per agent",
		sql: `
			SELECT 
				json_extract(data, '$.agent') as agent,
				COUNT(*) as failed_count,
				GROUP_CONCAT(DISTINCT json_extract(data, '$.bead_id')) as failed_beads
			FROM events
			WHERE type = 'subtask_outcome'
				AND json_extract(data, '$.success') = 0
				AND (? IS NULL OR timestamp >= ?)
				AND (? IS NULL OR timestamp <= ?)
			GROUP BY json_extract(data, '$.agent')
			ORDER BY failed_count DESC
		`,
		format: (rows) => {
			if (!Array.isArray(rows) || rows.length === 0) {
				return "No data";
			}
			return JSON.stringify(rows, null, 2);
		},
	},
	{
		name: "saturation",
		description: "Active Reservations - Currently held file locks",
		sql: `
			SELECT 
				json_extract(created.data, '$.agent') as agent,
				json_extract(created.data, '$.id') as reservation_id,
				json_extract(created.data, '$.paths') as paths,
				datetime(created.timestamp / 1000, 'unixepoch') as created_at
			FROM events created
			WHERE created.type = 'reservation_created'
				AND NOT EXISTS (
					SELECT 1 FROM events released
					WHERE released.type = 'reservation_released'
						AND json_extract(released.data, '$.id') = json_extract(created.data, '$.id')
				)
				AND (? IS NULL OR created.timestamp >= ?)
				AND (? IS NULL OR created.timestamp <= ?)
			ORDER BY created.timestamp DESC
		`,
		format: (rows) => {
			if (!Array.isArray(rows) || rows.length === 0) {
				return "No active reservations";
			}
			return JSON.stringify(rows, null, 2);
		},
	},
	{
		name: "conflicts",
		description: "Most Contested Files - Files with highest reservation counts",
		sql: `
			SELECT 
				paths.value as path,
				COUNT(*) as reservation_count,
				COUNT(DISTINCT json_extract(events.data, '$.agent')) as unique_agents
			FROM events,
				json_each(events.data, '$.paths') as paths
			WHERE events.type = 'reservation_created'
				AND (? IS NULL OR events.timestamp >= ?)
				AND (? IS NULL OR events.timestamp <= ?)
			GROUP BY paths.value
			ORDER BY reservation_count DESC
			LIMIT 20
		`,
		format: (rows) => {
			if (!Array.isArray(rows) || rows.length === 0) {
				return "No file conflicts";
			}
			return JSON.stringify(rows, null, 2);
		},
	},
];

/**
 * Run a pre-built analytics query against the database.
 *
 * @param db Database adapter
 * @param queryName Name of the query to run (e.g., "latency", "traffic")
 * @param options Query options
 * @param options.since Filter events after this timestamp
 * @param options.until Filter events before this timestamp
 * @param options.format Output format: "table" (default), "json", or "csv"
 * @returns Formatted query results as string
 *
 * @throws Error if query name is not found
 *
 * @example
 * ```typescript
 * const db = await createInMemoryDatabaseAdapter();
 * const result = await runAnalyticsQuery(db, "latency", { format: "json" });
 * console.log(result);
 * ```
 */
export async function runAnalyticsQuery(
	db: DatabaseAdapter,
	queryName: string,
	options?: {
		since?: Date;
		until?: Date;
		format?: "table" | "json" | "csv";
	},
): Promise<string> {
	const query = ANALYTICS_QUERIES.find((q) => q.name === queryName);
	if (!query) {
		throw new Error(
			`Unknown analytics query: ${queryName}. Available: ${ANALYTICS_QUERIES.map((q) => q.name).join(", ")}`,
		);
	}

	const format = options?.format ?? "table";

	// Convert Date to Unix timestamp in milliseconds for SQL
	const sinceMs = options?.since?.getTime() ?? null;
	const untilMs = options?.until?.getTime() ?? null;

	// Execute query with parameterized values
	const result = await db.query<Record<string, unknown>>(query.sql, [
		sinceMs,
		sinceMs,
		untilMs,
		untilMs,
	]);

	const rows = result.rows;

	// Format output based on requested format
	if (format === "json") {
		return JSON.stringify(rows, null, 2);
	}

	if (format === "csv") {
		if (rows.length === 0) {
			return "";
		}
		const headers = Object.keys(rows[0]);
		const csvHeader = headers.join(",");
		const csvRows = rows.map((row: Record<string, unknown>) =>
			headers.map((h) => JSON.stringify(row[h] ?? "")).join(","),
		);
		return [csvHeader, ...csvRows].join("\n");
	}

	// Default: table format (use query's custom formatter)
	return query.format(rows);
}
