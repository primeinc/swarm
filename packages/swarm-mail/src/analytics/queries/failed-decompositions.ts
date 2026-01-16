/**
 * Query 1: Failed Decompositions
 *
 * Analyzes decomposition failures by strategy, showing which strategies
 * have the highest failure rates and average duration.
 */

import { QueryBuilder } from "../query-builder.js";
import type { AnalyticsQuery } from "../types.js";

export interface FailedDecompositionsFilters {
	project_key?: string;
	limit?: number;
}

/**
 * Build a query for failed decompositions grouped by strategy.
 *
 * Returns strategy, failure count, and average duration for failed epics.
 * An epic is considered failed if it has completed all subtasks but not all succeeded.
 *
 * @param filters - Optional filters for project_key and limit
 * @returns AnalyticsQuery ready for execution
 */
export function failedDecompositions(
	filters?: FailedDecompositionsFilters,
): AnalyticsQuery {
	// Use raw SQL since we need a CTE join
	const projectFilter = filters?.project_key
		? `AND d.project_key = '${filters.project_key}'`
		: "";
	const limitClause = filters?.limit ? `LIMIT ${filters.limit}` : "";

	const sql = `
		WITH decompositions AS (
			SELECT 
				project_key,
				json_extract(data, '$.epic_id') as epic_id,
				json_extract(data, '$.payload.strategy_used') as strategy,
				CAST(json_extract(data, '$.payload.subtask_count') AS INTEGER) as task_count
			FROM events
			WHERE type = 'coordinator_decision'
			AND json_extract(data, '$.decision_type') = 'decomposition_complete'
		),
		outcomes AS (
			SELECT 
				json_extract(data, '$.epic_id') as epic_id,
				COUNT(*) as completed_count,
				SUM(CASE WHEN json_extract(data, '$.outcome_type') = 'subtask_success' THEN 1 ELSE 0 END) as success_count,
				AVG(CAST(json_extract(data, '$.payload.duration_ms') AS REAL)) as avg_duration_ms
			FROM events
			WHERE type = 'coordinator_outcome'
			GROUP BY json_extract(data, '$.epic_id')
		)
		SELECT 
			d.strategy as strategy,
			COUNT(*) as failure_count,
			AVG(o.avg_duration_ms) as avg_duration_ms
		FROM decompositions d
		INNER JOIN outcomes o ON d.epic_id = o.epic_id
		WHERE o.completed_count = d.task_count
		AND o.success_count < d.task_count
		${projectFilter}
		GROUP BY d.strategy
		ORDER BY failure_count DESC
		${limitClause}
	`;

	return {
		name: "failed-decompositions",
		description:
			"Failed decomposition attempts grouped by strategy with failure counts and average duration",
		sql,
		parameters: {},
	};
}
