/**
 * Analytics Query Builder and Formatters - TDD Tests
 *
 * Tests for type-safe query building and output formatting.
 * Follows RED → GREEN → REFACTOR discipline.
 */

import { describe, expect, test } from "bun:test";
import {
	formatCSV,
	formatJSON,
	formatJSONL,
	formatTable,
} from "./formatters.js";
import { QueryBuilder } from "./query-builder.js";
import type { AnalyticsQuery, QueryResult } from "./types.js";

describe("AnalyticsQuery type", () => {
	test("should have required fields: name, description, sql", () => {
		const query: AnalyticsQuery = {
			name: "test-query",
			description: "A test query",
			sql: "SELECT * FROM events",
		};

		expect(query.name).toBe("test-query");
		expect(query.description).toBe("A test query");
		expect(query.sql).toBe("SELECT * FROM events");
	});

	test("should support optional parameters", () => {
		const query: AnalyticsQuery = {
			name: "parameterized-query",
			description: "Query with params",
			sql: "SELECT * FROM events WHERE type = ?",
			parameters: { type: "agent_registered" },
		};

		expect(query.parameters).toEqual({ type: "agent_registered" });
	});
});

describe("QueryResult type", () => {
	test("should have columns, rows, rowCount, executionTimeMs", () => {
		const result: QueryResult = {
			columns: ["id", "name"],
			rows: [{ id: 1, name: "test" }],
			rowCount: 1,
			executionTimeMs: 42,
		};

		expect(result.columns).toEqual(["id", "name"]);
		expect(result.rows).toHaveLength(1);
		expect(result.rowCount).toBe(1);
		expect(result.executionTimeMs).toBe(42);
	});
});

describe("formatTable", () => {
	test("should format simple result as ASCII table with headers", () => {
		const result: QueryResult = {
			columns: ["id", "type"],
			rows: [
				{ id: 1, type: "agent_registered" },
				{ id: 2, type: "message_sent" },
			],
			rowCount: 2,
			executionTimeMs: 10,
		};

		const output = formatTable(result);

		// Should contain header row
		expect(output).toContain("id");
		expect(output).toContain("type");
		// Should contain data rows
		expect(output).toContain("1");
		expect(output).toContain("agent_registered");
		expect(output).toContain("2");
		expect(output).toContain("message_sent");
		// Should have separator lines (common in ASCII tables)
		expect(output).toContain("-");
	});

	test("should handle empty results gracefully", () => {
		const result: QueryResult = {
			columns: ["id", "name"],
			rows: [],
			rowCount: 0,
			executionTimeMs: 5,
		};

		const output = formatTable(result);

		// Should still show headers
		expect(output).toContain("id");
		expect(output).toContain("name");
		// Should indicate no rows
		expect(output.toLowerCase()).toMatch(/0 rows?|no rows?|empty/);
	});

	test("should align columns properly", () => {
		const result: QueryResult = {
			columns: ["short", "very_long_column_name"],
			rows: [
				{ short: "a", very_long_column_name: "x" },
				{ short: "b", very_long_column_name: "y" },
			],
			rowCount: 2,
			executionTimeMs: 8,
		};

		const output = formatTable(result);
		const lines = output.split("\n").filter((l) => l.trim());

		// All non-empty lines should have similar length (aligned)
		const lengths = lines.map((l) => l.length);
		const maxLength = Math.max(...lengths);
		const minLength = Math.min(...lengths);

		// Allow some variance for separators and footer, but should be mostly aligned
		// Footer "(2 rows)" is shorter, so variance can be larger
		expect(maxLength - minLength).toBeLessThan(30);
	});
});

