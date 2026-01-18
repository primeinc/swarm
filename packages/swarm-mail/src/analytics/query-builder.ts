/**
 * Analytics Query Builder
 *
 * Fluent API for constructing SQL queries with type safety.
 * Produces parameterized queries to prevent SQL injection.
 */

import type { AnalyticsQuery } from "./types.js";

/**
 * Fluent query builder for constructing SQL queries.
 *
 * Supports SELECT, FROM, WHERE, GROUP BY, HAVING, ORDER BY, LIMIT.
 * Accumulates parameters from WHERE and HAVING clauses.
 *
 * @example
 * ```typescript
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
 * ```
 */
export class QueryBuilder {
	private selectClause: string[] = [];
	private fromClause = "";
	private whereClauses: string[] = [];
	private groupByClause = "";
	private havingClauses: string[] = [];
	private orderByClause = "";
	private limitClause = "";
	private queryName = "";
	private queryDescription = "";
	private params: unknown[] = [];

	/**
	 * Add SELECT clause with column expressions.
	 *
	 * @param columns - Array of column names or expressions (e.g., ["id", "COUNT(*) as count"])
	 */
	select(columns: string[]): this {
		this.selectClause = columns;
		return this;
	}

	/**
	 * Set FROM clause with table name.
	 *
	 * @param table - Table name to query from
	 */
	from(table: string): this {
		this.fromClause = table;
		return this;
	}

	/**
	 * Add WHERE condition with optional parameters.
	 *
	 * Multiple calls are combined with AND.
	 *
	 * @param condition - SQL condition (use ? for parameter placeholders)
	 * @param params - Parameter values to bind
	 */
	where(condition: string, params: unknown[] = []): this {
		this.whereClauses.push(condition);
		this.params.push(...params);
		return this;
	}

	/**
	 * Set GROUP BY clause.
	 *
	 * @param column - Column to group by
	 */
	groupBy(column: string): this {
		this.groupByClause = column;
		return this;
	}

	/**
	 * Add HAVING condition with optional parameters.
	 *
	 * Multiple calls are combined with AND.
	 *
	 * @param condition - SQL condition (use ? for parameter placeholders)
	 * @param params - Parameter values to bind
	 */
	having(condition: string, params: unknown[] = []): this {
		this.havingClauses.push(condition);
		this.params.push(...params);
		return this;
	}

	/**
	 * Set ORDER BY clause.
	 *
	 * @param column - Column to sort by
	 * @param direction - Sort direction (ASC or DESC)
	 */
	orderBy(column: string, direction: "ASC" | "DESC" = "ASC"): this {
		this.orderByClause = `${column} ${direction}`;
		return this;
	}

	/**
	 * Set LIMIT clause.
	 *
	 * @param count - Maximum number of rows to return
	 */
	limit(count: number): this {
		this.limitClause = String(count);
		return this;
	}

	/**
	 * Set query name (for AnalyticsQuery.name).
	 *
	 * @param name - Unique identifier for this query
	 */
	withName(name: string): this {
		this.queryName = name;
		return this;
	}

	/**
	 * Set query description (for AnalyticsQuery.description).
	 *
	 * @param description - Human-readable description of what query does
	 */
	withDescription(description: string): this {
		this.queryDescription = description;
		return this;
	}

	/**
	 * Build the final AnalyticsQuery object.
	 *
	 * Constructs SQL string from accumulated clauses and returns
	 * AnalyticsQuery with name, description, sql, and parameters.
	 *
	 * @returns Complete AnalyticsQuery ready for execution
	 */
	build(): AnalyticsQuery {
		const parts: string[] = [];

		// SELECT clause
		if (this.selectClause.length > 0) {
			parts.push(`SELECT ${this.selectClause.join(", ")}`);
		}

		// FROM clause
		if (this.fromClause) {
			parts.push(`FROM ${this.fromClause}`);
		}

		// WHERE clause (combine multiple conditions with AND)
		if (this.whereClauses.length > 0) {
			parts.push(`WHERE ${this.whereClauses.join(" AND ")}`);
		}

		// GROUP BY clause
		if (this.groupByClause) {
			parts.push(`GROUP BY ${this.groupByClause}`);
		}

		// HAVING clause (combine multiple conditions with AND)
		if (this.havingClauses.length > 0) {
			parts.push(`HAVING ${this.havingClauses.join(" AND ")}`);
		}

		// ORDER BY clause
		if (this.orderByClause) {
			parts.push(`ORDER BY ${this.orderByClause}`);
		}

		// LIMIT clause
		if (this.limitClause) {
			parts.push(`LIMIT ${this.limitClause}`);
		}

		const sql = parts.join(" ");

		// Build parameters object (indexed by position)
		const parameters: Record<string, unknown> | undefined =
			this.params.length > 0
				? this.params.reduce<Record<string, unknown>>((acc, param, idx) => {
						acc[idx] = param;
						return acc;
					}, {})
				: undefined;

		return {
			name: this.queryName,
			description: this.queryDescription,
			sql,
			parameters,
		};
	}
}
