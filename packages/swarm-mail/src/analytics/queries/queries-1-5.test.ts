/**
 * Analytics Queries 1-5 - TDD Tests
 *
 * Tests for pre-built analytics queries using the query builder.
 * Following RED → GREEN → REFACTOR discipline.
 */

import { describe, expect, test } from "bun:test";
import type { AnalyticsQuery } from "../types.js";
import {
	agentActivity,
	failedDecompositions,
	lockContention,
	messageLatency,
	strategySuccessRates,
} from "./index.js";

describe("Query 1: failed-decompositions", () => {
	test("should have correct name and description", () => {
		const query = failedDecompositions();

		expect(query.name).toBe("failed-decompositions");
		expect(query.description).toContain("failure");
		expect(query.description).toContain("strategy");
	});

	test("should select strategy, failure_count, and avg_duration_ms", () => {
		const query = failedDecompositions();

		expect(query.sql).toContain("strategy");
		expect(query.sql).toContain("COUNT(*)");
		expect(query.sql).toContain("AVG");
		expect(query.sql).toContain("duration_ms");
	});

	test("should use coordinator events (decision and outcome)", () => {
		const query = failedDecompositions();

		// Uses coordinator_decision for decomposition metadata
		expect(query.sql).toContain("coordinator_decision");
		expect(query.sql).toContain("decomposition_complete");
		// Uses coordinator_outcome for subtask results
		expect(query.sql).toContain("coordinator_outcome");
		expect(query.sql).toContain("subtask_success");
	});

	test("should group by strategy and order by failure count descending", () => {
		const query = failedDecompositions();

		expect(query.sql).toContain("GROUP BY");
		expect(query.sql).toContain("strategy");
		expect(query.sql).toContain("ORDER BY");
		expect(query.sql).toContain("failure_count");
		expect(query.sql).toContain("DESC");
	});

	test("should return AnalyticsQuery interface", () => {
		const query = failedDecompositions();

		// Should satisfy AnalyticsQuery type
		const _typeCheck: AnalyticsQuery = query;
		expect(query.name).toBeDefined();
		expect(query.description).toBeDefined();
		expect(query.sql).toBeDefined();
	});

	test("should optionally filter by project_key", () => {
		const query = failedDecompositions({ project_key: "test-project" });

		expect(query.sql).toContain("project_key");
		expect(query.sql).toContain("test-project");
	});

	test("should optionally limit results", () => {
		const query = failedDecompositions({ limit: 5 });

		expect(query.sql).toContain("LIMIT 5");
	});
});

describe("Query 2: strategy-success-rates", () => {
	test("should have correct name and description", () => {
		const query = strategySuccessRates();

		expect(query.name).toBe("strategy-success-rates");
		expect(query.description.toLowerCase()).toContain("success rate");
		expect(query.description.toLowerCase()).toContain("strategy");
	});

	test("should calculate total, successful, and failed counts", () => {
		const query = strategySuccessRates();

		expect(query.sql).toContain("COUNT(*)");
		// Should count successes and failures separately
		expect(query.sql).toContain("success");
		expect(query.sql).toContain("successful_count");
		expect(query.sql).toContain("failed_count");
	});

	test("should calculate success_rate as percentage", () => {
		const query = strategySuccessRates();

		// Success rate should be calculated (successful / total * 100)
		expect(query.sql.toLowerCase()).toContain("success_rate");
		expect(query.sql).toContain("*");
		expect(query.sql).toContain("100");
	});

	test("should use coordinator events (decision and outcome)", () => {
		const query = strategySuccessRates();

		expect(query.sql).toContain("coordinator_decision");
		expect(query.sql).toContain("coordinator_outcome");
	});

	test("should group by strategy", () => {
		const query = strategySuccessRates();

		expect(query.sql).toContain("GROUP BY");
		expect(query.sql).toContain("strategy");
	});

	test("should order by success_rate descending", () => {
		const query = strategySuccessRates();

		expect(query.sql).toContain("ORDER BY");
		expect(query.sql).toContain("success_rate");
		expect(query.sql).toContain("DESC");
	});

	test("should optionally filter by project_key", () => {
		const query = strategySuccessRates({ project_key: "test-project" });

		expect(query.sql).toContain("project_key");
		expect(query.sql).toContain("test-project");
	});
});

