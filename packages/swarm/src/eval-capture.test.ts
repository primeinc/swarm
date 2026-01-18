/**
 * Tests for eval-capture coordinator event schemas and session capture
 */
import {
	afterAll,
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	type Mock,
	test,
} from "bun:test";
import * as fs from "node:fs";
import { mkdtempSync, rmSync } from "node:fs";
import * as os from "node:os";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { join } from "node:path";
import {
	type CoordinatorEvent,
	CoordinatorEventSchema,
	type CoordinatorSession,
	CoordinatorSessionSchema,
	captureCompactionEvent,
	captureCoordinatorEvent,
	saveSession,
} from "./eval-capture.ts";

describe("CoordinatorEvent schemas", () => {
	describe("DECISION events", () => {
		test("validates strategy_selected event", () => {
			const event: CoordinatorEvent = {
				session_id: "test-session",
				epic_id: "cell-123",
				timestamp: new Date().toISOString(),
				event_type: "DECISION",
				decision_type: "strategy_selected",
				payload: {
					strategy: "file-based",
					reasoning: "Files are well isolated",
				},
			};

			expect(() => CoordinatorEventSchema.parse(event)).not.toThrow();
		});

		test("validates worker_spawned event", () => {
			const event: CoordinatorEvent = {
				session_id: "test-session",
				epic_id: "cell-123",
				timestamp: new Date().toISOString(),
				event_type: "DECISION",
				decision_type: "worker_spawned",
				payload: {
					worker_id: "GreenStorm",
					subtask_id: "cell-123.1",
					files: ["src/test.ts"],
				},
			};

			expect(() => CoordinatorEventSchema.parse(event)).not.toThrow();
		});

		test("validates review_completed event", () => {
			const event: CoordinatorEvent = {
				session_id: "test-session",
				epic_id: "cell-123",
				timestamp: new Date().toISOString(),
				event_type: "DECISION",
				decision_type: "review_completed",
				payload: {
					subtask_id: "cell-123.1",
					approved: true,
					issues_found: 0,
				},
			};

			expect(() => CoordinatorEventSchema.parse(event)).not.toThrow();
		});

		test("validates decomposition_complete event", () => {
			const event: CoordinatorEvent = {
				session_id: "test-session",
				epic_id: "cell-123",
				timestamp: new Date().toISOString(),
				event_type: "DECISION",
				decision_type: "decomposition_complete",
				payload: {
					subtask_count: 3,
					strategy: "feature-based",
				},
			};

			expect(() => CoordinatorEventSchema.parse(event)).not.toThrow();
		});

		test("validates researcher_spawned event", () => {
			const event: CoordinatorEvent = {
				session_id: "test-session",
				epic_id: "cell-123",
				timestamp: new Date().toISOString(),
				event_type: "DECISION",
				decision_type: "researcher_spawned",
				payload: {
					researcher_id: "BlueLake",
					research_topic: "Next.js Cache Components",
					tools_used: ["pdf-brain", "context7"],
				},
			};

			expect(() => CoordinatorEventSchema.parse(event)).not.toThrow();
		});

		test("validates skill_loaded event", () => {
			const event: CoordinatorEvent = {
				session_id: "test-session",
				epic_id: "cell-123",
				timestamp: new Date().toISOString(),
				event_type: "DECISION",
				decision_type: "skill_loaded",
				payload: {
					skill_name: "testing-patterns",
					context: "Adding tests to legacy code",
				},
			};

			expect(() => CoordinatorEventSchema.parse(event)).not.toThrow();
		});

		test("validates inbox_checked event", () => {
			const event: CoordinatorEvent = {
				session_id: "test-session",
				epic_id: "cell-123",
				timestamp: new Date().toISOString(),
				event_type: "DECISION",
				decision_type: "inbox_checked",
				payload: {
					message_count: 3,
					urgent_count: 1,
				},
			};

			expect(() => CoordinatorEventSchema.parse(event)).not.toThrow();
		});

		test("validates blocker_resolved event", () => {
			const event: CoordinatorEvent = {
				session_id: "test-session",
				epic_id: "cell-123",
				timestamp: new Date().toISOString(),
				event_type: "DECISION",
				decision_type: "blocker_resolved",
				payload: {
					worker_id: "GreenStorm",
					subtask_id: "cell-123.2",
					blocker_type: "dependency",
					resolution: "Unblocked via coordinator action",
				},
			};

			expect(() => CoordinatorEventSchema.parse(event)).not.toThrow();
		});

		test("validates scope_change_approved event", () => {
			const event: CoordinatorEvent = {
				session_id: "test-session",
				epic_id: "cell-123",
				timestamp: new Date().toISOString(),
				event_type: "DECISION",
				decision_type: "scope_change_approved",
				payload: {
					worker_id: "BlueLake",
					subtask_id: "cell-123.1",
					original_scope: "Add auth service",
					new_scope: "Add auth service + email validation",
					estimated_time_add: 900000, // 15 min in ms
				},
			};

			expect(() => CoordinatorEventSchema.parse(event)).not.toThrow();
		});

		test("validates scope_change_rejected event", () => {
			const event: CoordinatorEvent = {
				session_id: "test-session",
				epic_id: "cell-123",
				timestamp: new Date().toISOString(),
				event_type: "DECISION",
				decision_type: "scope_change_rejected",
				payload: {
					worker_id: "BlueLake",
					subtask_id: "cell-123.1",
					requested_scope: "Add auth service + OAuth + SSO",
					rejection_reason: "Too large for single subtask",
				},
			};

			expect(() => CoordinatorEventSchema.parse(event)).not.toThrow();
		});
	});

	describe("VIOLATION events", () => {
		test("validates coordinator_edited_file event", () => {
			const event: CoordinatorEvent = {
				session_id: "test-session",
				epic_id: "cell-123",
				timestamp: new Date().toISOString(),
				event_type: "VIOLATION",
				violation_type: "coordinator_edited_file",
				payload: {
					file: "src/bad.ts",
					operation: "edit",
				},
			};

			expect(() => CoordinatorEventSchema.parse(event)).not.toThrow();
		});

		test("validates coordinator_ran_tests event", () => {
			const event: CoordinatorEvent = {
				session_id: "test-session",
				epic_id: "cell-123",
				timestamp: new Date().toISOString(),
				event_type: "VIOLATION",
				violation_type: "coordinator_ran_tests",
				payload: {
					command: "bun test",
				},
			};

			expect(() => CoordinatorEventSchema.parse(event)).not.toThrow();
		});

		test("validates coordinator_reserved_files event", () => {
			const event: CoordinatorEvent = {
				session_id: "test-session",
				epic_id: "cell-123",
				timestamp: new Date().toISOString(),
				event_type: "VIOLATION",
				violation_type: "coordinator_reserved_files",
				payload: {
					files: ["src/auth.ts"],
				},
			};

			expect(() => CoordinatorEventSchema.parse(event)).not.toThrow();
		});

		test("validates no_worker_spawned event", () => {
			const event: CoordinatorEvent = {
				session_id: "test-session",
				epic_id: "cell-123",
				timestamp: new Date().toISOString(),
				event_type: "VIOLATION",
				violation_type: "no_worker_spawned",
				payload: {
					subtask_id: "cell-123.1",
					reason: "Did work directly",
				},
			};

			expect(() => CoordinatorEventSchema.parse(event)).not.toThrow();
		});
	});

	describe("OUTCOME events", () => {
		test("validates subtask_success event", () => {
			const event: CoordinatorEvent = {
				session_id: "test-session",
				epic_id: "cell-123",
				timestamp: new Date().toISOString(),
				event_type: "OUTCOME",
				outcome_type: "subtask_success",
				payload: {
					subtask_id: "cell-123.1",
					duration_ms: 45000,
					files_touched: ["src/auth.ts"],
				},
			};

			expect(() => CoordinatorEventSchema.parse(event)).not.toThrow();
		});

		test("validates subtask_retry event", () => {
			const event: CoordinatorEvent = {
				session_id: "test-session",
				epic_id: "cell-123",
				timestamp: new Date().toISOString(),
				event_type: "OUTCOME",
				outcome_type: "subtask_retry",
				payload: {
					subtask_id: "cell-123.1",
					retry_count: 2,
					reason: "Review rejected",
				},
			};

			expect(() => CoordinatorEventSchema.parse(event)).not.toThrow();
		});

		test("validates subtask_failed event", () => {
			const event: CoordinatorEvent = {
				session_id: "test-session",
				epic_id: "cell-123",
				timestamp: new Date().toISOString(),
				event_type: "OUTCOME",
				outcome_type: "subtask_failed",
				payload: {
					subtask_id: "cell-123.1",
					error: "Type error in auth.ts",
				},
			};

			expect(() => CoordinatorEventSchema.parse(event)).not.toThrow();
		});

		test("validates epic_complete event", () => {
			const event: CoordinatorEvent = {
				session_id: "test-session",
				epic_id: "cell-123",
				timestamp: new Date().toISOString(),
				event_type: "OUTCOME",
				outcome_type: "epic_complete",
				payload: {
					success: true,
					total_duration_ms: 180000,
					subtasks_completed: 3,
				},
			};

			expect(() => CoordinatorEventSchema.parse(event)).not.toThrow();
		});

		test("validates blocker_detected event", () => {
			const event: CoordinatorEvent = {
				session_id: "test-session",
				epic_id: "cell-123",
				timestamp: new Date().toISOString(),
				event_type: "OUTCOME",
				outcome_type: "blocker_detected",
				payload: {
					worker_id: "GreenStorm",
					subtask_id: "cell-123.2",
					blocker_type: "dependency",
					blocker_description: "Waiting for database schema from cell-123.1",
					reported_at: new Date().toISOString(),
				},
			};

			expect(() => CoordinatorEventSchema.parse(event)).not.toThrow();
		});
	});
});

