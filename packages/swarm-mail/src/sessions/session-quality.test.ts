/**
 * Session Quality Filter Tests - TDD RED/GREEN/REFACTOR
 *
 * Tests for filtering out "ghost sessions" - single-event sessions that pollute eval data.
 * Based on analysis showing 55.6% of sessions are ghosts (single event, no meaningful work).
 */

import { describe, expect, test } from "vitest";
import type { NormalizedMessage } from "./session-parser.js";
import {
	isQualitySession,
	purgeGhostSessions,
	type SessionQualityCriteria,
} from "./session-quality.js";

// ============================================================================
// Test Fixtures
// ============================================================================

const createMessage = (
	overrides: Partial<NormalizedMessage> = {},
): NormalizedMessage => ({
	session_id: "ses_test",
	agent_type: "opencode-swarm",
	message_idx: 0,
	timestamp: "2025-12-26T10:00:00Z",
	role: "system",
	content: "session_start",
	metadata: {},
	...overrides,
});

const createTimestamp = (minutesOffset: number): string => {
	const base = new Date("2025-12-26T10:00:00Z");
	base.setMinutes(base.getMinutes() + minutesOffset);
	return base.toISOString();
};

// ============================================================================
// isQualitySession Tests
// ============================================================================

describe("isQualitySession - Single Event Detection", () => {
	test("returns false for single-event session (ghost)", () => {
		const messages = [createMessage({ content: "session_start" })];

		expect(isQualitySession(messages)).toBe(false);
	});

	test("returns false for empty session array", () => {
		expect(isQualitySession([])).toBe(false);
	});

	test("returns true for session with multiple events", () => {
		const messages = [
			createMessage({ message_idx: 0, content: "session_start" }),
			createMessage({
				message_idx: 1,
				content: "DECISION: spawn worker",
				timestamp: createTimestamp(1),
			}),
			createMessage({
				message_idx: 2,
				content: "OUTCOME: success",
				timestamp: createTimestamp(2),
			}),
		];

		expect(isQualitySession(messages)).toBe(true);
	});
});

describe("isQualitySession - Duration Detection", () => {
	test("returns false for session shorter than 30 seconds", () => {
		const messages = [
			createMessage({ message_idx: 0, timestamp: "2025-12-26T10:00:00Z" }),
			createMessage({ message_idx: 1, timestamp: "2025-12-26T10:00:15Z" }), // 15 seconds later
			createMessage({ message_idx: 2, timestamp: "2025-12-26T10:00:25Z" }), // 25 seconds total
		];

		expect(isQualitySession(messages)).toBe(false);
	});

	test("returns true for session longer than 60 seconds", () => {
		const messages = [
			createMessage({ message_idx: 0, timestamp: "2025-12-26T10:00:00Z" }),
			createMessage({
				message_idx: 1,
				content: "DECISION: spawn",
				timestamp: "2025-12-26T10:00:30Z",
			}),
			createMessage({ message_idx: 2, timestamp: "2025-12-26T10:01:30Z" }), // 90 seconds total
		];

		expect(isQualitySession(messages)).toBe(true);
	});

	test("handles sessions with malformed timestamps gracefully", () => {
		const messages = [
			createMessage({ message_idx: 0, timestamp: "invalid" }),
			createMessage({
				message_idx: 1,
				content: "DECISION: spawn",
				timestamp: "also-invalid",
			}),
			createMessage({ message_idx: 2, timestamp: "still-invalid" }),
		];

		// Falls back to event count + meaningful event check (ignores invalid duration)
		expect(isQualitySession(messages)).toBe(true); // 3 events with meaningful work
	});
});

