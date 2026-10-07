/**
 * Integration tests for swarm review feedback flow
 * 
 * Tests the coordinator review feedback workflow with real HiveAdapter and swarm-mail.
 * Verifies that review approval/rejection properly updates state.
 * 
 * **ARCHITECTURE**: Coordinator-driven retry pattern (swarm_spawn_retry)
 * - `approved` status: Sends message to worker (worker can complete)
 * - `needs_changes` status: NO message sent (worker is dead, coordinator spawns retry)
 * - After 3 rejections: Task marked blocked, NO message sent
 * 
 * This aligns with the "worker is dead" philosophy - failed reviews require coordinator
 * intervention via swarm_spawn_retry, not worker self-retry.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import {
	type SwarmMailAdapter,
	clearAdapterCache,
	getSwarmMailLibSQL,
} from "swarm-mail";
import {
	clearHiveAdapterCache,
	getHiveAdapter,
	hive_create,
	setHiveWorkingDirectory,
} from "./hive";
import { swarm_review, swarm_review_feedback } from "./swarm-review";

const mockContext = {
	sessionID: `test-review-integration-${Date.now()}`,
	messageID: `test-message-${Date.now()}`,
	agent: "test-coordinator",
	abort: new AbortController().signal,
};

describe("swarm_review integration", () => {
	let testProjectPath: string;
	let swarmMail: SwarmMailAdapter;

	beforeEach(async () => {
		// Create temp project directory
		testProjectPath = join(tmpdir(), `swarm-review-test-${Date.now()}`);
		mkdirSync(testProjectPath, { recursive: true });

		// Initialize swarm-mail with file-based database
		// (in-memory doesn't work with sendSwarmMessage's auto-adapter creation)
		swarmMail = await getSwarmMailLibSQL(testProjectPath);

		// Set hive working directory so hive tools work
		setHiveWorkingDirectory(testProjectPath);

		// Register coordinator and worker agents
		await swarmMail.registerAgent(testProjectPath, "coordinator", {
			program: "test",
			model: "test-model",
		});
		await swarmMail.registerAgent(testProjectPath, "TestWorker", {
			program: "test",
			model: "test-model",
		});
	});

	afterEach(async () => {
		// Clean up
		await swarmMail.close();
		clearAdapterCache();
		clearHiveAdapterCache();
		rmSync(testProjectPath, { recursive: true, force: true });
	});

	test("review approved flow", async () => {
		// Setup: create epic + subtask via hive tools
		const epicResult = await hive_create.execute(
			{
				title: "Test Epic",
				type: "epic",
				priority: 1,
			},
			mockContext
		);
		const epic = JSON.parse(epicResult);

		const subtaskResult = await hive_create.execute(
			{
				title: "Test Subtask",
				type: "task",
				priority: 2,
				parent_id: epic.id,
			},
			mockContext
		);
		const subtask = JSON.parse(subtaskResult);

		// Call swarm_review to generate review prompt
		const reviewResult = await swarm_review.execute(
			{
				project_key: testProjectPath,
				epic_id: epic.id,
				task_id: subtask.id,
				files_touched: ["test.ts"],
			},
			mockContext
		);

		const reviewParsed = JSON.parse(reviewResult);
		expect(reviewParsed).toHaveProperty("review_prompt");
		expect(reviewParsed.context.epic_id).toBe(epic.id);
		expect(reviewParsed.context.task_id).toBe(subtask.id);
		expect(reviewParsed.context.remaining_attempts).toBe(3);

		// Call swarm_review_feedback with status="approved"
		const feedbackResult = await swarm_review_feedback.execute(
			{
				project_key: testProjectPath,
				task_id: subtask.id,
				worker_id: "TestWorker",
				status: "approved",
				summary: "Looks good, clean implementation",
			},
			mockContext
		);

		const feedbackParsed = JSON.parse(feedbackResult);
		expect(feedbackParsed.success).toBe(true);
		expect(feedbackParsed.status).toBe("approved");
		expect(feedbackParsed.task_id).toBe(subtask.id);

		// Verify message was sent to worker
		const messages = await swarmMail.getInbox(
			testProjectPath,
			"TestWorker",
			{ limit: 10 }
		);
		expect(messages.length).toBeGreaterThan(0);

		const approvalMessage = messages.find((m) =>
			m.subject.includes("APPROVED")
		);
		expect(approvalMessage).toBeDefined();
		expect(approvalMessage?.subject).toContain(subtask.id);
	});

	test("review needs_changes flow", async () => {
		// Setup: create epic + subtask
		const epicResult = await hive_create.execute(
			{
				title: "Test Epic",
				type: "epic",
				priority: 1,
			},
			mockContext
		);
		const epic = JSON.parse(epicResult);

		const subtaskResult = await hive_create.execute(
			{
				title: "Test Subtask",
				type: "task",
				priority: 2,
				parent_id: epic.id,
			},
			mockContext
		);
		const subtask = JSON.parse(subtaskResult);

		// Call swarm_review_feedback with status="needs_changes"
		const issues = [
			{
				file: "src/auth.ts",
				line: 42,
				issue: "Missing null check",
				suggestion: "Add if (!token) return null",
			},
		];

		const feedbackResult = await swarm_review_feedback.execute(
			{
				project_key: testProjectPath,
				task_id: subtask.id,
				worker_id: "TestWorker",
				status: "needs_changes",
				issues: JSON.stringify(issues),
			},
			mockContext
		);

		const feedbackParsed = JSON.parse(feedbackResult);
		expect(feedbackParsed.success).toBe(true);
		expect(feedbackParsed.status).toBe("needs_changes");
		expect(feedbackParsed.attempt).toBe(1);
		expect(feedbackParsed.remaining_attempts).toBe(2);

		// Verify retry_context is provided for coordinator to spawn retry
		expect(feedbackParsed.retry_context).toBeDefined();
		expect(feedbackParsed.retry_context.task_id).toBe(subtask.id);
		expect(feedbackParsed.retry_context.attempt).toBe(1);
		expect(feedbackParsed.retry_context.max_attempts).toBe(3);
		expect(feedbackParsed.retry_context.issues).toEqual(issues);
		expect(feedbackParsed.retry_context.next_action).toContain("swarm_spawn_retry");

		// ARCHITECTURE CHANGE: No longer sends message to worker
		// Worker is considered "dead" - coordinator must spawn retry
		// Inbox should remain empty
		const messages = await swarmMail.getInbox(
			testProjectPath,
			"TestWorker",
			{ limit: 10 }
		);
		expect(messages.length).toBe(0);
	});

	test("3-strike rule: task marked blocked after 3 rejections", async () => {
		// Setup: create epic + subtask
		const epicResult = await hive_create.execute(
			{
				title: "Test Epic",
				type: "epic",
				priority: 1,
			},
			mockContext
		);
		const epic = JSON.parse(epicResult);

		const subtaskResult = await hive_create.execute(
			{
				title: "Test Subtask",
				type: "task",
				priority: 2,
				parent_id: epic.id,
			},
			mockContext
		);
		const subtask = JSON.parse(subtaskResult);

		const issues = [
			{
				file: "src/test.ts",
				issue: "Still broken",
			},
		];

		// Exhaust all 3 attempts
		for (let i = 1; i <= 3; i++) {
			const feedbackResult = await swarm_review_feedback.execute(
				{
					project_key: testProjectPath,
					task_id: subtask.id,
					worker_id: "TestWorker",
					status: "needs_changes",
					issues: JSON.stringify(issues),
				},
				mockContext
			);

			const feedbackParsed = JSON.parse(feedbackResult);
			expect(feedbackParsed.success).toBe(true);
			expect(feedbackParsed.status).toBe("needs_changes");
			expect(feedbackParsed.attempt).toBe(i);
			expect(feedbackParsed.remaining_attempts).toBe(3 - i);

			if (i === 3) {
				// Last attempt should mark task as failed
				expect(feedbackParsed.task_failed).toBe(true);
				expect(feedbackParsed.remaining_attempts).toBe(0);
			}
		}

		// Verify task was marked as blocked in hive
		const hive = await getHiveAdapter(testProjectPath);
		const updatedCell = await hive.getCell(testProjectPath, subtask.id);
		expect(updatedCell?.status).toBe("blocked");

		// ARCHITECTURE CHANGE: No longer sends failure message
		// Worker is dead, coordinator handles escalation
		// Inbox should remain empty
		const messages = await swarmMail.getInbox(
			testProjectPath,
			"TestWorker",
			{ limit: 10 }
		);
		expect(messages.length).toBe(0);
	});
});