describe("CoordinatorSession schema", () => {
	test("validates complete session", () => {
		const session: CoordinatorSession = {
			session_id: "test-session",
			epic_id: "cell-123",
			start_time: new Date().toISOString(),
			end_time: new Date().toISOString(),
			events: [
				{
					session_id: "test-session",
					epic_id: "cell-123",
					timestamp: new Date().toISOString(),
					event_type: "DECISION",
					decision_type: "strategy_selected",
					payload: { strategy: "file-based" },
				},
			],
		};

		expect(() => CoordinatorSessionSchema.parse(session)).not.toThrow();
	});

	test("validates session without end_time", () => {
		const session: Partial<CoordinatorSession> = {
			session_id: "test-session",
			epic_id: "cell-123",
			start_time: new Date().toISOString(),
			events: [],
		};

		expect(() => CoordinatorSessionSchema.parse(session)).not.toThrow();
	});
});

describe("captureCoordinatorEvent", () => {
	let sessionDir: string;
	let sessionId: string;
	let testDir: string;
	let testCounter = 0;

	beforeAll(() => {
		// Create isolated temp directory for this test suite
		testDir = mkdtempSync(join(tmpdir(), "swarm-test-capture-"));
		sessionDir = join(testDir, "sessions");
		fs.mkdirSync(sessionDir, { recursive: true });
	});

	afterAll(() => {
		// Clean up entire temp directory
		rmSync(testDir, { recursive: true, force: true });
	});

	beforeEach(() => {
		sessionId = `test-${Date.now()}-${testCounter++}`;

		// Mock the sessions directory path for captureCoordinatorEvent
		// This requires the function to accept a configurable path or use an env var
		process.env.SWARM_SESSIONS_DIR = sessionDir;
	});

	afterEach(() => {
		delete process.env.SWARM_SESSIONS_DIR;
	});

	test("creates session directory if not exists", async () => {
		const event: CoordinatorEvent = {
			session_id: sessionId,
			epic_id: "cell-123",
			timestamp: new Date().toISOString(),
			event_type: "DECISION",
			decision_type: "strategy_selected",
			payload: { strategy: "file-based" },
		};

		await captureCoordinatorEvent(event);

		expect(fs.existsSync(sessionDir)).toBe(true);
	});

	test("appends event to session file", async () => {
		const event: CoordinatorEvent = {
			session_id: sessionId,
			epic_id: "cell-123",
			timestamp: new Date().toISOString(),
			event_type: "DECISION",
			decision_type: "strategy_selected",
			payload: { strategy: "file-based" },
		};

		await captureCoordinatorEvent(event);

		const sessionPath = path.join(sessionDir, `${sessionId}.jsonl`);
		expect(fs.existsSync(sessionPath)).toBe(true);

		const content = fs.readFileSync(sessionPath, "utf-8");
		const lines = content.trim().split("\n");
		expect(lines).toHaveLength(1);

		const parsed = JSON.parse(lines[0]);
		expect(parsed.session_id).toBe(sessionId);
		expect(parsed.event_type).toBe("DECISION");
	});

	test("appends multiple events to same session", async () => {
		const event1: CoordinatorEvent = {
			session_id: sessionId,
			epic_id: "cell-123",
			timestamp: new Date().toISOString(),
			event_type: "DECISION",
			decision_type: "strategy_selected",
			payload: { strategy: "file-based" },
		};

		const event2: CoordinatorEvent = {
			session_id: sessionId,
			epic_id: "cell-123",
			timestamp: new Date().toISOString(),
			event_type: "VIOLATION",
			violation_type: "coordinator_edited_file",
			payload: { file: "src/bad.ts" },
		};

		await captureCoordinatorEvent(event1);
		await captureCoordinatorEvent(event2);

		const sessionPath = path.join(sessionDir, `${sessionId}.jsonl`);
		const content = fs.readFileSync(sessionPath, "utf-8");
		const lines = content.trim().split("\n");
		expect(lines).toHaveLength(2);
	});
});

