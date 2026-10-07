/**
 * Task Duration Query
 *
 * Calculates p50, p95, and p99 percentiles for task completion times.
 * Uses window functions to compute percentiles from task start/end events.
 */

import type { AnalyticsQuery } from "../types.js";

/**
 * Pre-built query to calculate task duration percentiles.
 *
 * Computes p50 (median), p95, and p99 durations by:
 * 1. Finding task_started and task_completed event pairs
 * 2. Calculating duration = completed_timestamp - started_timestamp
 * 3. Using ORDER BY + LIMIT to approximate percentiles
 *
 * Note: libSQL doesn't have percentile_cont, so we use row counting
 * to approximate percentiles.
 *
 * @example
 * ```typescript
 * const adapter = await getSwarmMailLibSQL(projectPath);
 * const db = await adapter.getDatabase();
 * const result = await db.query(taskDuration.sql);
 * ```
 */
export const taskDuration: AnalyticsQuery & {
	buildQuery?: (filters: { project_key?: string }) => AnalyticsQuery;
} = {
	name: "task-duration",
	description:
		"p50/p95/p99 task durations - calculates percentile distribution of task completion times",
	sql: `
    WITH task_durations AS (
      SELECT 
        json_extract(started.data, '$.cell_id') as task_id,
        completed.timestamp - started.timestamp as duration_ms
      FROM events started
      INNER JOIN events completed 
        ON json_extract(started.data, '$.cell_id') = json_extract(completed.data, '$.cell_id')
        AND started.project_key = completed.project_key
      WHERE started.type = 'task_started'
        AND completed.type = 'task_completed'
    ),
    ordered AS (
      SELECT 
        duration_ms,
        ROW_NUMBER() OVER (ORDER BY duration_ms) as row_num,
        COUNT(*) OVER () as total_count
      FROM task_durations
    )
    SELECT
      (SELECT duration_ms FROM ordered WHERE row_num = CAST(total_count * 0.50 AS INTEGER) LIMIT 1) as p50_ms,
      (SELECT duration_ms FROM ordered WHERE row_num = CAST(total_count * 0.95 AS INTEGER) LIMIT 1) as p95_ms,
      (SELECT duration_ms FROM ordered WHERE row_num = CAST(total_count * 0.99 AS INTEGER) LIMIT 1) as p99_ms,
      COUNT(*) as total_tasks
    FROM task_durations
  `,
	buildQuery: (filters: { project_key?: string }) => {
		if (filters.project_key) {
			return {
				name: "task-duration",
				description:
					"p50/p95/p99 task durations - calculates percentile distribution of task completion times",
				sql: `
          WITH task_durations AS (
            SELECT 
              json_extract(started.data, '$.cell_id') as task_id,
              completed.timestamp - started.timestamp as duration_ms
            FROM events started
            INNER JOIN events completed 
              ON json_extract(started.data, '$.cell_id') = json_extract(completed.data, '$.cell_id')
              AND started.project_key = completed.project_key
            WHERE started.type = 'task_started'
              AND completed.type = 'task_completed'
              AND started.project_key = ?
          ),
          ordered AS (
            SELECT 
              duration_ms,
              ROW_NUMBER() OVER (ORDER BY duration_ms) as row_num,
              COUNT(*) OVER () as total_count
            FROM task_durations
          )
          SELECT
            (SELECT duration_ms FROM ordered WHERE row_num = CAST(total_count * 0.50 AS INTEGER) LIMIT 1) as p50_ms,
            (SELECT duration_ms FROM ordered WHERE row_num = CAST(total_count * 0.95 AS INTEGER) LIMIT 1) as p95_ms,
            (SELECT duration_ms FROM ordered WHERE row_num = CAST(total_count * 0.99 AS INTEGER) LIMIT 1) as p99_ms,
            COUNT(*) as total_tasks
          FROM task_durations
        `,
				parameters: { 0: filters.project_key },
			};
		}
		return taskDuration;
	},
};
