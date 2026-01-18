/**
 * Session Quality Filter - Detect and purge "ghost sessions"
 *
 * Ghost sessions are single-event or very short sessions that pollute eval data.
 * Based on analysis showing 55.6% of sessions are ghosts.
 *
 * Quality criteria:
 * - Minimum 3 events (not just session_start)
 * - Minimum 60 seconds duration
 * - At least one "meaningful" event (DECISION, VIOLATION, OUTCOME, etc.)
 *
 * @module sessions/session-quality
 */

import type { NormalizedMessage } from "./session-parser.js";

/**
 * Criteria for determining session quality
 */
export interface SessionQualityCriteria {
	/** Minimum number of events required (default: 3) */
	minEvents?: number;
	/** Minimum session duration in seconds (default: 60) */
	minDurationSeconds?: number;
	/** Require at least one meaningful event (default: true) */
	requireMeaningfulEvent?: boolean;
}

/**
 * Result from purging ghost sessions
 */
export interface PurgeResult {
	/** Sessions that were purged */
	purged: Map<string, NormalizedMessage[]>;
	/** Sessions that were kept */
	kept: Map<string, NormalizedMessage[]>;
	/** Statistics about the purge */
	stats: {
		totalSessions: number;
		ghostSessions: number;
		qualitySessions: number;
		purgedCount: number;
		keptCount: number;
	};
}

/**
 * Default quality criteria
 */
const DEFAULT_CRITERIA: Required<SessionQualityCriteria> = {
	minEvents: 3,
	minDurationSeconds: 60,
	requireMeaningfulEvent: true,
};

/**
 * Meaningful event types that indicate actual work
 *
 * System events like session_start, session_end, heartbeat are NOT meaningful.
 */
const MEANINGFUL_EVENT_PATTERNS = [
	"DECISION",
	"VIOLATION",
	"OUTCOME",
	"COMPACTION",
	"worker_spawned",
	"task_completed",
	"task_started",
	"review_feedback",
	"file_reserved",
	"file_released",
	"message_sent",
	"epic_created",
	"cell_created",
	"cell_updated",
	"cell_closed",
];

/**
 * Non-meaningful system events
 */
const SYSTEM_EVENT_PATTERNS = [
	"session_start",
	"session_end",
	"session_idle",
	"session_ping",
	"heartbeat",
	"keepalive",
];

/**
 * Check if a session contains meaningful work
 *
 * @param messages - Session messages
 * @param criteria - Quality criteria (optional)
 * @returns true if session meets quality criteria
 */
export function isQualitySession(
	messages: NormalizedMessage[],
	criteria: SessionQualityCriteria = {},
): boolean {
	const { minEvents, minDurationSeconds, requireMeaningfulEvent } = {
		...DEFAULT_CRITERIA,
		...criteria,
	};

	// Empty session
	if (messages.length === 0) {
		return false;
	}

	// Check minimum event count
	if (messages.length < minEvents) {
		return false;
	}

	// Check for meaningful events (required by default)
	if (requireMeaningfulEvent && !hasMeaningfulEvent(messages)) {
		return false;
	}

	// Check duration (only if we can parse timestamps)
	const duration = calculateSessionDuration(messages);
	if (duration !== null && duration < minDurationSeconds) {
		return false;
	}

	return true;
}

/**
 * Calculate session duration in seconds
 *
 * @returns Duration in seconds, or null if timestamps are invalid
 */
function calculateSessionDuration(
	messages: NormalizedMessage[],
): number | null {
	if (messages.length === 0) return null;

	try {
		const timestamps = messages
			.map((m) => new Date(m.timestamp).getTime())
			.filter((t) => !isNaN(t));

		if (timestamps.length < 2) return null;

		const earliest = Math.min(...timestamps);
		const latest = Math.max(...timestamps);

		return (latest - earliest) / 1000; // Convert to seconds
	} catch {
		return null;
	}
}

/**
 * Check if session has at least one meaningful event
 */
function hasMeaningfulEvent(messages: NormalizedMessage[]): boolean {
	return messages.some((msg) => {
		const content = msg.content.toLowerCase();

		// Check if it's a system event (non-meaningful)
		const isSystemEvent = SYSTEM_EVENT_PATTERNS.some((pattern) =>
			content.includes(pattern.toLowerCase()),
		);

		if (isSystemEvent) return false;

		// Check if it matches a meaningful pattern
		return MEANINGFUL_EVENT_PATTERNS.some((pattern) =>
			content.includes(pattern.toLowerCase()),
		);
	});
}

/**
 * Purge ghost sessions from a collection
 *
 * @param sessions - Map of session_id to messages
 * @param criteria - Quality criteria (optional)
 * @returns Purge result with separated ghost and quality sessions
 *
 * @example
 * ```typescript
 * const sessions = new Map([
 *   ['ses_ghost', [singleMessage]],
 *   ['ses_quality', [msg1, msg2, msg3]]
 * ]);
 *
 * const result = purgeGhostSessions(sessions);
 * console.log(`Purged ${result.stats.purgedCount} ghost sessions`);
 * ```
 */
export function purgeGhostSessions(
	sessions: Map<string, NormalizedMessage[]>,
	criteria: SessionQualityCriteria = {},
): PurgeResult {
	const purged = new Map<string, NormalizedMessage[]>();
	const kept = new Map<string, NormalizedMessage[]>();

	for (const [sessionId, messages] of sessions.entries()) {
		if (isQualitySession(messages, criteria)) {
			kept.set(sessionId, messages);
		} else {
			purged.set(sessionId, messages);
		}
	}

	return {
		purged,
		kept,
		stats: {
			totalSessions: sessions.size,
			ghostSessions: purged.size,
			qualitySessions: kept.size,
			purgedCount: purged.size,
			keptCount: kept.size,
		},
	};
}