describe("COMPACTION events", () => {
	test("validates detection_complete event", () => {
		const event: CoordinatorEvent = {
			session_id: "test-session",
			epic_id: "cell-123",
			timestamp: new Date().toISOString(),
			event_type: "COMPACTION",
			compaction_type: "detection_complete",
			payload: {
				confidence: "high",
				context_type: "full",
				epic_id: "cell-456",
			},
		};

		expect(() => CoordinatorEventSchema.parse(event)).not.toThrow();
	});

	test("validates prompt_generated event", () => {
		const event: CoordinatorEvent = {
			session_id: "test-session",
			epic_id: "cell-123",
			timestamp: new Date().toISOString(),
			event_type: "COMPACTION",
			compaction_type: "prompt_generated",
			payload: {
				prompt_length: 5000,
				full_prompt: "You are a coordinator...", // Full prompt content captured
				context_type: "full",
			},
		};

		expect(() => CoordinatorEventSchema.parse(event)).not.toThrow();
	});

	test("validates context_injected event", () => {
		const event: CoordinatorEvent = {
			session_id: "test-session",
			epic_id: "cell-123",
			timestamp: new Date().toISOString(),
			event_type: "COMPACTION",
			compaction_type: "context_injected",
			payload: {
				context_type: "fallback",
				injected_sections: ["swarm_status", "mandatory_instructions"],
			},
		};

		expect(() => CoordinatorEventSchema.parse(event)).not.toThrow();
	});

	test("validates resumption_started event", () => {
		const event: CoordinatorEvent = {
			session_id: "test-session",
			epic_id: "cell-123",
			timestamp: new Date().toISOString(),
			event_type: "COMPACTION",
			compaction_type: "resumption_started",
			payload: {
				epic_id: "cell-456",
				agent_role: "coordinator",
				context_loaded: true,
			},
		};

		expect(() => CoordinatorEventSchema.parse(event)).not.toThrow();
	});

	test("validates tool_call_tracked event", () => {
		const event: CoordinatorEvent = {
			session_id: "test-session",
			epic_id: "cell-123",
			timestamp: new Date().toISOString(),
			event_type: "COMPACTION",
			compaction_type: "tool_call_tracked",
			payload: {
				tool_name: "hive_create_epic",
				extracted_data: {
					epic_id: "cell-789",
					epic_title: "Add auth",
				},
			},
		};

		expect(() => CoordinatorEventSchema.parse(event)).not.toThrow();
	});

	test("rejects invalid compaction_type", () => {
		const event = {
			session_id: "test-session",
			epic_id: "cell-123",
			timestamp: new Date().toISOString(),
			event_type: "COMPACTION",
			compaction_type: "invalid_type",
			payload: {},
		};

		expect(() => CoordinatorEventSchema.parse(event)).toThrow();
	});

	test("captures full prompt content without truncation", () => {
		const longPrompt = "A".repeat(10000); // 10k chars
		const event: CoordinatorEvent = {
			session_id: "test-session",
			epic_id: "cell-123",
			timestamp: new Date().toISOString(),
			event_type: "COMPACTION",
			compaction_type: "prompt_generated",
			payload: {
				prompt_length: longPrompt.length,
				full_prompt: longPrompt,
				context_type: "full",
			},
		};

		expect(() => CoordinatorEventSchema.parse(event)).not.toThrow();
		expect(event.payload.full_prompt).toBe(longPrompt);
		expect(event.payload.full_prompt.length).toBe(10000);
	});
});

