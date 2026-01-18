/**
 * Observability Tools - Agent-facing Analytics
 *
 * Exposes observability tools to agents via plugin tools.
 * Agents get programmatic access to analytics, not just CLI.
 *
 * Tools:
 * - swarm_analytics: Query pre-built analytics
 * - swarm_query: Raw SQL for power users
 * - swarm_diagnose: Auto-diagnosis for epic/task
 * - swarm_insights: Generate learning insights
 */

import { tool } from "@opencode-ai/plugin";
import {
	type AnalyticsQuery,
	agentActivity,
	checkpointFrequency,
	failedDecompositions,
	getSwarmMailLibSQL,
	humanFeedback,
	lockContention,
	messageLatency,
	recoverySuccess,
	type SwarmMailAdapter,
	scopeViolations,
	strategySuccessRates,
	taskDuration,
} from "swarm-mail";

// ============================================================================
// Types
// ============================================================================

interface ToolContext {
	sessionID: string;
}

export interface SwarmAnalyticsArgs {
	query:
		| "failed-decompositions"
		| "strategy-success-rates"
		| "lock-contention"
		| "agent-activity"
		| "message-latency"
		| "scope-violations"
		| "task-duration"
		| "checkpoint-frequency"
		| "recovery-success"
		| "human-feedback";
	since?: string; // "7d", "24h", "1h"
	format?: "json" | "summary";
}

export interface SwarmQueryArgs {
	sql: string;
	format?: "json" | "table";
}

export interface SwarmDiagnoseArgs {
	epic_id?: string;
	cell_id?: string;
	include?: Array<
		"blockers" | "conflicts" | "slow_tasks" | "errors" | "timeline"
	>;
}

