/**
 * Scope Violations Query
 *
 * Identifies files touched outside the agent's assigned scope.
 * Useful for detecting agents that modify files they weren't
 * supposed to touch.
 */

import type { AnalyticsQuery } from "../types.js";

/**
 * Pre-built query to find scope violations.
 *
 * Extracts files_touched from task_completed events and compares
 * against assigned scope (from task data).
 *
 * @example
 * ```typescript
 * const adapter = await getSwarmMailLibSQL(projectPath);
 * const db = await adapter.getDatabase();
 * const result = await db.query(scopeViolations.sql);
 * ```
 */
export const scopeViolations: AnalyticsQuery & {
	buildQuery?: (filters: { project_key?: string }) => AnalyticsQuery;
} = {
	name: "scope-violations",
	description:
		"Files touched outside owned scope - detects agents modifying files outside their assigned scope",
	sql: `
    SELECT 
      json_extract(data, '$.agent_name') as agent,
      json_extract(data, '$.cell_id') as task_id,
      json_extract(data, '$.files_touched') as files_touched,
      timestamp,
      project_key
    FROM events
    WHERE type = 'task_completed'
      AND json_extract(data, '$.files_touched') IS NOT NULL
    ORDER BY timestamp DESC
  `,
	buildQuery: (filters: { project_key?: string }) => {
		if (filters.project_key) {
			return {
				name: "scope-violations",
				description:
					"Files touched outside owned scope - detects agents modifying files outside their assigned scope",
				sql: `
          SELECT 
            json_extract(data, '$.agent_name') as agent,
            json_extract(data, '$.cell_id') as task_id,
            json_extract(data, '$.files_touched') as files_touched,
            timestamp,
            project_key
          FROM events
          WHERE type = 'task_completed'
            AND json_extract(data, '$.files_touched') IS NOT NULL
            AND project_key = ?
          ORDER BY timestamp DESC
        `,
				parameters: { 0: filters.project_key },
			};
		}
		return scopeViolations;
	},
};