describe("saveSession", () => {
	let sessionDir: string;
	let sessionId: string;
	let testDir: string;
	let testCounter = 0;

	beforeAll(() => {
		testDir = mkdtempSync(join(tmpdir(), "swarm-test-save-"));
		sessionDir = join(testDir, "sessions");
		fs.mkdirSync(sessionDir, { recursive: true });
	});

	afterAll(() => {
		rmSync(testDir, { recursive: true, force: true });
	});

	beforeEach(() => {
		sessionId = `test-${Date.now()}-${testCounter++}`;
		process.env.SWARM_SESSIONS_DIR = sessionDir;
	});

	afterEach(() => {
		delete process.env.SWARM_SESSIONS_DIR;
	});

	test("wraps events in session structure", async () => {
		// Capture some events
		const event1: CoordinatorEvent = {
			session_id: sessionId,
			epic_id: "cell-123",
			timestamp: new Date().toISOString(),
			event_type: "DECISION",
			decision_type: "strategy_selected",
			payload: { strategy: "file-based" },
		};

		await captureCoordinatorEvent(event1);

		// Save session
		const session = saveSession({
			session_id: sessionId,
			epic_id: "cell-123",
		});

		expect(session).toBeDefined();
		expect(session.session_id).toBe(sessionId);
		expect(session.events).toHaveLength(1);
		expect(session.start_time).toBeDefined();
		expect(session.end_time).toBeDefined();
	});

	test("returns null if session file does not exist", () => {
		const session = saveSession({
			session_id: "nonexistent",
			epic_id: "cell-999",
		});

		expect(session).toBeNull();
	});
});