describe("isQualitySession - Meaningful Event Detection", () => {
	test("returns false for sessions with only init/idle events", () => {
		const messages = [
			createMessage({ message_idx: 0, content: "session_start" }),
			createMessage({
				message_idx: 1,
				content: "session_idle",
				timestamp: createTimestamp(1),
			}),
			createMessage({
				message_idx: 2,
				content: "session_ping",
				timestamp: createTimestamp(65),
			}),
		];

		expect(isQualitySession(messages)).toBe(false);
	});

	test("returns true for sessions with meaningful work events", () => {
		const messages = [
			createMessage({ message_idx: 0, content: "session_start" }),
			createMessage({
				message_idx: 1,
				content: "DECISION: worker_spawned",
				timestamp: createTimestamp(1),
			}),
			createMessage({
				message_idx: 2,
				content: "session_end",
				timestamp: createTimestamp(65),
			}),
		];

		expect(isQualitySession(messages)).toBe(true);
	});

	test("detects meaningful events by type", () => {
		const meaningfulTypes = [
			"DECISION",
			"VIOLATION",
			"OUTCOME",
			"worker_spawned",
			"task_completed",
			"review_feedback",
			"file_reserved",
		];

		for (const eventType of meaningfulTypes) {
			const messages = [
				createMessage({ message_idx: 0, content: "session_start" }),
				createMessage({
					message_idx: 1,
					content: eventType,
					timestamp: createTimestamp(1),
				}),
				createMessage({
					message_idx: 2,
					content: "session_end",
					timestamp: createTimestamp(65),
				}),
			];

			expect(isQualitySession(messages)).toBe(true);
		}
	});

	test("ignores non-meaningful system events", () => {
		const systemEvents = [
			"session_start",
			"session_end",
			"session_idle",
			"session_ping",
			"heartbeat",
		];

		const messages = systemEvents.map((content, idx) =>
			createMessage({
				message_idx: idx,
				content,
				timestamp: createTimestamp(idx * 20), // 80 seconds total
			}),
		);

		expect(isQualitySession(messages)).toBe(false); // No meaningful work
	});
});

describe("isQualitySession - Custom Criteria", () => {
	test("respects custom minEvents threshold", () => {
		const messages = [
			createMessage({ message_idx: 0, content: "DECISION" }),
			createMessage({
				message_idx: 1,
				content: "OUTCOME",
				timestamp: createTimestamp(1),
			}),
		];

		const criteria: SessionQualityCriteria = { minEvents: 5 };
		expect(isQualitySession(messages, criteria)).toBe(false);
	});

	test("respects custom minDurationSeconds threshold", () => {
		const messages = [
			createMessage({ message_idx: 0, timestamp: "2025-12-26T10:00:00Z" }),
			createMessage({ message_idx: 1, timestamp: "2025-12-26T10:01:00Z" }), // 60 seconds
			createMessage({ message_idx: 2, timestamp: "2025-12-26T10:02:00Z" }), // 120 seconds total
		];

		const criteria: SessionQualityCriteria = { minDurationSeconds: 180 }; // 3 minutes
		expect(isQualitySession(messages, criteria)).toBe(false);
	});

	test("respects custom requireMeaningfulEvent flag", () => {
		const messages = [
			createMessage({ message_idx: 0, content: "session_start" }),
			createMessage({
				message_idx: 1,
				content: "session_idle",
				timestamp: createTimestamp(1),
			}),
			createMessage({
				message_idx: 2,
				content: "session_ping",
				timestamp: createTimestamp(65),
			}),
		];

		// Disable meaningful event requirement
		const criteria: SessionQualityCriteria = { requireMeaningfulEvent: false };
		expect(isQualitySession(messages, criteria)).toBe(true); // Passes on count + duration
	});
});

// ============================================================================
// purgeGhostSessions Tests
// ============================================================================