describe("Query 3: lock-contention", () => {
	test("should have correct name and description", () => {
		const query = lockContention();

		expect(query.name).toBe("lock-contention");
		expect(query.description.toLowerCase()).toContain("file");
		expect(query.description.toLowerCase()).toContain("reservation");
	});

	test("should extract path_pattern from reservation events", () => {
		const query = lockContention();

		expect(query.sql).toContain("json_extract(data, '$.path_pattern')");
	});

	test("should count reservations per file", () => {
		const query = lockContention();

		expect(query.sql).toContain("COUNT(*)");
		expect(query.sql.toLowerCase()).toContain("reservation_count");
	});

	test("should calculate average hold time", () => {
		const query = lockContention();

		expect(query.sql).toContain("AVG");
		expect(query.sql.toLowerCase()).toContain("hold_time");
		// Should compute duration (released - created or similar)
	});

	test("should filter for reservation events", () => {
		const query = lockContention();

		// Should look for reservation-related events
		expect(query.sql).toContain("reservation");
	});

	test("should group by path_pattern", () => {
		const query = lockContention();

		expect(query.sql).toContain("GROUP BY");
		expect(query.sql).toContain("path_pattern");
	});

	test("should order by reservation_count descending", () => {
		const query = lockContention();

		expect(query.sql).toContain("ORDER BY");
		expect(query.sql).toContain("reservation_count");
		expect(query.sql).toContain("DESC");
	});

	test("should optionally limit results", () => {
		const query = lockContention({ limit: 10 });

		expect(query.sql).toContain("LIMIT 10");
	});
});

describe("Query 4: agent-activity", () => {
	test("should have correct name and description", () => {
		const query = agentActivity();

		expect(query.name).toBe("agent-activity");
		expect(query.description).toContain("agent");
		expect(query.description).toContain("activity");
	});

	test("should extract agent_name from events", () => {
		const query = agentActivity();

		expect(query.sql).toContain("json_extract(data, '$.agent_name')");
	});

	test("should count events per agent", () => {
		const query = agentActivity();

		expect(query.sql).toContain("COUNT(*)");
		expect(query.sql.toLowerCase()).toContain("event_count");
	});

	test("should calculate time span (first to last event)", () => {
		const query = agentActivity();

		expect(query.sql).toContain("MIN(timestamp)");
		expect(query.sql).toContain("MAX(timestamp)");
		// Time span = max - min
	});

	test("should group by agent_name", () => {
		const query = agentActivity();

		expect(query.sql).toContain("GROUP BY");
		expect(query.sql).toContain("agent_name");
	});

	test("should order by event_count descending", () => {
		const query = agentActivity();

		expect(query.sql).toContain("ORDER BY");
		expect(query.sql).toContain("event_count");
		expect(query.sql).toContain("DESC");
	});

	test("should optionally filter by project_key", () => {
		const query = agentActivity({ project_key: "test-project" });

		expect(query.sql).toContain("project_key = ?");
	});

	test("should optionally filter by time range", () => {
		const since = Date.now() - 86400000; // 24h ago
		const query = agentActivity({ since });

		expect(query.sql).toContain("timestamp >");
		expect(query.parameters).toBeDefined();
		if (query.parameters) {
			expect(Object.values(query.parameters)).toContain(since);
		}
	});
});

describe("Query 5: message-latency", () => {
	test("should have correct name and description", () => {
		const query = messageLatency();

		expect(query.name).toBe("message-latency");
		expect(query.description.toLowerCase()).toContain("latency");
		expect(query.description.toLowerCase()).toContain("message");
	});

	test("should calculate percentiles (p50, p95, p99)", () => {
		const query = messageLatency();

		// SQLite doesn't have native percentile functions
		// But we can use ORDER BY + LIMIT + OFFSET for approximations
		// Or use json_extract to get latency values
		expect(query.sql.toLowerCase()).toContain("latency");
	});

	test("should work with message_sent and message_ack events", () => {
		const query = messageLatency();

		// Should handle messages that have both sent and ack events
		expect(query.sql).toContain("message");
	});

	test("should return p50, p95, p99 response times", () => {
		const query = messageLatency();

		// Should have columns for percentiles
		expect(query.sql.toLowerCase()).toMatch(/p50|p95|p99|percentile|median/);
	});

	test("should optionally filter by project_key", () => {
		const query = messageLatency({ project_key: "test-project" });

		expect(query.sql).toContain("project_key = ?");
	});
});

describe("Query exports", () => {
	test("all queries should be exported from index", () => {
		expect(failedDecompositions).toBeDefined();
		expect(strategySuccessRates).toBeDefined();
		expect(lockContention).toBeDefined();
		expect(agentActivity).toBeDefined();
		expect(messageLatency).toBeDefined();
	});

	test("all queries should be callable without arguments", () => {
		expect(() => failedDecompositions()).not.toThrow();
		expect(() => strategySuccessRates()).not.toThrow();
		expect(() => lockContention()).not.toThrow();
		expect(() => agentActivity()).not.toThrow();
		expect(() => messageLatency()).not.toThrow();
	});

	test("all queries should return AnalyticsQuery interface", () => {
		const queries = [
			failedDecompositions(),
			strategySuccessRates(),
			lockContention(),
			agentActivity(),
			messageLatency(),
		];

		for (const query of queries) {
			expect(query.name).toBeDefined();
			expect(query.description).toBeDefined();
			expect(query.sql).toBeDefined();
			expect(typeof query.name).toBe("string");
			expect(typeof query.description).toBe("string");
			expect(typeof query.sql).toBe("string");
		}
	});
});