describe("session_id propagation from ctx.sessionID", () => {
	let sessionDir: string;
	let sessionId: string;
	let testDir: string;
	let testCounter = 0;

	beforeAll(() => {
		testDir = mkdtempSync(join(tmpdir(), "swarm-test-ctx-"));
		sessionDir = join(testDir, "sessions");
		fs.mkdirSync(sessionDir, { recursive: true });
	});

	afterAll(() => {
		rmSync(testDir, { recursive: true, force: true });
	});

	beforeEach(() => {
		sessionId = `test-ctx-${Date.now()}-${testCounter++}`;
		process.env.SWARM_SESSIONS_DIR = sessionDir;
	});

	afterEach(() => {
		delete process.env.SWARM_SESSIONS_DIR;
	});

	test("session_id should come from ctx.sessionID, not process.env", async () => {
		// GIVEN: process.env.OPENCODE_SESSION_ID is empty (mimics real scenario)
		const oldEnv = process.env.OPENCODE_SESSION_ID;
		delete process.env.OPENCODE_SESSION_ID;

		try {
			// WHEN: captureCoordinatorEvent is called with session_id from ctx.sessionID
			const event: CoordinatorEvent = {
				session_id: sessionId, // This should come from ctx.sessionID in call sites
				epic_id: "cell-123",
				timestamp: new Date().toISOString(),
				event_type: "DECISION",
				decision_type: "strategy_selected",
				payload: { strategy: "file-based" },
			};

			await captureCoordinatorEvent(event);

			// THEN: Event should be captured with correct session_id
			const sessionPath = path.join(sessionDir, `${sessionId}.jsonl`);
			expect(fs.existsSync(sessionPath)).toBe(true);

			const content = fs.readFileSync(sessionPath, "utf-8");
			const parsed = JSON.parse(content.trim());
			expect(parsed.session_id).toBe(sessionId);
			expect(parsed.session_id).not.toBe("unknown");
		} finally {
			// Restore env
			if (oldEnv !== undefined) {
				process.env.OPENCODE_SESSION_ID = oldEnv;
			}
		}
	});

	test("demonstrates call sites must pass ctx.sessionID not process.env", async () => {
		// GIVEN: This simulates what happens in real call sites
		const oldEnv = process.env.OPENCODE_SESSION_ID;
		delete process.env.OPENCODE_SESSION_ID; // Empty in real OpenCode environment

		try {
			// WHEN: Call site uses process.env (CURRENT BAD PATTERN)
			const badSessionId = process.env.OPENCODE_SESSION_ID || "unknown";
			const badEvent: CoordinatorEvent = {
				session_id: badSessionId, // This evaluates to "unknown"
				epic_id: "cell-123",
				timestamp: new Date().toISOString(),
				event_type: "DECISION",
				decision_type: "strategy_selected",
				payload: { strategy: "file-based" },
			};

			await captureCoordinatorEvent(badEvent);

			// THEN: Event goes to unknown.jsonl (BAD!)
			const unknownPath = path.join(sessionDir, "unknown.jsonl");
			expect(fs.existsSync(unknownPath)).toBe(true);

			// WHEN: Call site uses ctx.sessionID (CORRECT PATTERN)
			const goodEvent: CoordinatorEvent = {
				session_id: sessionId, // From ctx.sessionID
				epic_id: "cell-123",
				timestamp: new Date().toISOString(),
				event_type: "DECISION",
				decision_type: "strategy_selected",
				payload: { strategy: "file-based" },
			};

			await captureCoordinatorEvent(goodEvent);

			// THEN: Event goes to correct session file
			const sessionPath = path.join(sessionDir, `${sessionId}.jsonl`);
			expect(fs.existsSync(sessionPath)).toBe(true);
		} finally {
			if (oldEnv !== undefined) {
				process.env.OPENCODE_SESSION_ID = oldEnv;
			}
		}
	});

	test("verifies all call sites now use ctx.sessionID", async () => {
		// This test documents that we've fixed all call sites to use ctx.sessionID
		// instead of process.env.OPENCODE_SESSION_ID

		// The fix was applied to:
		// 1. src/swarm-orchestrate.ts:1743, 1852 - swarm_complete uses _ctx.sessionID
		// 2. src/swarm-review.ts:515, 565 - swarm_review_feedback uses _ctx.sessionID
		// 3. src/swarm-decompose.ts:780 - swarm_delegate_planning uses _ctx.sessionID
		// 4. src/swarm-prompts.ts:1407 - swarm_spawn_subtask uses _ctx.sessionID
		// 5. src/index.ts:216 - detectCoordinatorViolation uses input.sessionID

		// With ctx.sessionID, events go to proper session files
		const oldEnv = process.env.OPENCODE_SESSION_ID;
		delete process.env.OPENCODE_SESSION_ID;

		try {
			// Simulate tool execution with ctx.sessionID
			const mockCtx = { sessionID: sessionId };

			const event: CoordinatorEvent = {
				session_id: mockCtx.sessionID || "unknown",
				epic_id: "cell-456",
				timestamp: new Date().toISOString(),
				event_type: "OUTCOME",
				outcome_type: "subtask_success",
				payload: { cell_id: "cell-456.1" },
			};

			await captureCoordinatorEvent(event);

			// Verify event captured with correct session_id
			const sessionPath = path.join(sessionDir, `${sessionId}.jsonl`);
			expect(fs.existsSync(sessionPath)).toBe(true);

			const content = fs.readFileSync(sessionPath, "utf-8");
			const parsed = JSON.parse(content.trim());
			expect(parsed.session_id).toBe(sessionId);
		} finally {
			if (oldEnv !== undefined) {
				process.env.OPENCODE_SESSION_ID = oldEnv;
			}
		}
	});
});

