/**
 * Tests for Compaction Threshold Detection
 *
 * TDD: RED phase - these tests define desired behavior for threshold tuning.
 *
 * Problem: Compaction events are surprisingly low (detection_complete: 4, context_injected: 3).
 * Either sessions are short, or compaction isn't triggering when it should.
 *
 * Our compaction hook is REACTIVE (called BY OpenCode on compaction).
 * We can't control WHEN OpenCode triggers compaction.
 *
 * What we CAN do:
 * 1. Make our DETECTION more sensitive (lower thresholds for "swarm detected")
 * 2. Add INSTRUMENTATION to log "should compact now" signals
 * 3. Add metrics to expose when we WOULD trigger (if we could)
 */

import { beforeEach, describe, expect, it } from "bun:test";
import {
	type CompactionHookOptions,
	createCompactionHook,
} from "./compaction-hook";

// Track log calls for verification
let logCalls: Array<{ level: string; data: any; message?: string }> = [];

/**
 * Create a mock logger that captures all log calls
 */
const createMockLogger = () => ({
	info: (data: any, message?: string) => {
		logCalls.push({ level: "info", data, message });
	},
	debug: (data: any, message?: string) => {
		logCalls.push({ level: "debug", data, message });
	},
	warn: (data: any, message?: string) => {
		logCalls.push({ level: "warn", data, message });
	},
	error: (data: any, message?: string) => {
		logCalls.push({ level: "error", data, message });
	},
});

/**
 * Default mock options for tests
 */
const createDefaultMockOptions = (): CompactionHookOptions => ({
	getHiveWorkingDirectory: () => "/test/project",
	getHiveAdapter: async () => ({
		queryCells: async () => [],
	}),
	checkSwarmHealth: async () => ({
		healthy: true,
		database: "connected",
		stats: {
			events: 0,
			agents: 0,
			messages: 0,
			reservations: 0,
		},
	}),
	logger: createMockLogger(),
});

