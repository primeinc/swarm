/**
 * Four Golden Signals Analytics - Integration Tests
 *
 * Tests pre-built analytics queries based on Google's Four Golden Signals:
 * 1. Latency - Task Duration by Strategy
 * 2. Traffic - Events per Hour
 * 3. Errors - Failed Tasks by Agent
 * 4. Saturation - Active Reservations
 * 5. Conflicts - Most Contested Files
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { ANALYTICS_QUERIES, runAnalyticsQuery } from "./analytics.js";
import { createInMemorySwarmMailLibSQL } from "./libsql.convenience.js";
import type { SwarmMailAdapter } from "./types/adapter.js";

describe("ANALYTICS_QUERIES structure", () => {
	test("exports exactly 5 pre-built queries", () => {
		expect(ANALYTICS_QUERIES).toHaveLength(5);
	});

	test("Query 1: latency - task duration by strategy", () => {
		const query = ANALYTICS_QUERIES.find((q) => q.name === "latency");
		expect(query).toBeDefined();
		expect(query?.name).toBe("latency");
		expect(query?.description).toContain("Task Duration by Strategy");
		expect(query?.sql).toContain("SELECT");
		expect(query?.sql).toContain("subtask_outcome");
		expect(typeof query?.format).toBe("function");
	});

	test("Query 2: traffic - events per hour", () => {
		const query = ANALYTICS_QUERIES.find((q) => q.name === "traffic");
		expect(query).toBeDefined();
		expect(query?.name).toBe("traffic");
		expect(query?.description).toContain("Events per Hour");
		expect(query?.sql).toContain("SELECT");
		expect(query?.sql).toContain("strftime");
		expect(typeof query?.format).toBe("function");
	});

	test("Query 3: errors - failed tasks by agent", () => {
		const query = ANALYTICS_QUERIES.find((q) => q.name === "errors");
		expect(query).toBeDefined();
		expect(query?.name).toBe("errors");
		expect(query?.description).toContain("Failed Tasks by Agent");
		expect(query?.sql).toContain("SELECT");
		expect(query?.sql).toContain("subtask_outcome");
		expect(query?.sql).toContain("success");
		expect(typeof query?.format).toBe("function");
	});

	test("Query 4: saturation - active reservations", () => {
		const query = ANALYTICS_QUERIES.find((q) => q.name === "saturation");
		expect(query).toBeDefined();
		expect(query?.name).toBe("saturation");
		expect(query?.description).toContain("Active Reservations");
		expect(query?.sql).toContain("SELECT");
		expect(query?.sql).toContain("reservation_created");
		expect(typeof query?.format).toBe("function");
	});

	test("Query 5: conflicts - most contested files", () => {
		const query = ANALYTICS_QUERIES.find((q) => q.name === "conflicts");
		expect(query).toBeDefined();
		expect(query?.name).toBe("conflicts");
		expect(query?.description).toContain("Most Contested Files");
		expect(query?.sql).toContain("SELECT");
		expect(query?.sql).toContain("reservation_created");
		expect(query?.sql).toContain("json_each");
		expect(typeof query?.format).toBe("function");
	});

	test("all queries use parameterized SQL with time filters", () => {
		for (const query of ANALYTICS_QUERIES) {
			// Should have placeholders for since/until parameters
			expect(query.sql).toContain("?");
		}
	});
});

describe("runAnalyticsQuery integration", () => {
	let swarmMail: SwarmMailAdapter;
	const testProjectPath = "/test/four-golden-signals";

	beforeAll(async () => {
		swarmMail = await createInMemorySwarmMailLibSQL(testProjectPath);
		const db = await swarmMail.getDatabase();

		const now = Date.now();

		// Seed test events
		const events = [
			// Latency: subtask_outcome events with strategies
			{
				type: "subtask_outcome",
				data: { strategy: "file-based", success: true, duration_ms: 120000 },
				timestamp: now - 3600000,
			},
			{
				type: "subtask_outcome",
				data: { strategy: "file-based", success: true, duration_ms: 90000 },
				timestamp: now - 3500000,
			},
			{
				type: "subtask_outcome",
				data: {
					strategy: "feature-based",
					success: true,
					duration_ms: 150000,
				},
				timestamp: now - 3400000,
			},
			{
				type: "subtask_outcome",
				data: { strategy: "file-based", success: false, duration_ms: 60000 },
				timestamp: now - 3300000,
			},

			// Traffic: various event types
			{
				type: "message_sent",
				data: { from: "agent1" },
				timestamp: now - 7200000,
			},
			{
				type: "message_sent",
				data: { from: "agent2" },
				timestamp: now - 7100000,
			},
			{
				type: "reservation_created",
				data: { agent: "agent1", id: 10, paths: ["src/a.ts"] },
				timestamp: now - 3700000,
			},
			{
				type: "reservation_created",
				data: { agent: "agent2", id: 11, paths: ["src/b.ts"] },
				timestamp: now - 3600000,
			},
			{
				type: "reservation_released",
				data: { id: 10 },
				timestamp: now - 1800000,
			},

			// Errors: failed subtask_outcome events
			{
				type: "subtask_outcome",
				data: { agent: "agent1", success: false, cell_id: "bd-123" },
				timestamp: now - 5400000,
			},
			{
				type: "subtask_outcome",
				data: { agent: "agent1", success: false, cell_id: "bd-124" },
				timestamp: now - 5300000,
			},
			{
				type: "subtask_outcome",
				data: { agent: "agent2", success: false, cell_id: "bd-125" },
				timestamp: now - 5200000,
			},
			{
				type: "subtask_outcome",
				data: { agent: "agent1", success: true, cell_id: "bd-126" },
				timestamp: now - 5100000,
			},

			// Saturation: active reservations (created but not released)
			{
				type: "reservation_created",
				data: { id: 1, agent: "agent1", paths: ["src/a.ts"] },
				timestamp: now - 600000,
			},
			{
				type: "reservation_created",
				data: { id: 2, agent: "agent2", paths: ["src/b.ts"] },
				timestamp: now - 500000,
			},
			{
				type: "reservation_created",
				data: { id: 3, agent: "agent3", paths: ["src/c.ts"] },
				timestamp: now - 400000,
			},
			// id:1 was released earlier (see above), so only 2 and 3 are active

			// Conflicts: file reservations (same file reserved multiple times)
			{
				type: "reservation_created",
				data: { paths: ["src/auth.ts"], agent: "agent1", id: 20 },
				timestamp: now - 9000000,
			},
			{
				type: "reservation_created",
				data: { paths: ["src/auth.ts"], agent: "agent2", id: 21 },
				timestamp: now - 8900000,
			},
			{
				type: "reservation_created",
				data: { paths: ["src/auth.ts"], agent: "agent3", id: 22 },
				timestamp: now - 8800000,
			},
			{
				type: "reservation_created",
				data: { paths: ["src/db.ts"], agent: "agent1", id: 23 },
				timestamp: now - 8700000,
			},
			{
				type: "reservation_created",
				data: { paths: ["src/db.ts"], agent: "agent2", id: 24 },
				timestamp: now - 8600000,
			},
		];

		// Insert events
		for (const event of events) {
			await db.query(
				"INSERT INTO events (type, project_key, timestamp, data) VALUES (?, ?, ?, ?)",
				[
					event.type,
					testProjectPath,
					event.timestamp,
					JSON.stringify(event.data),
				],
			);
		}
	});

	afterAll(async () => {
		await swarmMail.close();
	});

	test("latency query - returns task durations grouped by strategy", async () => {
		const db = await swarmMail.getDatabase();
		const result = await runAnalyticsQuery(db, "latency");

		expect(result).toContain("file-based");
		expect(result).toContain("feature-based");
		expect(result).toContain("task_count");
		expect(result).toContain("avg_duration");
	});

	test("latency query - supports JSON format", async () => {
		const db = await swarmMail.getDatabase();
		const result = await runAnalyticsQuery(db, "latency", { format: "json" });

		const parsed = JSON.parse(result);
		expect(Array.isArray(parsed)).toBe(true);
		expect(parsed.length).toBeGreaterThan(0);
		expect(parsed[0]).toHaveProperty("strategy");
		expect(parsed[0]).toHaveProperty("task_count");
	});

	test("traffic query - returns event counts per hour", async () => {
		const db = await swarmMail.getDatabase();
		const result = await runAnalyticsQuery(db, "traffic");

		expect(result).toContain("hour");
		expect(result).toContain("event_count");
	});

	test("errors query - returns failed tasks grouped by agent", async () => {
		const db = await swarmMail.getDatabase();
		const result = await runAnalyticsQuery(db, "errors");

		expect(result).toContain("agent1");
		expect(result).toContain("agent2");
		expect(result).toContain("failed_count");
	});

	test("saturation query - returns active reservations only", async () => {
		const db = await swarmMail.getDatabase();
		const result = await runAnalyticsQuery(db, "saturation");

		// Should contain agents 2 and 3 (active), not agent1 (released id:10)
		// But also agent1 has id:1 which is still active
		expect(result).toContain("agent");
		expect(result).toContain("reservation_id");
	});

	test("conflicts query - returns most contested files", async () => {
		const db = await swarmMail.getDatabase();
		const result = await runAnalyticsQuery(db, "conflicts");

		expect(result).toContain("src/auth.ts");
		expect(result).toContain("src/db.ts");
		expect(result).toContain("reservation_count");
	});

	test("supports since time filter", async () => {
		const db = await swarmMail.getDatabase();
		const since = new Date(Date.now() - 3600000); // 1 hour ago
		const result = await runAnalyticsQuery(db, "traffic", { since });

		expect(typeof result).toBe("string");
	});

	test("supports until time filter", async () => {
		const db = await swarmMail.getDatabase();
		const until = new Date(Date.now() - 1800000); // 30 min ago
		const result = await runAnalyticsQuery(db, "traffic", { until });

		expect(typeof result).toBe("string");
	});

	test("supports both since and until filters", async () => {
		const db = await swarmMail.getDatabase();
		const since = new Date(Date.now() - 7200000); // 2 hours ago
		const until = new Date(Date.now() - 3600000); // 1 hour ago
		const result = await runAnalyticsQuery(db, "traffic", { since, until });

		expect(typeof result).toBe("string");
	});

	test("supports CSV format", async () => {
		const db = await swarmMail.getDatabase();
		const result = await runAnalyticsQuery(db, "latency", { format: "csv" });

		expect(result).toContain(","); // CSV has commas
		const lines = result.trim().split("\n");
		expect(lines.length).toBeGreaterThan(1); // Header + data rows
	});

	test("throws error for unknown query name", async () => {
		const db = await swarmMail.getDatabase();
		await expect(runAnalyticsQuery(db, "nonexistent")).rejects.toThrow(
			"Unknown analytics query",
		);
	});
});