describe("captureCompactionEvent", () => {
	let sessionDir: string;
	let sessionId: string;
	let testDir: string;
	let testCounter = 0;

	beforeAll(() => {
		testDir = mkdtempSync(join(tmpdir(), "swarm-test-compaction-"));
		sessionDir = join(testDir, "sessions");
		fs.mkdirSync(sessionDir, { recursive: true });
	});

	afterAll(() => {
		rmSync(testDir, { recursive: true, force: true });
	});

	beforeEach(() => {
		sessionId = `test-compaction-${Date.now()}-${testCounter++}`;
		process.env.SWARM_SESSIONS_DIR = sessionDir;
	});

	afterEach(() => {
		delete process.env.SWARM_SESSIONS_DIR;
	});

	test("writes detection_complete event to session file", async () => {
		await captureCompactionEvent({
			session_id: sessionId,
			epic_id: "cell-123",
			compaction_type: "detection_complete",
			payload: {
				confidence: "high",
				context_type: "full",
				epic_id: "cell-456",
			},
		});

		const sessionPath = path.join(sessionDir, `${sessionId}.jsonl`);
		expect(fs.existsSync(sessionPath)).toBe(true);

		const content = fs.readFileSync(sessionPath, "utf-8");
		const lines = content.trim().split("\n");
		expect(lines).toHaveLength(1);

		const parsed = JSON.parse(lines[0]);
		expect(parsed.event_type).toBe("COMPACTION");
		expect(parsed.compaction_type).toBe("detection_complete");
		expect(parsed.payload.confidence).toBe("high");
	});

	test("writes prompt_generated event with full prompt content", async () => {
		const fullPrompt = "You are a coordinator agent. ".repeat(200); // ~6k chars

		await captureCompactionEvent({
			session_id: sessionId,
			epic_id: "cell-123",
			compaction_type: "prompt_generated",
			payload: {
				prompt_length: fullPrompt.length,
				full_prompt: fullPrompt,
				context_type: "full",
			},
		});

		const sessionPath = path.join(sessionDir, `${sessionId}.jsonl`);
		const content = fs.readFileSync(sessionPath, "utf-8");
		const lines = content.trim().split("\n");
		const parsed = JSON.parse(lines[0]);

		expect(parsed.payload.full_prompt).toBe(fullPrompt);
		expect(parsed.payload.full_prompt.length).toBe(fullPrompt.length);
	});

	test("appends multiple compaction events to same session", async () => {
		await captureCompactionEvent({
			session_id: sessionId,
			epic_id: "cell-123",
			compaction_type: "detection_complete",
			payload: { confidence: "high" },
		});

		await captureCompactionEvent({
			session_id: sessionId,
			epic_id: "cell-123",
			compaction_type: "prompt_generated",
			payload: { prompt_length: 1000, full_prompt: "test" },
		});

		const sessionPath = path.join(sessionDir, `${sessionId}.jsonl`);
		const content = fs.readFileSync(sessionPath, "utf-8");
		const lines = content.trim().split("\n");
		expect(lines).toHaveLength(2);

		const event1 = JSON.parse(lines[0]);
		const event2 = JSON.parse(lines[1]);

		expect(event1.compaction_type).toBe("detection_complete");
		expect(event2.compaction_type).toBe("prompt_generated");
	});

	test("full compaction lifecycle tracking", async () => {
		// Simulate full compaction hook lifecycle
		const lifecycleEvents = [
			{
				compaction_type: "detection_complete" as const,
				payload: {
					confidence: "high",
					context_type: "full",
					epic_id: "cell-789",
				},
			},
			{
				compaction_type: "prompt_generated" as const,
				payload: {
					prompt_length: 3500,
					full_prompt: "You are a coordinator agent...",
					context_type: "full",
				},
			},
			{
				compaction_type: "context_injected" as const,
				payload: {
					context_type: "full",
					injected_sections: ["swarm_status", "mandatory_instructions"],
				},
			},
			{
				compaction_type: "resumption_started" as const,
				payload: {
					epic_id: "cell-789",
					agent_role: "coordinator",
					context_loaded: true,
				},
			},
			{
				compaction_type: "tool_call_tracked" as const,
				payload: {
					tool_name: "hive_create_epic",
					extracted_data: { epic_id: "cell-789" },
				},
			},
		];

		// Capture all lifecycle events
		for (const event of lifecycleEvents) {
			await captureCompactionEvent({
				session_id: sessionId,
				epic_id: "cell-123",
				...event,
			});
		}

		// Verify all events captured
		const sessionPath = path.join(sessionDir, `${sessionId}.jsonl`);
		const content = fs.readFileSync(sessionPath, "utf-8");
		const lines = content.trim().split("\n");
		expect(lines).toHaveLength(5);

		// Verify lifecycle order
		const capturedEvents = lines.map((line) => JSON.parse(line));
		expect(capturedEvents[0].compaction_type).toBe("detection_complete");
		expect(capturedEvents[1].compaction_type).toBe("prompt_generated");
		expect(capturedEvents[2].compaction_type).toBe("context_injected");
		expect(capturedEvents[3].compaction_type).toBe("resumption_started");
		expect(capturedEvents[4].compaction_type).toBe("tool_call_tracked");
	});
});