describe("formatJSON", () => {
	test("should format result as pretty-printed JSON", () => {
		const result: QueryResult = {
			columns: ["id", "type"],
			rows: [{ id: 1, type: "test" }],
			rowCount: 1,
			executionTimeMs: 5,
		};

		const output = formatJSON(result);
		const parsed = JSON.parse(output);

		expect(parsed.columns).toEqual(["id", "type"]);
		expect(parsed.rows).toEqual([{ id: 1, type: "test" }]);
		expect(parsed.rowCount).toBe(1);
		expect(parsed.executionTimeMs).toBe(5);

		// Should be pretty-printed (has newlines)
		expect(output).toContain("\n");
	});

	test("should handle empty results", () => {
		const result: QueryResult = {
			columns: [],
			rows: [],
			rowCount: 0,
			executionTimeMs: 2,
		};

		const output = formatJSON(result);
		const parsed = JSON.parse(output);

		expect(parsed.rowCount).toBe(0);
		expect(parsed.rows).toEqual([]);
	});
});

describe("formatCSV", () => {
	test("should format result as RFC 4180 compliant CSV", () => {
		const result: QueryResult = {
			columns: ["id", "name", "value"],
			rows: [
				{ id: 1, name: "test", value: 100 },
				{ id: 2, name: "example", value: 200 },
			],
			rowCount: 2,
			executionTimeMs: 7,
		};

		const output = formatCSV(result);
		const lines = output.split("\n").filter((l) => l.trim());

		// First line should be headers
		expect(lines[0]).toBe("id,name,value");
		// Should have data rows
		expect(lines[1]).toContain("1");
		expect(lines[1]).toContain("test");
		expect(lines[1]).toContain("100");
		expect(lines[2]).toContain("2");
		expect(lines[2]).toContain("example");
		expect(lines[2]).toContain("200");
	});

	test("should escape quotes and commas correctly", () => {
		const result: QueryResult = {
			columns: ["text", "quoted"],
			rows: [
				{ text: "hello, world", quoted: 'says "hi"' },
				{ text: "simple", quoted: "no special chars" },
			],
			rowCount: 2,
			executionTimeMs: 3,
		};

		const output = formatCSV(result);
		const lines = output.split("\n").filter((l) => l.trim());

		// Line with comma should be quoted
		expect(lines[1]).toContain('"hello, world"');
		// Line with quotes should escape them
		expect(lines[1]).toContain('says ""hi""');
		// Simple text shouldn't need quotes (but might be quoted anyway - both valid)
		expect(lines[2]).toContain("simple");
	});

	test("should handle empty results", () => {
		const result: QueryResult = {
			columns: ["col1", "col2"],
			rows: [],
			rowCount: 0,
			executionTimeMs: 1,
		};

		const output = formatCSV(result);
		const lines = output.split("\n").filter((l) => l.trim());

		// Should have header row
		expect(lines[0]).toBe("col1,col2");
		// Should have no data rows (just header)
		expect(lines.length).toBe(1);
	});

	test("should handle null and undefined values", () => {
		const result: QueryResult = {
			columns: ["id", "optional"],
			rows: [
				{ id: 1, optional: null },
				{ id: 2, optional: undefined },
				{ id: 3, optional: "value" },
			],
			rowCount: 3,
			executionTimeMs: 4,
		};

		const output = formatCSV(result);
		const lines = output.split("\n").filter((l) => l.trim());

		// Null/undefined should render as empty string
		expect(lines[1]).toBe("1,");
		expect(lines[2]).toBe("2,");
		expect(lines[3]).toContain("3,value");
	});
});