export interface SwarmInsightsArgs {
	scope: "epic" | "project" | "recent";
	epic_id?: string;
	metrics: Array<
		"success_rate" | "avg_duration" | "conflict_rate" | "retry_rate"
	>;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Parse "since" time string to milliseconds
 * @param since - Time string like "7d", "24h", "1h"
 * @returns Timestamp in milliseconds
 */
function parseSince(since: string): number {
	const now = Date.now();
	const match = since.match(/^(\d+)([dhm])$/);
	if (!match) {
		throw new Error(`Invalid since format: ${since}. Use "7d", "24h", or "1h"`);
	}

	const [, value, unit] = match;
	const num = Number.parseInt(value, 10);

	switch (unit) {
		case "d":
			return now - num * 24 * 60 * 60 * 1000;
		case "h":
			return now - num * 60 * 60 * 1000;
		case "m":
			return now - num * 60 * 1000;
		default:
			throw new Error(`Unknown unit: ${unit}`);
	}
}

/**
 * Execute analytics query and return results
 */
async function executeQuery(
	swarmMail: SwarmMailAdapter,
	query: AnalyticsQuery,
): Promise<unknown[]> {
	// Get the underlying database adapter
	const db = await swarmMail.getDatabase();

	// Execute the query
	const result = await db.query(
		query.sql,
		Object.values(query.parameters || {}),
	);

	return result.rows as unknown[];
}

/**
 * Format results as summary (context-efficient)
 */
function formatSummary(queryType: string, results: unknown[]): string {
	if (results.length === 0) {
		return `No ${queryType} data found.`;
	}

	const count = results.length;
	const preview = results.slice(0, 3);

	return `${queryType}: ${count} result(s). Top 3: ${JSON.stringify(preview, null, 2).slice(0, 400)}`;
}

/**
 * Cap results at max 50 rows
 */
function capResults(results: unknown[]): unknown[] {
	return results.slice(0, 50);
}

// ============================================================================
// Tools
// ============================================================================

/**
 * swarm_analytics - Query pre-built analytics
 *
 * Provides access to 10 pre-built analytics queries for swarm coordination.
 */
const swarm_analytics = tool({
	description:
		"Query pre-built analytics for swarm coordination. Returns structured data about failed decompositions, strategy success rates, lock contention, agent activity, message latency, scope violations, task duration, checkpoint frequency, recovery success, and human feedback.",
	args: {
		query: tool.schema
			.enum([
				"failed-decompositions",
				"strategy-success-rates",
				"lock-contention",
				"agent-activity",
				"message-latency",
				"scope-violations",
				"task-duration",
				"checkpoint-frequency",
				"recovery-success",
				"human-feedback",
			])
			.describe("Type of analytics query to run"),
		since: tool.schema
			.string()
			.optional()
			.describe("Time filter: '7d', '24h', '1h' (optional)"),
		format: tool.schema
			.enum(["json", "summary"])
			.optional()
			.describe(
				"Output format: 'json' (default) or 'summary' (context-efficient)",
			),
	},
	async execute(args: SwarmAnalyticsArgs): Promise<string> {
		try {
			const projectPath = process.cwd(); // TODO: Get from session state
			const db = await getSwarmMailLibSQL(projectPath);

			// Build filters
			const filters: Record<string, string | number> = {
				project_key: projectPath,
			};

			if (args.since) {
				filters.since = parseSince(args.since);
			}

			// Map query type to query function or object
			let query: AnalyticsQuery;
			switch (args.query) {
				case "failed-decompositions":
					query = failedDecompositions(filters);
					break;
				case "strategy-success-rates":
					query = strategySuccessRates(filters);
					break;
				case "lock-contention":
					query = lockContention(filters);
					break;
				case "agent-activity":
					query = agentActivity(filters);
					break;
				case "message-latency":
					query = messageLatency(filters);
					break;
				case "scope-violations":
					query = scopeViolations.buildQuery
						? scopeViolations.buildQuery(filters)
						: scopeViolations;
					break;
				case "task-duration":
					query = taskDuration.buildQuery
						? taskDuration.buildQuery(filters)
						: taskDuration;
					break;
				case "checkpoint-frequency":
					query = checkpointFrequency.buildQuery
						? checkpointFrequency.buildQuery(filters)
						: checkpointFrequency;
					break;
				case "recovery-success":
					query = recoverySuccess.buildQuery
						? recoverySuccess.buildQuery(filters)
						: recoverySuccess;
					break;
				case "human-feedback":
					query = humanFeedback.buildQuery
						? humanFeedback.buildQuery(filters)
						: humanFeedback;
					break;
				default:
					return JSON.stringify({
						error: `Unknown query type: ${args.query}`,
					});
			}

			// Execute query
			const results = await executeQuery(db, query);

			// Format output
			if (args.format === "summary") {
				return formatSummary(args.query, results);
			}

			return JSON.stringify(
				{
					query: args.query,
					filters,
					count: results.length,
					results,
				},
				null,
				2,
			);
		} catch (error) {
			return JSON.stringify({
				error: error instanceof Error ? error.message : String(error),
			});
		}
	},
});

/**
 * swarm_query - Raw SQL for power users
 *
 * Execute arbitrary SQL queries with context safety (max 50 rows).
 */
const swarm_query = tool({
	description:
		"Execute raw SQL queries against the swarm event store. Context-safe: results capped at 50 rows. Useful for custom analytics and debugging.",
	args: {
		sql: tool.schema
			.string()
			.describe("SQL query to execute (SELECT only for safety)"),
		format: tool.schema
			.enum(["json", "table"])
			.optional()
			.describe("Output format: 'json' (default) or 'table' (visual)"),
	},
	async execute(args: SwarmQueryArgs): Promise<string> {
		try {
			const projectPath = process.cwd(); // TODO: Get from session state
			const swarmMail = await getSwarmMailLibSQL(projectPath);
			const db = await swarmMail.getDatabase();

			// Safety: Only allow SELECT queries
			if (!args.sql.trim().toLowerCase().startsWith("select")) {
				return JSON.stringify({
					error: "Only SELECT queries are allowed for safety",
				});
			}

			// Execute query via adapter
			const result = await db.query(args.sql, []);
			const rows = result.rows as unknown[];

			// Cap at 50 rows
			const cappedRows = capResults(rows);

			// Format output
			if (args.format === "table") {
				// Simple table format
				if (cappedRows.length === 0) {
					return "No results";
				}

				const headers = Object.keys(cappedRows[0] as Record<string, unknown>);
				const headerRow = headers.join(" | ");
				const separator = headers.map(() => "---").join(" | ");
				const dataRows = cappedRows.map((row) =>
					headers.map((h) => (row as Record<string, unknown>)[h]).join(" | "),
				);

				return [headerRow, separator, ...dataRows].join("\n");
			}

			return JSON.stringify(
				{
					count: cappedRows.length,
					total: rows.length,
					capped: rows.length > 50,
					results: cappedRows,
				},
				null,
				2,
			);
		} catch (error) {
			return JSON.stringify({
				error: error instanceof Error ? error.message : String(error),
			});
		}
	},
});

/**
 * swarm_diagnose - Auto-diagnosis for epic/task
 *
 * Analyzes a specific epic or task and returns structured diagnosis.
 */
const swarm_diagnose = tool({
	description:
		"Auto-diagnose issues for a specific epic or task. Returns structured diagnosis with blockers, conflicts, slow tasks, errors, and timeline.",
	args: {
		epic_id: tool.schema.string().optional().describe("Epic ID to diagnose"),
		cell_id: tool.schema.string().optional().describe("Task ID to diagnose"),
		include: tool.schema
			.array(
				tool.schema.enum([
					"blockers",
					"conflicts",
					"slow_tasks",
					"errors",
					"timeline",
				]),
			)
			.optional()
			.describe("What to include in diagnosis (default: all)"),
	},
	async execute(args: SwarmDiagnoseArgs): Promise<string> {
		try {
			const projectPath = process.cwd();
			const swarmMail = await getSwarmMailLibSQL(projectPath);

			// Get the underlying database adapter
			const db = await swarmMail.getDatabase();

			const diagnosis: Array<{
				type: string;
				message: string;
				severity: string;
			}> = [];
			const include = args.include || [
				"blockers",
				"conflicts",
				"slow_tasks",
				"errors",
				"timeline",
			];

			// Query for blockers
			if (include.includes("blockers")) {
				const blockerQuery = `
					SELECT json_extract(data, '$.agent_name') as agent,
					       json_extract(data, '$.cell_id') as cell_id,
					       timestamp
					FROM events
					WHERE type = 'task_blocked'
					${args.epic_id ? "AND json_extract(data, '$.epic_id') = ?" : ""}
					${args.cell_id ? "AND json_extract(data, '$.cell_id') = ?" : ""}
					ORDER BY timestamp DESC
					LIMIT 10
				`;

				const params = [];
				if (args.epic_id) params.push(args.epic_id);
				if (args.cell_id) params.push(args.cell_id);

				const blockers = await db.query(blockerQuery, params);
				if (blockers.rows.length > 0) {
					diagnosis.push({
						type: "blockers",
						message: `Found ${blockers.rows.length} blocked task(s)`,
						severity: "high",
					});
				}
			}

			// Query for errors
			if (include.includes("errors")) {
				const errorQuery = `
					SELECT type, json_extract(data, '$.success') as success
					FROM events
					WHERE type = 'subtask_outcome'
					AND json_extract(data, '$.success') = 0
					${args.epic_id ? "AND json_extract(data, '$.epic_id') = ?" : ""}
					${args.cell_id ? "AND json_extract(data, '$.cell_id') = ?" : ""}
					LIMIT 10
				`;

				const params = [];
				if (args.epic_id) params.push(args.epic_id);
				if (args.cell_id) params.push(args.cell_id);

				const errors = await db.query(errorQuery, params);
				if (errors.rows.length > 0) {
					diagnosis.push({
						type: "errors",
						message: `Found ${errors.rows.length} failed task(s)`,
						severity: "high",
					});
				}
			}

			// Build timeline if requested
			let timeline: unknown[] = [];
			if (include.includes("timeline")) {
				const timelineQuery = `
					SELECT timestamp, type, json_extract(data, '$.agent_name') as agent
					FROM events
					${args.epic_id ? "WHERE json_extract(data, '$.epic_id') = ?" : ""}
					${args.cell_id ? (args.epic_id ? "AND" : "WHERE") + " json_extract(data, '$.cell_id') = ?" : ""}
					ORDER BY timestamp DESC
					LIMIT 20
				`;

				const params = [];
				if (args.epic_id) params.push(args.epic_id);
				if (args.cell_id) params.push(args.cell_id);

				const events = await db.query(timelineQuery, params);
				timeline = events.rows;
			}

			return JSON.stringify(
				{
					epic_id: args.epic_id,
					cell_id: args.cell_id,
					diagnosis,
					timeline: include.includes("timeline") ? timeline : undefined,
				},
				null,
				2,
			);
		} catch (error) {
			return JSON.stringify({
				error: error instanceof Error ? error.message : String(error),
			});
		}
	},
});

/**
 * swarm_insights - Generate learning insights
 *
 * Analyzes metrics and generates actionable insights.
 */
const swarm_insights = tool({
	description:
		"Generate learning insights from swarm coordination metrics. Analyzes success rates, duration, conflicts, and retries to provide actionable recommendations.",
	args: {
		scope: tool.schema
			.enum(["epic", "project", "recent"])
			.describe("Scope of analysis: 'epic', 'project', or 'recent'"),
		epic_id: tool.schema
			.string()
			.optional()
			.describe("Epic ID (required if scope='epic')"),
		metrics: tool.schema
			.array(
				tool.schema.enum([
					"success_rate",
					"avg_duration",
					"conflict_rate",
					"retry_rate",
				]),
			)
			.describe("Metrics to analyze"),
	},
	async execute(args: SwarmInsightsArgs): Promise<string> {
		try {
			// Validate args
			if (args.scope === "epic" && !args.epic_id) {
				return JSON.stringify({
					error: "epic_id is required when scope='epic'",
				});
			}

			const projectPath = process.cwd();
			const swarmMail = await getSwarmMailLibSQL(projectPath);
			const db = await swarmMail.getDatabase();

			const insights: Array<{
				metric: string;
				value: string | number;
				insight: string;
			}> = [];

			// Calculate success rate
			if (args.metrics.includes("success_rate")) {
				const query = `
					SELECT
						SUM(CASE WHEN json_extract(data, '$.success') = 1 THEN 1 ELSE 0 END) as successes,
						COUNT(*) as total
					FROM events
					WHERE type = 'subtask_outcome'
					${args.epic_id ? "AND json_extract(data, '$.epic_id') = ?" : ""}
				`;

				const result = await db.query(
					query,
					args.epic_id ? [args.epic_id] : [],
				);
				const row = result.rows[0] as { successes: number; total: number };

				if (row && row.total > 0) {
					const rate = (row.successes / row.total) * 100;
					insights.push({
						metric: "success_rate",
						value: `${rate.toFixed(1)}%`,
						insight:
							rate < 50
								? "Low success rate - review decomposition strategy"
								: rate < 80
									? "Moderate success rate - monitor for patterns"
									: "Good success rate - maintain current approach",
					});
				}
			}

			// Calculate average duration
			if (args.metrics.includes("avg_duration")) {
				const query = `
					SELECT AVG(CAST(json_extract(data, '$.duration_ms') AS REAL)) as avg_duration
					FROM events
					WHERE type = 'subtask_outcome'
					AND json_extract(data, '$.success') = 1
					AND json_extract(data, '$.duration_ms') IS NOT NULL
					${args.epic_id ? "AND json_extract(data, '$.epic_id') = ?" : ""}
				`;

				const result = await db.query(
					query,
					args.epic_id ? [args.epic_id] : [],
				);
				const row = result.rows[0] as { avg_duration: number };

				if (row?.avg_duration) {
					const avgMinutes = (row.avg_duration / 60000).toFixed(1);
					insights.push({
						metric: "avg_duration",
						value: `${avgMinutes} min`,
						insight:
							row.avg_duration > 600000
								? "Tasks taking >10min - consider smaller decomposition"
								: "Task duration is reasonable",
					});
				}
			}

			return JSON.stringify(
				{
					scope: args.scope,
					epic_id: args.epic_id,
					insights,
				},
				null,
				2,
			);
		} catch (error) {
			return JSON.stringify({
				error: error instanceof Error ? error.message : String(error),
			});
		}
	},
});

// ============================================================================
// Stats CLI Helpers (exported for bin/swarm.ts)
// ============================================================================

export interface SwarmStatsData {
	overall: {
		totalSwarms: number;
		successRate: number;
		avgDurationMin: number;
	};
	byStrategy: Array<{
		strategy: string;
		total: number;
		successRate: number;
		successes: number;
	}>;
	coordinator: {
		violationRate: number;
		spawnEfficiency: number;
		reviewThoroughness: number;
	};
	recentDays: number;
}

/**
 * Format swarm stats as beautiful CLI output with box drawing
 */
export function formatSwarmStats(stats: SwarmStatsData): string {
	const lines: string[] = [];

	// Header with ASCII art
	lines.push(
		"\u250C\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2510",
	);
	lines.push("\u2502        🐝  SWARM STATISTICS  🐝         \u2502");
	lines.push(
		"\u251C\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2524",
	);

	// Overall stats
	const totalStr = stats.overall.totalSwarms.toString().padEnd(4);
	const rateStr = `${Math.round(stats.overall.successRate)}%`.padStart(3);
	lines.push(`│ Total Swarms: ${totalStr} Success: ${rateStr}      │`);

	const durationStr = stats.overall.avgDurationMin.toFixed(1);
	lines.push(
		`\u2502 Avg Duration: ${durationStr}min${" ".repeat(23 - durationStr.length)}\u2502`,
	);
	lines.push(
		"\u251C\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2524",
	);

	// Strategy breakdown
	lines.push("\u2502 BY STRATEGY                             \u2502");
	if (stats.byStrategy.length === 0) {
		lines.push(
			"\u2502 \u251C\u2500 No data yet                          \u2502",
		);
	} else {
		for (const strategy of stats.byStrategy) {
			const label = strategy.strategy.padEnd(15);
			const rate = `${Math.round(strategy.successRate)}%`.padStart(4);
			const counts = `(${strategy.successes}/${strategy.total})`.padEnd(8);
			lines.push(`\u2502 \u251C\u2500 ${label} ${rate} ${counts}     \u2502`);
		}
	}
	lines.push(
		"\u251C\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2524",
	);

	// Coordinator health
	lines.push("\u2502 COORDINATOR HEALTH                      \u2502");
	const violationStr =
		`${Math.round(stats.coordinator.violationRate)}%`.padStart(3);
	const spawnStr = `${Math.round(stats.coordinator.spawnEfficiency)}%`.padStart(
		4,
	);
	const reviewStr =
		`${Math.round(stats.coordinator.reviewThoroughness)}%`.padStart(3);

	lines.push(
		`\u2502 Violation Rate:   ${violationStr}${" ".repeat(19 - violationStr.length)}\u2502`,
	);
	lines.push(
		`\u2502 Spawn Efficiency: ${spawnStr}${" ".repeat(17 - spawnStr.length)}\u2502`,
	);
	lines.push(
		`\u2502 Review Rate:      ${reviewStr}${" ".repeat(19 - reviewStr.length)}\u2502`,
	);
	lines.push(
		"\u2514\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2518",
	);

	lines.push("");
	lines.push(`📊 Stats for last ${stats.recentDays} days`);

	return lines.join("\n");
}

/**
 * Parse time period string like "7d", "24h", "30m" to timestamp
 */
export function parseTimePeriod(period: string): number {
	const match = period.match(/^(\d+)([dhm])$/);
	if (!match) {
		throw new Error(
			`Invalid time period format: ${period}. Use "7d", "24h", or "30m"`,
		);
	}

	const [, value, unit] = match;
	const num = Number.parseInt(value, 10);
	const now = Date.now();

	switch (unit) {
		case "d":
			return now - num * 24 * 60 * 60 * 1000;
		case "h":
			return now - num * 60 * 60 * 1000;
		case "m":
			return now - num * 60 * 1000;
		default:
			throw new Error(`Unknown time unit: ${unit}`);
	}
}

/**
 * Aggregate swarm outcomes by strategy
 */
export function aggregateByStrategy(
	outcomes: Array<{ strategy: string | null; success: boolean }>,
): Array<{
	strategy: string;
	total: number;
	successRate: number;
	successes: number;
}> {
	const grouped: Record<string, { total: number; successes: number }> = {};

	for (const outcome of outcomes) {
		const strategy = outcome.strategy || "unknown";
		if (!grouped[strategy]) {
			grouped[strategy] = { total: 0, successes: 0 };
		}
		grouped[strategy].total++;
		if (outcome.success) {
			grouped[strategy].successes++;
		}
	}

	return Object.entries(grouped).map(([strategy, stats]) => ({
		strategy,
		total: stats.total,
		successes: stats.successes,
		successRate: (stats.successes / stats.total) * 100,
	}));
}

// ============================================================================
// History CLI Helpers (exported for bin/swarm.ts)
// ============================================================================

export interface SwarmHistoryRecord {
	epic_id: string;
	epic_title: string;
	strategy: string;
	timestamp: string;
	overall_success: boolean;
	task_count: number;
	completed_count: number;
}

/**
 * Query swarm history from swarm events
 *
 * Constructs epic-level view from decomposition_generated and subtask_outcome events:
 * - decomposition_generated: epic_id, task (title), strategy, subtask_count
 * - subtask_outcome: count successful completed tasks per epic
 */
export async function querySwarmHistory(
	projectPath: string,
	options?: {
		limit?: number;
		status?: "success" | "failed" | "in_progress";
		strategy?: "file-based" | "feature-based" | "risk-based";
	},
): Promise<SwarmHistoryRecord[]> {
	const swarmMail = await getSwarmMailLibSQL(projectPath);
	const db = await swarmMail.getDatabase();

	const limit = options?.limit || 10;

	// Query decomposition_generated events to get epic metadata
	const query = `
		WITH decompositions AS (
			SELECT 
				json_extract(data, '$.epic_id') as epic_id,
				json_extract(data, '$.task') as epic_title,
				json_extract(data, '$.epic_title') as epic_title_alt,
				json_extract(data, '$.strategy') as strategy,
				json_array_length(json_extract(data, '$.subtasks')) as task_count,
				timestamp
			FROM events
			WHERE type = 'decomposition_generated'
			${options?.strategy ? "AND json_extract(data, '$.strategy') = ?" : ""}
			ORDER BY timestamp DESC
			LIMIT ?
		),
		completions AS (
			SELECT 
				json_extract(data, '$.epic_id') as epic_id,
				COUNT(*) as completed_count
			FROM events
			WHERE type = 'subtask_outcome'
			AND json_extract(data, '$.success') = 1
			GROUP BY json_extract(data, '$.epic_id')
		)
		SELECT 
			d.epic_id,
			COALESCE(d.epic_title_alt, d.epic_title, 'Unknown Epic') as epic_title,
			d.strategy,
			d.timestamp,
			d.task_count,
			COALESCE(c.completed_count, 0) as completed_count,
			CASE 
				WHEN COALESCE(c.completed_count, 0) = d.task_count THEN 1
				ELSE 0
			END as overall_success
		FROM decompositions d
		LEFT JOIN completions c ON d.epic_id = c.epic_id
		ORDER BY d.timestamp DESC
	`;

	const params: (string | number)[] = [];
	if (options?.strategy) {
		params.push(options.strategy);
	}
	params.push(limit);

	const result = await db.query(query, params);
	const rows = result.rows as unknown[];

	// Filter by status if requested
	let filteredRows = rows;
	if (options?.status) {
		filteredRows = rows.filter((row) => {
			const r = row as Record<string, unknown>;
			const completed = Number(r.completed_count) || 0;
			const total = Number(r.task_count) || 0;
			const success = Number(r.overall_success) === 1;

			switch (options.status) {
				case "success":
					return success;
				case "failed":
					return !success && completed === total;
				case "in_progress":
					return completed < total;
				default:
					return true;
			}
		});
	}

	return filteredRows.map((row) => {
		const r = row as Record<string, unknown>;
		return {
			epic_id: String(r.epic_id || ""),
			epic_title: String(r.epic_title || "Unknown"),
			strategy: String(r.strategy || "unknown"),
			timestamp: new Date(Number(r.timestamp)).toISOString(),
			overall_success: Number(r.overall_success) === 1,
			task_count: Number(r.task_count) || 0,
			completed_count: Number(r.completed_count) || 0,
		};
	});
}

/**
 * Format relative time (e.g., "2h ago", "1d ago")
 */
export function formatRelativeTime(timestamp: string): string {
	const now = Date.now();
	const then = new Date(timestamp).getTime();
	const diffMs = now - then;

	const minutes = Math.floor(diffMs / 60000);
	const hours = Math.floor(diffMs / 3600000);
	const days = Math.floor(diffMs / 86400000);

	if (minutes < 60) return `${minutes}m ago`;
	if (hours < 24) return `${hours}h ago`;
	return `${days}d ago`;
}

/**
 * Format swarm history as beautiful CLI table
 */
export function formatSwarmHistory(records: SwarmHistoryRecord[]): string {
	if (records.length === 0) {
		return "No swarm history found";
	}

	const rows = records.map((r) => ({
		time: formatRelativeTime(r.timestamp),
		status: r.overall_success ? "✅" : "❌",
		title:
			r.epic_title.length > 30
				? `${r.epic_title.slice(0, 27)}...`
				: r.epic_title,
		strategy: r.strategy,
		tasks: `${r.completed_count}/${r.task_count} tasks`,
	}));

	// Box drawing characters (using Unicode escapes to avoid encoding issues)
	const lines: string[] = [];
	lines.push(
		"\u250C\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2510",
	);
	lines.push(
		"\u2502                    SWARM HISTORY                            \u2502",
	);
	lines.push(
		"\u251C\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2524",
	);

	for (const row of rows) {
		const statusCol = `${row.time.padEnd(8)} ${row.status}`;
		const titleCol = row.title.padEnd(32);
		const strategyCol = row.strategy.padEnd(13);
		const tasksCol = row.tasks;

		const line = `\u2502 ${statusCol} ${titleCol} ${strategyCol} ${tasksCol.padEnd(3)} \u2502`;
		lines.push(line);
	}

	lines.push(
		"\u2514\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2518",
	);

	return lines.join("\n");
}

// ============================================================================
// Exports
// ============================================================================

export const observabilityTools = {
	swarm_analytics,
	swarm_query,
	swarm_diagnose,
	swarm_insights,
};