describe("purgeGhostSessions - Cleanup", () => {
	test("removes single-event ghost sessions", () => {
		const sessions = new Map([
			["ses_ghost1", [createMessage({ session_id: "ses_ghost1" })]],
			[
				"ses_quality",
				[
					createMessage({ session_id: "ses_quality", message_idx: 0 }),
					createMessage({
						session_id: "ses_quality",
						message_idx: 1,
						content: "DECISION",
						timestamp: createTimestamp(1),
					}),
					createMessage({
						session_id: "ses_quality",
						message_idx: 2,
						timestamp: createTimestamp(65),
					}),
				],
			],
			["ses_ghost2", [createMessage({ session_id: "ses_ghost2" })]],
		]);

		const result = purgeGhostSessions(sessions);

		expect(result.purged.size).toBe(2);
		expect(result.purged.has("ses_ghost1")).toBe(true);
		expect(result.purged.has("ses_ghost2")).toBe(true);
		expect(result.kept.size).toBe(1);
		expect(result.kept.has("ses_quality")).toBe(true);
	});

	test("removes sessions shorter than minimum duration", () => {
		const sessions = new Map([
			[
				"ses_short",
				[
					createMessage({
						session_id: "ses_short",
						message_idx: 0,
						timestamp: "2025-12-26T10:00:00Z",
					}),
					createMessage({
						session_id: "ses_short",
						message_idx: 1,
						content: "DECISION",
						timestamp: "2025-12-26T10:00:15Z",
					}),
					createMessage({
						session_id: "ses_short",
						message_idx: 2,
						timestamp: "2025-12-26T10:00:25Z",
					}), // 25s
				],
			],
			[
				"ses_long",
				[
					createMessage({
						session_id: "ses_long",
						message_idx: 0,
						timestamp: "2025-12-26T10:00:00Z",
					}),
					createMessage({
						session_id: "ses_long",
						message_idx: 1,
						content: "DECISION",
						timestamp: "2025-12-26T10:00:30Z",
					}),
					createMessage({
						session_id: "ses_long",
						message_idx: 2,
						timestamp: "2025-12-26T10:01:30Z",
					}), // 90s
				],
			],
		]);

		const result = purgeGhostSessions(sessions);

		expect(result.purged.size).toBe(1);
		expect(result.purged.has("ses_short")).toBe(true);
		expect(result.kept.size).toBe(1);
		expect(result.kept.has("ses_long")).toBe(true);
	});

	test("removes sessions with no meaningful events", () => {
		const sessions = new Map([
			[
				"ses_idle",
				[
					createMessage({
						session_id: "ses_idle",
						message_idx: 0,
						content: "session_start",
					}),
					createMessage({
						session_id: "ses_idle",
						message_idx: 1,
						content: "session_idle",
						timestamp: createTimestamp(30),
					}),
					createMessage({
						session_id: "ses_idle",
						message_idx: 2,
						content: "session_end",
						timestamp: createTimestamp(65),
					}),
				],
			],
			[
				"ses_work",
				[
					createMessage({
						session_id: "ses_work",
						message_idx: 0,
						content: "session_start",
					}),
					createMessage({
						session_id: "ses_work",
						message_idx: 1,
						content: "DECISION: spawn",
						timestamp: createTimestamp(30),
					}),
					createMessage({
						session_id: "ses_work",
						message_idx: 2,
						content: "session_end",
						timestamp: createTimestamp(65),
					}),
				],
			],
		]);

		const result = purgeGhostSessions(sessions);

		expect(result.purged.size).toBe(1);
		expect(result.purged.has("ses_idle")).toBe(true);
		expect(result.kept.size).toBe(1);
		expect(result.kept.has("ses_work")).toBe(true);
	});

	test("returns stats about purge operation", () => {
		const sessions = new Map([
			["ses_ghost1", [createMessage({ session_id: "ses_ghost1" })]],
			["ses_ghost2", [createMessage({ session_id: "ses_ghost2" })]],
			[
				"ses_quality",
				[
					createMessage({ session_id: "ses_quality", message_idx: 0 }),
					createMessage({
						session_id: "ses_quality",
						message_idx: 1,
						content: "DECISION",
						timestamp: createTimestamp(1),
					}),
					createMessage({
						session_id: "ses_quality",
						message_idx: 2,
						timestamp: createTimestamp(65),
					}),
				],
			],
		]);

		const result = purgeGhostSessions(sessions);

		expect(result.stats).toEqual({
			totalSessions: 3,
			ghostSessions: 2,
			qualitySessions: 1,
			purgedCount: 2,
			keptCount: 1,
		});
	});

	test("handles empty session map", () => {
		const result = purgeGhostSessions(new Map());

		expect(result.purged.size).toBe(0);
		expect(result.kept.size).toBe(0);
		expect(result.stats.totalSessions).toBe(0);
	});

	test("respects custom criteria in purge", () => {
		const sessions = new Map([
			[
				"ses_borderline",
				[
					createMessage({
						session_id: "ses_borderline",
						message_idx: 0,
						timestamp: "2025-12-26T10:00:00Z",
					}),
					createMessage({
						session_id: "ses_borderline",
						message_idx: 1,
						content: "DECISION",
						timestamp: "2025-12-26T10:01:30Z",
					}),
					createMessage({
						session_id: "ses_borderline",
						message_idx: 2,
						timestamp: "2025-12-26T10:02:00Z",
					}),
				],
			],
		]);

		// Default criteria would keep this (3 events, has DECISION, 120s duration)
		const defaultResult = purgeGhostSessions(sessions);
		expect(defaultResult.kept.size).toBe(1);

		// Custom criteria requiring 5 events would purge it
		const strictResult = purgeGhostSessions(sessions, { minEvents: 5 });
		expect(strictResult.purged.size).toBe(1);
	});
});