describe("formatJSONL", () => {
	test("should produce one JSON object per line", () => {
		const result: QueryResult = {
			columns: ["id", "type"],
			rows: [
				{ id: 1, type: "test" },
				{ id: 2, type: "example" },
			],
			rowCount: 2,
			executionTimeMs: 6,
		};

		const output = formatJSONL(result);
		const lines = output.split("\n").filter((l) => l.trim());

		expect(lines.length).toBe(2);

		const row1 = JSON.parse(lines[0]);
		const row2 = JSON.parse(lines[1]);

		expect(row1).toEqual({ id: 1, type: "test" });
		expect(row2).toEqual({ id: 2, type: "example" });
	});

	test("should handle empty results", () => {
		const result: QueryResult = {
			columns: [],
			rows: [],
			rowCount: 0,
			executionTimeMs: 1,
		};

		const output = formatJSONL(result);
		expect(output.trim()).toBe("");
	});

	test("should handle single row", () => {
		const result: QueryResult = {
			columns: ["id"],
			rows: [{ id: 1 }],
			rowCount: 1,
			executionTimeMs: 2,
		};

		const output = formatJSONL(result);
		const lines = output.split("\n").filter((l) => l.trim());

		expect(lines.length).toBe(1);
		expect(JSON.parse(lines[0])).toEqual({ id: 1 });
	});

	test("should not pretty-print (compact format)", () => {
		const result: QueryResult = {
			columns: ["a", "b"],
			rows: [{ a: 1, b: 2 }],
			rowCount: 1,
			executionTimeMs: 1,
		};

		const output = formatJSONL(result);
		const firstLine = output.split("\n")[0];

		// Compact JSON shouldn't have multiple spaces or newlines
		expect(firstLine).not.toContain("\n");
		expect(firstLine).not.toMatch(/\s{2,}/);
	});
});

describe("QueryBuilder", () => {
	test("should construct simple SELECT query", () => {
		const builder = new QueryBuilder();
		const query = builder
			.select(["id", "type", "timestamp"])
			.from("events")
			.build();

		expect(query.sql).toContain("SELECT");
		expect(query.sql).toContain("id");
		expect(query.sql).toContain("type");
		expect(query.sql).toContain("timestamp");
		expect(query.sql).toContain("FROM events");
	});

	test("should support WHERE clause with parameters", () => {
		const builder = new QueryBuilder();
		const query = builder
			.select(["*"])
			.from("events")
			.where("type = ?", ["agent_registered"])
			.build();

		expect(query.sql).toContain("WHERE");
		expect(query.sql).toContain("type = ?");
		expect(query.parameters).toBeDefined();
	});

	test("should support ORDER BY", () => {
		const builder = new QueryBuilder();
		const query = builder
			.select(["*"])
			.from("events")
			.orderBy("timestamp", "DESC")
			.build();

		expect(query.sql).toContain("ORDER BY");
		expect(query.sql).toContain("timestamp");
		expect(query.sql).toContain("DESC");
	});

	test("should support LIMIT", () => {
		const builder = new QueryBuilder();
		const query = builder.select(["*"]).from("events").limit(10).build();

		expect(query.sql).toContain("LIMIT");
		expect(query.sql).toContain("10");
	});

	test("should support GROUP BY and HAVING", () => {
		const builder = new QueryBuilder();
		const query = builder
			.select(["type", "COUNT(*) as count"])
			.from("events")
			.groupBy("type")
			.having("COUNT(*) > ?", [5])
			.build();

		expect(query.sql).toContain("GROUP BY");
		expect(query.sql).toContain("type");
		expect(query.sql).toContain("HAVING");
		expect(query.sql).toContain("COUNT(*) > ?");
	});

	test("should chain multiple WHERE conditions", () => {
		const builder = new QueryBuilder();
		const query = builder
			.select(["*"])
			.from("events")
			.where("type = ?", ["message_sent"])
			.where("timestamp > ?", [Date.now() - 86400000])
			.build();

		const whereMatches = query.sql.match(/WHERE/gi);
		// Should only have one WHERE keyword (conditions joined with AND)
		expect(whereMatches?.length).toBe(1);
		expect(query.sql).toContain("AND");
	});

	test("should produce valid SQL with all clauses", () => {
		const builder = new QueryBuilder();
		const query = builder
			.select(["project_key", "COUNT(*) as msg_count"])
			.from("messages")
			.where("importance = ?", ["high"])
			.groupBy("project_key")
			.having("COUNT(*) > ?", [10])
			.orderBy("msg_count", "DESC")
			.limit(5)
			.build();

		// Verify SQL clause order (standard SQL order)
		const sql = query.sql;
		const selectPos = sql.indexOf("SELECT");
		const fromPos = sql.indexOf("FROM");
		const wherePos = sql.indexOf("WHERE");
		const groupPos = sql.indexOf("GROUP BY");
		const havingPos = sql.indexOf("HAVING");
		const orderPos = sql.indexOf("ORDER BY");
		const limitPos = sql.indexOf("LIMIT");

		expect(selectPos).toBeGreaterThanOrEqual(0);
		expect(fromPos).toBeGreaterThan(selectPos);
		expect(wherePos).toBeGreaterThan(fromPos);
		expect(groupPos).toBeGreaterThan(wherePos);
		expect(havingPos).toBeGreaterThan(groupPos);
		expect(orderPos).toBeGreaterThan(havingPos);
		expect(limitPos).toBeGreaterThan(orderPos);
	});

	test("should build AnalyticsQuery with name and description", () => {
		const builder = new QueryBuilder();
		const query = builder
			.select(["*"])
			.from("events")
			.withName("recent-events")
			.withDescription("Get recent events from the last hour")
			.build();

		expect(query.name).toBe("recent-events");
		expect(query.description).toBe("Get recent events from the last hour");
		expect(query.sql).toBeDefined();
	});

	test("should handle query with no parameters", () => {
		const builder = new QueryBuilder();
		const query = builder.select(["*"]).from("events").limit(10).build();

		expect(query.parameters).toBeUndefined();
	});

	test("should accumulate parameters from multiple WHERE/HAVING clauses", () => {
		const builder = new QueryBuilder();
		const query = builder
			.select(["type", "COUNT(*) as count"])
			.from("events")
			.where("project_key = ?", ["test-project"])
			.where("timestamp > ?", [123456])
			.groupBy("type")
			.having("COUNT(*) > ?", [5])
			.build();

		// Parameters should be accumulated in order
		expect(query.parameters).toBeDefined();
		const params = Object.values(query.parameters || {});
		expect(params).toHaveLength(3);
		expect(params[0]).toBe("test-project");
		expect(params[1]).toBe(123456);
		expect(params[2]).toBe(5);
	});
});

