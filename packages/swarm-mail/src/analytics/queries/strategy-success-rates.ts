/**
 * Query 2: Strategy Success Rates
 *
 * Calculates success rate percentage for each decomposition strategy.
 */

import { QueryBuilder } from "../query-builder.js";
import type { AnalyticsQuery } from "../types.js";

export interface StrategySuccessRatesFilters {
	project_key?: string;
}

/**
 * Build a query for strategy success rates.
 *
 * Returns strategy, total attempts, successful count, failed count, and
 * success rate percentage, ordered by success rate descending.
 *
 * Joins decomposition_complete events (for strategy) with subtask outcomes (for success/failure).
 *
 * @param filters - Optional filters for project_key
 * @returns AnalyticsQuery ready for execution
 */
export function strategySuccessRates(
	filters?: StrategySuccessRatesFilters,
): AnalyticsQuery {
	// Use raw SQL since we need a CTE join
	const projectFilter = filters?.project_key
		? `WHERE d.project_key = '${filters.project_key}'`
		: "";

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
		completions AS (
			SELECT 
				json_extract(data, '$.epic_id') as epic_id,
				COUNT(*) as completed_count,
				SUM(CASE WHEN json_extract(data, '$.outcome_type') = 'subtask_success' THEN 1 ELSE 0 END) as success_count
			FROM events
			WHERE type = 'coordinator_outcome'
			GROUP BY json_extract(data, '$.epic_id')
		)
		SELECT 
			d.strategy as strategy,
			COUNT(*) as total_attempts,
			SUM(CASE WHEN c.completed_count = d.task_count AND c.success_count = d.task_count THEN 1 ELSE 0 END) as successful_count,
			SUM(CASE WHEN c.completed_count = d.task_count AND c.success_count < d.task_count THEN 1 ELSE 0 END) as failed_count,
			ROUND(CAST(SUM(CASE WHEN c.completed_count = d.task_count AND c.success_count = d.task_count THEN 1 ELSE 0 END) AS REAL) / COUNT(*) * 100, 2) as success_rate
		FROM decompositions d
		LEFT JOIN completions c ON d.epic_id = c.epic_id
		${projectFilter}
		GROUP BY d.strategy
		ORDER BY success_rate DESC
	`;

	return {
		name: "strategy-success-rates",
		description:
			"Success rate percentage by decomposition strategy, showing which strategies work best",
		sql,
		parameters: {},
	};
}
