/**
 * Query 3: Lock Contention
 *
 * Identifies files with highest reservation counts and average hold times.
 */

import { QueryBuilder } from "../query-builder.js";
import type { AnalyticsQuery } from "../types.js";

export interface LockContentionFilters {
	limit?: number;
}

/**
 * Build a query for lock contention analysis.
 *
 * Returns path_pattern, reservation count, and average hold time for
 * file reservations, ordered by reservation count descending.
 *
 * @param filters - Optional limit
 * @returns AnalyticsQuery ready for execution
 */
export function lockContention(
	filters?: LockContentionFilters,
): AnalyticsQuery {
	const builder = new QueryBuilder()
		.select([
			"json_extract(data, '$.path_pattern') as path_pattern",
			"COUNT(*) as reservation_count",
			"AVG(CAST(json_extract(data, '$.hold_time_ms') AS REAL)) as avg_hold_time_ms",
		])
		.from("events")
		.where("type = ?", ["reservation_released"])
		.groupBy("path_pattern")
		.orderBy("reservation_count", "DESC")
		.withName("lock-contention")
		.withDescription(
			"Files with most reservations and average hold times, identifying contention hotspots",
		);

	if (filters?.limit) {
		builder.limit(filters.limit);
	}

	return builder.build();
}
