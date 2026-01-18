/**
 * Integration test for compaction event capture
 *
 * Verifies that captureCompactionEvent writes events to session JSONL
 * and that all event types are captured with correct data.
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, rmSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	captureCompactionEvent,
	ensureSessionDir,
	getSessionPath,
	readSessionEvents,
} from "./eval-capture";

describe("Compaction Event Capture Integration", () => {
	let testDir: string;
	let originalSessionsDir: string | undefined;
	const testSessionId = `test-compaction-${Date.now()}`;

	beforeAll(() => {
		// Create temp directory for test sessions
		testDir = mkdtempSync(join(tmpdir(), "compaction-test-"));
		originalSessionsDir = process.env.SWARM_SESSIONS_DIR;
		process.env.SWARM_SESSIONS_DIR = testDir;

		// Ensure directory exists
		ensureSessionDir();
	});

	afterAll(() => {
		// Restore original env var
		if (originalSessionsDir !== undefined) {
			process.env.SWARM_SESSIONS_DIR = originalSessionsDir;
		} else {
			delete process.env.SWARM_SESSIONS_DIR;
		}

		// Clean up test directory
		rmSync(testDir, { recursive: true, force: true });
	});

	it("captures detection_complete event with confidence and reasons", async () => {
		await captureCompactionEvent({
			session_id: testSessionId,
			epic_id: "cell-test-123",
			compaction_type: "detection_complete",
			payload: {
				confidence: "high",
				detected: true,
				reasons: ["3 cells in_progress", "2 open subtasks"],
				session_scan_contributed: true,
				session_scan_reasons: ["swarm tool calls found in session"],
				epic_id: "cell-test-123",
				epic_title: "Test Epic",
				subtask_count: 5,
			},
		});

		// Verify event was written to session file
		const sessionPath = getSessionPath(testSessionId);
		expect(existsSync(sessionPath)).toBe(true);

		// Read events from session
		const events = readSessionEvents(testSessionId);
		expect(events.length).toBe(1);

		const event = events[0];
		expect(event.session_id).toBe(testSessionId);
		expect(event.epic_id).toBe("cell-test-123");
		expect(event.event_type).toBe("COMPACTION");
		expect(event.compaction_type).toBe("detection_complete");

		// Verify payload structure
		expect(event.payload.confidence).toBe("high");
		expect(event.payload.detected).toBe(true);
		expect(event.payload.reasons).toEqual([
			"3 cells in_progress",
			"2 open subtasks",
		]);
		expect(event.payload.epic_id).toBe("cell-test-123");
		expect(event.payload.epic_title).toBe("Test Epic");
		expect(event.payload.subtask_count).toBe(5);
	});

	it("captures prompt_generated event with FULL prompt content", async () => {
		const fullPrompt = `
┌─────────────────────────────────────────┐
│   🐝  YOU ARE THE COORDINATOR  🐝       │
└─────────────────────────────────────────┘

# Swarm Continuation

**NON-NEGOTIABLE: YOU ARE THE COORDINATOR.**

## Epic State
**ID:** cell-epic-456
**Title:** Refactor authentication
**Status:** 2/5 subtasks complete

## Next Actions
1. Check swarm_status(epic_id="cell-epic-456")
2. Review completed work
3. Spawn remaining subtasks
`.trim();

		await captureCompactionEvent({
			session_id: testSessionId,
			epic_id: "cell-epic-456",
			compaction_type: "prompt_generated",
			payload: {
				prompt_length: fullPrompt.length,
				full_prompt: fullPrompt, // FULL content, not truncated
				context_type: "llm_generated",
				duration_ms: 1234,
			},
		});

		const events = readSessionEvents(testSessionId);
		const promptEvent = events.find(
			(e) => e.compaction_type === "prompt_generated",
		);

		expect(promptEvent).toBeDefined();
		if (promptEvent) {
			expect(promptEvent.payload.full_prompt).toBe(fullPrompt);
			expect(promptEvent.payload.prompt_length).toBe(fullPrompt.length);
			expect(promptEvent.payload.context_type).toBe("llm_generated");
			expect(promptEvent.payload.duration_ms).toBe(1234);
		}
	});

	it("captures context_injected event with FULL content", async () => {
		const fullContent = `[Swarm compaction: LLM-generated, high confidence]

# 🐝 Swarm State

**Epic:** cell-epic-789 - Add user permissions
**Project:** /Users/test/project

**Subtasks:**
  - 2 closed
  - 1 in_progress
  - 2 open

## COORDINATOR MANDATES

⛔ NEVER use edit/write directly - SPAWN A WORKER
✅ ALWAYS use swarm_spawn_subtask for implementation
✅ ALWAYS review with swarm_review
`;

		await captureCompactionEvent({
			session_id: testSessionId,
			epic_id: "cell-epic-789",
			compaction_type: "context_injected",
			payload: {
				full_content: fullContent, // FULL content, not truncated
				content_length: fullContent.length,
				injection_method: "output.prompt",
				context_type: "llm_generated",
			},
		});

		const events = readSessionEvents(testSessionId);
		const injectEvent = events.find(
			(e) => e.compaction_type === "context_injected",
		);

		expect(injectEvent).toBeDefined();
		if (injectEvent) {
			expect(injectEvent.payload.full_content).toBe(fullContent);
			expect(injectEvent.payload.content_length).toBe(fullContent.length);
			expect(injectEvent.payload.injection_method).toBe("output.prompt");
			expect(injectEvent.payload.context_type).toBe("llm_generated");
		}
	});

	it("captures all three event types in sequence", async () => {
		const sequenceSessionId = `test-sequence-${Date.now()}`;
		const sequencePath = getSessionPath(sequenceSessionId);

		try {
			// Simulate compaction lifecycle

			// 1. Detection
			await captureCompactionEvent({
				session_id: sequenceSessionId,
				epic_id: "cell-seq-123",
				compaction_type: "detection_complete",
				payload: {
					confidence: "medium",
					detected: true,
					reasons: ["1 unclosed epic"],
				},
			});

			// 2. Prompt generation
			await captureCompactionEvent({
				session_id: sequenceSessionId,
				epic_id: "cell-seq-123",
				compaction_type: "prompt_generated",
				payload: {
					full_prompt: "Test prompt content",
					prompt_length: 19,
				},
			});

			// 3. Context injection
			await captureCompactionEvent({
				session_id: sequenceSessionId,
				epic_id: "cell-seq-123",
				compaction_type: "context_injected",
				payload: {
					full_content: "Test context content",
					content_length: 20,
				},
			});

			// Verify all three events captured
			const events = readSessionEvents(sequenceSessionId);
			expect(events.length).toBe(3);

			const types = events.map((e) => e.compaction_type);
			expect(types).toContain("detection_complete");
			expect(types).toContain("prompt_generated");
			expect(types).toContain("context_injected");

			// Verify order (chronological by timestamp)
			const timestamps = events.map((e) => new Date(e.timestamp).getTime());
			expect(timestamps[0]).toBeLessThanOrEqual(timestamps[1]);
			expect(timestamps[1]).toBeLessThanOrEqual(timestamps[2]);
		} finally {
			// Clean up
			if (existsSync(sequencePath)) {
				unlinkSync(sequencePath);
			}
		}
	});

	it("validates event schema with Zod", async () => {
		// This should not throw - captureCompactionEvent validates internally
		await expect(async () => {
			await captureCompactionEvent({
				session_id: testSessionId,
				epic_id: "cell-validate-123",
				compaction_type: "detection_complete",
				payload: { confidence: "high" },
			});
		}).not.toThrow();
	});

	it("rejects invalid compaction_type", async () => {
		await expect(
			captureCompactionEvent({
				session_id: testSessionId,
				epic_id: "cell-invalid-123",
				// @ts-expect-error - intentionally invalid type
				compaction_type: "invalid_type",
				payload: {},
			}),
		).rejects.toThrow();
	});

	it("handles empty epic_id gracefully", async () => {
		await captureCompactionEvent({
			session_id: testSessionId,
			epic_id: "unknown",
			compaction_type: "detection_complete",
			payload: {
				confidence: "none",
				detected: false,
				reasons: [],
			},
		});

		const events = readSessionEvents(testSessionId);
		const unknownEvent = events.find((e) => e.epic_id === "unknown");
		expect(unknownEvent).toBeDefined();
	});
});