describe("Compaction Threshold Detection", () => {
	beforeEach(() => {
		logCalls = [];
	});

	describe("Swarm signature detection (lowered thresholds)", () => {
		it("detects swarm from SINGLE open subtask (was: required multiple)", async () => {
			// RESEARCH FINDING: Swarms starting but not triggering compaction
			// HYPOTHESIS: Threshold too high - waiting for multiple subtasks
			// TUNING: Lower to 1 open subtask = medium confidence

			const hook = createCompactionHook({
				getHiveWorkingDirectory: () => "/test/project",
				getHiveAdapter: async () => ({
					queryCells: async () => [
						{
							id: "cell-epic-123",
							title: "Epic",
							type: "epic",
							status: "in_progress",
							parent_id: null,
							updated_at: Date.now(),
						},
						{
							id: "cell-epic-123.1",
							title: "Single subtask",
							type: "task",
							status: "open",
							parent_id: "cell-epic-123",
							updated_at: Date.now(),
						},
					],
				}),
				checkSwarmHealth: async () => ({
					healthy: true,
					database: "connected",
					stats: { events: 0, agents: 0, messages: 0, reservations: 0 },
				}),
				logger: createMockLogger(),
			});

			const output = { context: [] as string[] };
			await hook({ sessionID: "test" }, output);

			// Should inject context with just 1 subtask
			expect(output.context.length).toBeGreaterThan(0);
			expect(output.context[0]).toContain("cell-epic-123");
		});

		it("detects swarm from SINGLE agent registration (was: required activity)", async () => {
			// RESEARCH FINDING: Early swarm activity not detected
			// HYPOTHESIS: Threshold too high - waiting for messages/reservations
			// TUNING: 1 registered agent = low confidence (should inject fallback)

			const hook = createCompactionHook({
				getHiveWorkingDirectory: () => "/test/project",
				getHiveAdapter: async () => ({ queryCells: async () => [] }),
				checkSwarmHealth: async () => ({
					healthy: true,
					database: "connected",
					stats: {
						events: 0,
						agents: 1, // Single agent registered
						messages: 0,
						reservations: 0,
					},
				}),
				logger: createMockLogger(),
			});

			const output = { context: [] as string[] };
			await hook({ sessionID: "test" }, output);

			// Should inject at least fallback detection prompt
			expect(output.context.length).toBeGreaterThan(0);
		});

		it("detects swarm from recent cell activity (30min window, was: 1 hour)", async () => {
			// RESEARCH FINDING: Active sessions not triggering compaction
			// HYPOTHESIS: Time window too wide - missing active work
			// TUNING: Reduce from 1 hour to 30 minutes

			const thirtyMinutesAgo = Date.now() - 30 * 60 * 1000;

			const hook = createCompactionHook({
				getHiveWorkingDirectory: () => "/test/project",
				getHiveAdapter: async () => ({
					queryCells: async () => [
						{
							id: "cell-task-1",
							title: "Recent task",
							type: "task",
							status: "open",
							parent_id: null,
							updated_at: thirtyMinutesAgo + 1000, // Just inside 30min window
						},
					],
				}),
				checkSwarmHealth: async () => ({
					healthy: true,
					database: "connected",
					stats: { events: 0, agents: 0, messages: 0, reservations: 0 },
				}),
				logger: createMockLogger(),
			});

			const output = { context: [] as string[] };
			await hook({ sessionID: "test" }, output);

			// Should detect as medium confidence
			expect(output.context.length).toBeGreaterThan(0);
		});
	});

	describe("Session message scanning (tool call patterns)", () => {
		it("boosts confidence from session tool calls even with no hive state", async () => {
			// RESEARCH FINDING: Sessions with tool calls not detected
			// HYPOTHESIS: Relying too heavily on hive state, not session evidence
			// TUNING: Tool calls in session = high confidence boost

			const mockClient = {
				session: {
					messages: async () => ({
						data: [
							{
								info: { id: "msg-1" },
								parts: [
									{
										type: "tool",
										tool: "swarm_spawn_subtask",
										state: {
											status: "completed",
											input: {
												cell_id: "cell-123.1",
												epic_id: "epic-123",
												subtask_title: "Work",
											},
											output: "{}",
											time: { start: 1000, end: 2000 },
										},
									},
								],
							},
						],
					}),
				},
			};

			const hook = createCompactionHook({
				client: mockClient,
				getHiveWorkingDirectory: () => "/test/project",
				getHiveAdapter: async () => ({ queryCells: async () => [] }), // Empty hive
				checkSwarmHealth: async () => ({
					healthy: true,
					database: "connected",
					stats: { events: 0, agents: 0, messages: 0, reservations: 0 },
				}),
				logger: createMockLogger(),
			});

			const output = { context: [] as string[] };
			await hook({ sessionID: "test" }, output);

			// Should inject FULL context, not fallback
			expect(output.context.length).toBeGreaterThan(0);
			expect(output.context[0]).toContain("YOU ARE THE COORDINATOR");
			expect(output.context[0]).toContain("epic-123"); // From scanned state
		});

		it("detects from swarmmail_init even without spawned workers", async () => {
			// RESEARCH FINDING: Coordinator sessions before worker spawn not detected
			// HYPOTHESIS: Waiting for spawn evidence, missing setup phase
			// TUNING: swarmmail_init = medium confidence (coordinator is setting up)

			const mockClient = {
				session: {
					messages: async () => ({
						data: [
							{
								info: { id: "msg-1" },
								parts: [
									{
										type: "tool",
										tool: "swarmmail_init",
										state: {
											status: "completed",
											input: {},
											output: JSON.stringify({
												agent_name: "CoordinatorAlpha",
												project_key: "/test/project",
											}),
											time: { start: 1000, end: 2000 },
										},
									},
								],
							},
						],
					}),
				},
			};

			const hook = createCompactionHook({
				client: mockClient,
				getHiveWorkingDirectory: () => "/test/project",
				getHiveAdapter: async () => ({ queryCells: async () => [] }),
				checkSwarmHealth: async () => ({
					healthy: true,
					database: "connected",
					stats: { events: 0, agents: 0, messages: 0, reservations: 0 },
				}),
				logger: createMockLogger(),
			});

			const output = { context: [] as string[] };
			await hook({ sessionID: "test" }, output);

			// Should inject context (coordinator is active)
			expect(output.context.length).toBeGreaterThan(0);
		});
	});

	describe("Compaction recommendation metrics (instrumentation)", () => {
		it("logs 'should_compact' signal when conditions met", async () => {
			// NEW FEATURE: Proactive compaction recommendation
			// Log when we detect conditions that SHOULD trigger compaction
			// This data can be used to tune OpenCode's thresholds

			const hook = createCompactionHook({
				getHiveWorkingDirectory: () => "/test/project",
				getHiveAdapter: async () => ({
					queryCells: async () => [
						{
							id: "cell-epic-1",
							type: "epic",
							status: "in_progress",
							parent_id: null,
							updated_at: Date.now(),
						},
						// 5 open subtasks
						...Array.from({ length: 5 }, (_, i) => ({
							id: `cell-epic-1.${i + 1}`,
							title: `Subtask ${i + 1}`,
							type: "task" as const,
							status: "open" as const,
							parent_id: "cell-epic-1",
							updated_at: Date.now(),
						})),
					],
				}),
				checkSwarmHealth: async () => ({
					healthy: true,
					database: "connected",
					stats: {
						events: 10,
						agents: 2,
						messages: 15,
						reservations: 3,
					},
				}),
				logger: createMockLogger(),
			});

			const output = { context: [] as string[] };
			await hook({ sessionID: "test" }, output);

			// Should log "should_compact" recommendation
			const shouldCompactLog = logCalls.find(
				(log) =>
					log.level === "info" &&
					log.data &&
					typeof log.data === "object" &&
					"compaction_recommended" in log.data,
			);

			expect(shouldCompactLog).toBeDefined();
			expect(shouldCompactLog?.data.compaction_recommended).toBe(true);
			expect(shouldCompactLog?.data.reasons).toContain("5 open subtasks");
			expect(shouldCompactLog?.data.reasons).toContain("3 active reservations");
		});

		it("includes metrics in completion log", async () => {
			// Expose when compaction WOULD be beneficial
			// Metrics to track:
			// - open_subtasks_count (>3 = should compact)
			// - active_reservations_count (>2 = should compact)
			// - registered_agents_count (>1 = should compact)
			// - session_age_minutes (>15 = should consider)

			const hook = createCompactionHook({
				getHiveWorkingDirectory: () => "/test/project",
				getHiveAdapter: async () => ({
					queryCells: async () => [
						{
							id: "cell-epic-1",
							type: "epic",
							status: "in_progress",
							parent_id: null,
							updated_at: Date.now(),
						},
					],
				}),
				checkSwarmHealth: async () => ({
					healthy: true,
					database: "connected",
					stats: {
						events: 5,
						agents: 1,
						messages: 3,
						reservations: 1,
					},
				}),
				logger: createMockLogger(),
			});

			const output = { context: [] as string[] };
			await hook({ sessionID: "test" }, output);

			const completeLog = logCalls.find(
				(log) => log.level === "info" && log.message === "compaction complete",
			);

			expect(completeLog?.data.metrics).toBeDefined();
			expect(completeLog?.data.metrics).toHaveProperty("compaction_signals");
		});
	});

	describe("Early swarm detection (proactive)", () => {
		it("detects from hive_create_epic alone (before any subtasks)", async () => {
			// RESEARCH FINDING: Missing early coordinator activity
			// HYPOTHESIS: Waiting for subtasks to exist
			// TUNING: hive_create_epic in session = medium confidence

			const mockClient = {
				session: {
					messages: async () => ({
						data: [
							{
								info: { id: "msg-1" },
								parts: [
									{
										type: "tool",
										tool: "hive_create_epic",
										state: {
											status: "completed",
											input: { epic_title: "New Feature" },
											output: JSON.stringify({ epic: { id: "cell-epic-new" } }),
											time: { start: 1000, end: 2000 },
										},
									},
								],
							},
						],
					}),
				},
			};

			const hook = createCompactionHook({
				client: mockClient,
				getHiveWorkingDirectory: () => "/test/project",
				getHiveAdapter: async () => ({ queryCells: async () => [] }),
				checkSwarmHealth: async () => ({
					healthy: true,
					database: "connected",
					stats: { events: 0, agents: 0, messages: 0, reservations: 0 },
				}),
				logger: createMockLogger(),
			});

			const output = { context: [] as string[] };
			await hook({ sessionID: "test" }, output);

			// Should inject context (epic created = swarm starting)
			expect(output.context.length).toBeGreaterThan(0);
			expect(output.context[0]).toContain("cell-epic-new");
		});
	});
});
