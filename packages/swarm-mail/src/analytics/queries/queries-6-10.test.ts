/**
 * Analytics Queries 6-10 - TDD Tests
 *
 * Tests for pre-built analytics queries:
 * 6. scope-violations - Files touched outside owned scope
 * 7. task-duration - p50/p95/p99 task durations
 * 8. checkpoint-frequency - How often agents checkpoint
 * 9. recovery-success - Recovery success rate
 * 10. human-feedback - Approval/rejection breakdown
 *
 * RED → GREEN → REFACTOR
 */

import { describe, expect, test } from "bun:test";
import { checkpointFrequency } from "./checkpoint-frequency.js";
import { humanFeedback } from "./human-feedback.js";
import { recoverySuccess } from "./recovery-success.js";
import { scopeViolations } from "./scope-violations.js";
import { taskDuration } from "./task-duration.js";

describe("scopeViolations", () => {
	test("should have required AnalyticsQuery fields", () => {
		expect(scopeViolations.name).toBe("scope-violations");
		expect(scopeViolations.description).toContain("scope");
		expect(scopeViolations.sql).toBeDefined();
		expect(scopeViolations.sql.length).toBeGreaterThan(0);
	});

	test("should query events for files touched outside scope", () => {
		const sql = scopeViolations.sql.toLowerCase();

		// Should query events table
		expect(sql).toContain("from events");

		// Should look for task completion events
		expect(sql).toContain("task_completed");

		// Should extract data field (contains files_touched)
		expect(sql).toContain("data");
	});

	test("should support optional project_key filter", () => {
		if (scopeViolations.buildQuery) {
			const query = scopeViolations.buildQuery({ project_key: "test-project" });
			expect(query.sql).toContain("?");
			expect(query.parameters).toBeDefined();
		}
	});
});

describe("taskDuration", () => {
	test("should have required AnalyticsQuery fields", () => {
		expect(taskDuration.name).toBe("task-duration");
		expect(taskDuration.description).toContain("duration");
		expect(taskDuration.sql).toBeDefined();
		expect(taskDuration.sql.length).toBeGreaterThan(0);
	});

	test("should calculate percentiles (p50, p95, p99)", () => {
		const sql = taskDuration.sql.toLowerCase();

		// Should query events
		expect(sql).toContain("from events");

		// Should calculate percentiles or use window functions
		// libSQL doesn't have percentile_cont, so we use NTILE or ORDER BY + LIMIT
		expect(sql).toMatch(/(ntile|row_number|percent_rank|order by)/);

		// Should look for task start and completion
		expect(sql).toMatch(/(task_started|task_completed)/);
	});

	test("should support optional project_key filter", () => {
		if (taskDuration.buildQuery) {
			const query = taskDuration.buildQuery({ project_key: "test-project" });
			expect(query.sql).toContain("?");
			expect(query.parameters).toBeDefined();
		}
	});
});

describe("checkpointFrequency", () => {
	test("should have required AnalyticsQuery fields", () => {
		expect(checkpointFrequency.name).toBe("checkpoint-frequency");
		expect(checkpointFrequency.description).toContain("checkpoint");
		expect(checkpointFrequency.sql).toBeDefined();
		expect(checkpointFrequency.sql.length).toBeGreaterThan(0);
	});

	test("should count checkpoints per agent", () => {
		const sql = checkpointFrequency.sql.toLowerCase();

		// Should query events
		expect(sql).toContain("from events");

		// Should look for checkpoint events
		expect(sql).toContain("checkpoint_created");

		// Should count by agent
		expect(sql).toContain("count");
		expect(sql).toMatch(/(group by|data)/);
	});

	test("should support optional project_key filter", () => {
		if (checkpointFrequency.buildQuery) {
			const query = checkpointFrequency.buildQuery({
				project_key: "test-project",
			});
			expect(query.sql).toContain("?");
			expect(query.parameters).toBeDefined();
		}
	});
});

describe("recoverySuccess", () => {
	test("should have required AnalyticsQuery fields", () => {
		expect(recoverySuccess.name).toBe("recovery-success");
		expect(recoverySuccess.description.toLowerCase()).toContain("recovery");
		expect(recoverySuccess.sql).toBeDefined();
		expect(recoverySuccess.sql.length).toBeGreaterThan(0);
	});

	test("should calculate success rate for recovery events", () => {
		const sql = recoverySuccess.sql.toLowerCase();

		// Should query events
		expect(sql).toContain("from events");

		// Should look for deferred resolution events
		expect(sql).toMatch(/(deferred_resolved|deferred_rejected)/);

		// Should calculate rate (percentage or count)
		expect(sql).toMatch(/(count|sum|case when)/);
	});

	test("should support optional project_key filter", () => {
		if (recoverySuccess.buildQuery) {
			const query = recoverySuccess.buildQuery({ project_key: "test-project" });
			expect(query.sql).toContain("?");
			expect(query.parameters).toBeDefined();
		}
	});
});

describe("humanFeedback", () => {
	test("should have required AnalyticsQuery fields", () => {
		expect(humanFeedback.name).toBe("human-feedback");
		expect(humanFeedback.description).toContain("feedback");
		expect(humanFeedback.sql).toBeDefined();
		expect(humanFeedback.sql.length).toBeGreaterThan(0);
	});

	test("should count approvals vs rejections", () => {
		const sql = humanFeedback.sql.toLowerCase();

		// Should query events
		expect(sql).toContain("from events");

		// Should look for review feedback events
		expect(sql).toContain("review_feedback");

		// Should count by status (approved vs needs_changes)
		expect(sql).toMatch(/(count|sum|group by|case when)/);
	});

	test("should support optional project_key filter", () => {
		if (humanFeedback.buildQuery) {
			const query = humanFeedback.buildQuery({ project_key: "test-project" });
			expect(query.sql).toContain("?");
			expect(query.parameters).toBeDefined();
		}
	});
});

describe("Integration - All queries should be valid SQL", () => {
	test("all queries should have valid SQL structure", () => {
		const queries = [
			scopeViolations,
			taskDuration,
			checkpointFrequency,
			recoverySuccess,
			humanFeedback,
		];

		for (const query of queries) {
			// Check required fields
			expect(query.name).toBeTruthy();
			expect(query.description).toBeTruthy();
			expect(query.sql).toBeTruthy();

			// Check SQL starts with SELECT
			const normalizedSql = query.sql.trim().toUpperCase();
			expect(normalizedSql).toMatch(/^(SELECT|WITH)/);

			// Check SQL contains FROM
			expect(query.sql.toUpperCase()).toContain("FROM");
		}
	});
});
