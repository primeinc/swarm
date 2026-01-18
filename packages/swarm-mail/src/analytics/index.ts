/**
 * Analytics Module
 *
 * Type-safe query builder and result formatters for SQL analytics.
 *
 * ## Usage
 *
 * ```typescript
 * import { QueryBuilder, formatTable } from "swarm-mail/analytics";
 *
 * const query = new QueryBuilder()
 *   .select(["type", "COUNT(*) as count"])
 *   .from("events")
 *   .where("project_key = ?", ["my-project"])
 *   .groupBy("type")
 *   .orderBy("count", "DESC")
 *   .limit(10)
 *   .withName("event-counts")
 *   .withDescription("Event type counts by project")
 *   .build();
 *
 * // Execute query (you provide the database adapter)
 * const result = await db.query(query.sql, Object.values(query.parameters || {}));
 *
 * // Format output
 * console.log(formatTable(result));
 * ```
 *
 * @module analytics
 */

export {
	formatCSV,
	formatJSON,
	formatJSONL,
	formatTable,
} from "./formatters.js";
export * from "./queries/index.js";
export { QueryBuilder } from "./query-builder.js";
export type { AnalyticsQuery, OutputFormat, QueryResult } from "./types.js";