describe("Full integration", () => {
	test("should build query and format results end-to-end", () => {
		// Build a query
		const query = new QueryBuilder()
			.select(["id", "type", "timestamp"])
			.from("events")
			.where("type = ?", ["agent_registered"])
			.orderBy("timestamp", "DESC")
			.limit(5)
			.withName("recent-agent-registrations")
			.withDescription("Get the 5 most recent agent registrations")
			.build();

		// Verify query structure
		expect(query.name).toBe("recent-agent-registrations");
		expect(query.sql).toContain("SELECT id, type, timestamp");
		expect(query.sql).toContain("FROM events");
		expect(query.sql).toContain("WHERE type = ?");
		expect(query.sql).toContain("ORDER BY timestamp DESC");
		expect(query.sql).toContain("LIMIT 5");

		// Simulate query result
		const result: QueryResult = {
			columns: ["id", "type", "timestamp"],
			rows: [
				{ id: 1, type: "agent_registered", timestamp: 1734886800000 },
				{ id: 2, type: "agent_registered", timestamp: 1734886700000 },
			],
			rowCount: 2,
			executionTimeMs: 12,
		};

		// Format in all supported formats
		const tableOutput = formatTable(result);
		const jsonOutput = formatJSON(result);
		const csvOutput = formatCSV(result);
		const jsonlOutput = formatJSONL(result);

		// Verify all formatters work
		expect(tableOutput).toContain("id");
		expect(tableOutput).toContain("type");
		expect(JSON.parse(jsonOutput).rowCount).toBe(2);
		expect(csvOutput).toContain("id,type,timestamp");
		expect(jsonlOutput.split("\n").filter((l) => l.trim()).length).toBe(2);
	});
});
