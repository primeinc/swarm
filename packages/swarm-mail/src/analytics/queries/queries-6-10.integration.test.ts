/**
 * Analytics Queries 6-10 - Integration Tests
 *
 * Tests queries against actual libSQL database with real events.
 * Verifies SQL executes correctly and returns expected structure.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { SwarmMailAdapter } from "../../adapter.js";
import { createInMemorySwarmMailLibSQL } from "../../libsql.convenience.js";
import { checkpointFrequency } from "./checkpoint-frequency.js";
import { humanFeedback } from "./human-feedback.js";
import { recoverySuccess } from "./recovery-success.js";
import { scopeViolations } from "./scope-violations.js";
import { taskDuration } from "./task-duration.js";

describe("Analytics Queries 6-10 Integration", () => {
	let swarmMail: SwarmMailAdapter;
	const testProjectPath = "/test/analytics-queries-6-10";

	beforeAll(async () => {
		swarmMail = await createInMemorySwarmMailLibSQL(testProjectPath);
		const db = await swarmMail.getDatabase();

		// Seed test events using query (not exec with params)
		const events = [
			// Task lifecycle events for task-duration
			{
				type: "task_started",
				data: { cell_id: "task-1", agent_name: "AgentA" },
				timestamp: 1000,
			},
			{
				type: "task_completed",
				data: {
					cell_id: "task-1",
					agent_name: "AgentA",
					files_touched: ["src/a.ts", "src/b.ts"],
				},
				timestamp: 5000,
			},
			{
				type: "task_started",
				data: { cell_id: "task-2", agent_name: "AgentB" },
				timestamp: 2000,
			},
			{
				type: "task_completed",
				data: {
					cell_id: "task-2",
					agent_name: "AgentB",
					files_touched: ["src/c.ts"],
				},
				timestamp: 10000,
			},
			// Checkpoint events
			{
				type: "checkpoint_created",
				data: { agent_name: "AgentA", checkpoint_id: "cp-1" },
				timestamp: 3000,
			},
			{
				type: "checkpoint_created",
				data: { agent_name: "AgentA", checkpoint_id: "cp-2" },
				timestamp: 6000,
			},
			{
				type: "checkpoint_created",
				data: { agent_name: "AgentB", checkpoint_id: "cp-3" },
				timestamp: 9000,
			},
			// Recovery events
			{
				type: "deferred_resolved",
				data: { deferred_id: "def-1" },
				timestamp: 4000,
			},
			{
				type: "deferred_resolved",
				data: { deferred_id: "def-2" },
				timestamp: 7000,
			},
			{
				type: "deferred_rejected",
				data: { deferred_id: "def-3" },
				timestamp: 8000,
			},
			// Review feedback
			{
				type: "review_feedback",
				data: { status: "approved", task_id: "task-1" },
				timestamp: 11000,
			},
			{
				type: "review_feedback",
				data: { status: "approved", task_id: "task-2" },
				timestamp: 12000,
			},
			{
				type: "review_feedback",
				data: { status: "needs_changes", task_id: "task-3" },
				timestamp: 13000,
			},
		];

		// Insert using query with parameters
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

	test("scopeViolations - should return files touched in completed tasks", async () => {
		const db = await swarmMail.getDatabase();
		const result = await db.query(scopeViolations.sql);

		expect(result.rows.length).toBeGreaterThan(0);

		// Should have columns we expect
		const firstRow = result.rows[0];
		expect(firstRow).toHaveProperty("agent");
		expect(firstRow).toHaveProperty("task_id");
		expect(firstRow).toHaveProperty("files_touched");
	});

	test("scopeViolations with filter - should filter by project_key", async () => {
		const db = await swarmMail.getDatabase();
		if (scopeViolations.buildQuery) {
			const filtered = scopeViolations.buildQuery({
				project_key: testProjectPath,
			});
			const result = await db.query(
				filtered.sql,
				Object.values(filtered.parameters || {}),
			);

			expect(result.rows.length).toBe(2); // 2 completed tasks
		}
	});

	test("taskDuration - should calculate percentiles", async () => {
		const db = await swarmMail.getDatabase();
		const result = await db.query(taskDuration.sql);

		expect(result.rows.length).toBe(1); // Single row with aggregates

		const row = result.rows[0];
		expect(row).toHaveProperty("p50_ms");
		expect(row).toHaveProperty("p95_ms");
		expect(row).toHaveProperty("p99_ms");
		expect(row).toHaveProperty("total_tasks");

		// Should have 2 completed tasks
		expect(row.total_tasks).toBe(2);
	});

	test("checkpointFrequency - should count checkpoints per agent", async () => {
		const db = await swarmMail.getDatabase();
		const result = await db.query(checkpointFrequency.sql);

		expect(result.rows.length).toBe(2); // 2 agents created checkpoints

		const agentA = result.rows.find((r) => r.agent === "AgentA");
		expect(agentA).toBeDefined();
		if (agentA) {
			expect(agentA.checkpoint_count).toBe(2);
		}

		const agentB = result.rows.find((r) => r.agent === "AgentB");
		expect(agentB).toBeDefined();
		if (agentB) {
			expect(agentB.checkpoint_count).toBe(1);
		}
	});

	test("recoverySuccess - should calculate success rate", async () => {
		const db = await swarmMail.getDatabase();
		const result = await db.query(recoverySuccess.sql);

		expect(result.rows.length).toBe(1); // Single row with aggregates

		const row = result.rows[0];
		expect(row).toHaveProperty("resolved_count");
		expect(row).toHaveProperty("rejected_count");
		expect(row).toHaveProperty("total_count");
		expect(row).toHaveProperty("success_rate_pct");

		// 2 resolved, 1 rejected
		expect(row.resolved_count).toBe(2);
		expect(row.rejected_count).toBe(1);
		expect(row.total_count).toBe(3);

		// Success rate should be 66.67% (2/3)
		expect(row.success_rate_pct).toBeCloseTo(66.67, 1);
	});

	test("humanFeedback - should breakdown by status", async () => {
		const db = await swarmMail.getDatabase();
		const result = await db.query(humanFeedback.sql);

		expect(result.rows.length).toBe(2); // 2 distinct statuses

		const approved = result.rows.find((r) => r.status === "approved");
		expect(approved).toBeDefined();
		if (approved) {
			expect(approved.count).toBe(2);
		}

		const needsChanges = result.rows.find((r) => r.status === "needs_changes");
		expect(needsChanges).toBeDefined();
		if (needsChanges) {
			expect(needsChanges.count).toBe(1);
		}
	});

	test("humanFeedback with filter - should filter by project_key", async () => {
		const db = await swarmMail.getDatabase();
		if (humanFeedback.buildQuery) {
			const filtered = humanFeedback.buildQuery({
				project_key: testProjectPath,
			});
			const result = await db.query(
				filtered.sql,
				Object.values(filtered.parameters || {}),
			);

			expect(result.rows.length).toBe(2); // Same results (all events in test project)
		}
	});

	test("all queries should execute without errors", async () => {
		const db = await swarmMail.getDatabase();
		const queries = [
			scopeViolations,
			taskDuration,
			checkpointFrequency,
			recoverySuccess,
			humanFeedback,
		];

		for (const query of queries) {
			// Should not throw
			await expect(db.query(query.sql)).resolves.toBeDefined();
		}
	});
});