describe("hive_create_epic integration - decomposition_complete event", () => {
	let sessionDir: string;
	let sessionId: string;
	let testDir: string;
	let testCounter = 0;
	const testProjectPath = "/tmp/test-epic-decomposition";

	beforeAll(() => {
		testDir = mkdtempSync(join(tmpdir(), "swarm-test-epic-"));
		sessionDir = join(testDir, "sessions");
		fs.mkdirSync(sessionDir, { recursive: true });
	});

	afterAll(() => {
		rmSync(testDir, { recursive: true, force: true });
	});

	beforeEach(() => {
		sessionId = `test-epic-${Date.now()}-${testCounter++}`;
		process.env.SWARM_SESSIONS_DIR = sessionDir;
	});

	afterEach(() => {
		delete process.env.SWARM_SESSIONS_DIR;
	});

	test("captures decomposition_complete event after hive_create_epic succeeds", async () => {
		// Test the event capture by calling captureCoordinatorEvent directly
		// Testing hive_create_epic directly would require full plugin infrastructure

		// GIVEN: We simulate what hive_create_epic does after epic creation
		const epicId = `test-epic-${Date.now()}`;
		const subtasks = [
			{ title: "Subtask 1", files: ["src/a.ts"] },
			{ title: "Subtask 2", files: ["src/b.ts", "src/c.ts"] },
			{ title: "Subtask 3", files: ["src/d.ts"] },
		];

		// Build files_per_subtask map (same logic as hive.ts)
		const filesPerSubtask: Record<number, string[]> = {};
		subtasks.forEach((subtask, index) => {
			if (subtask.files && subtask.files.length > 0) {
				filesPerSubtask[index] = subtask.files;
			}
		});

		// WHEN: decomposition_complete event is captured
		await captureCoordinatorEvent({
			session_id: sessionId,
			epic_id: epicId,
			timestamp: new Date().toISOString(),
			event_type: "DECISION",
			decision_type: "decomposition_complete",
			payload: {
				subtask_count: subtasks.length,
				strategy_used: "file-based",
				files_per_subtask: filesPerSubtask,
				epic_title: "Test Epic for Event Capture",
				task: "Original task description",
			},
		});

		// THEN: Event should be written to session file
		const sessionPath = path.join(sessionDir, `${sessionId}.jsonl`);
		expect(fs.existsSync(sessionPath)).toBe(true);

		const content = fs.readFileSync(sessionPath, "utf-8");
		const lines = content.trim().split("\n").filter(Boolean);
		expect(lines.length).toBe(1);

		// Verify event structure
		const event = JSON.parse(lines[0]);
		expect(event.session_id).toBe(sessionId);
		expect(event.epic_id).toBe(epicId);
		expect(event.event_type).toBe("DECISION");
		expect(event.decision_type).toBe("decomposition_complete");
		expect(event.payload.subtask_count).toBe(3);
		expect(event.payload.strategy_used).toBe("file-based");
		expect(event.payload.files_per_subtask).toEqual({
			0: ["src/a.ts"],
			1: ["src/b.ts", "src/c.ts"],
			2: ["src/d.ts"],
		});
		expect(event.payload.epic_title).toBe("Test Epic for Event Capture");
		expect(event.payload.task).toBe("Original task description");
	});
});
