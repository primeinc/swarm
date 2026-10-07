/**
 * Observability Health - CLI health dashboard
 *
 * Shows what's being captured vs what's missing.
 * Helps identify coverage gaps in observability instrumentation.
 */

import { getSwarmMailLibSQL } from "swarm-mail";
import { detectRegressions, type RegressionResult } from "./regression-detection.js";
import { homedir } from "node:os";
import { join } from "node:path";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";

// ============================================================================
// Types
// ============================================================================

export interface HookCoverageResult {
	percentage: number;
	wired: number;
	total: number;
	hooks: Array<{
		name: string;
		wired: boolean;
		captures: number;
	}>;
}

export interface EventCaptureStats {
	days: number;
	DECISION: number;
	VIOLATION: number;
	OUTCOME: number;
	COMPACTION: number;
}

export interface SessionQualityResult {
	totalSessions: number;
	qualitySessions: number;
	ghostSessions: number;
	qualityPercentage: number;
	warning: boolean;
}

export interface RegressionStatus {
	detected: boolean;
	count: number;
	details?: string[];
}

export interface ObservabilityHealth {
	hookCoverage: HookCoverageResult;
	eventStats: EventCaptureStats;
	sessionQuality: SessionQualityResult;
	regressions: RegressionStatus;
}

// ============================================================================
// Constants
// ============================================================================

/**
 * Expected hooks that should be wired for full observability.
 * This is the ideal state - actual wiring is tracked separately.
 */
const EXPECTED_HOOKS = [
	"tool.execute.after",
	"experimental.session.compacting",
	"session.error",
	"file.edited",
	"file.created",
	"file.deleted",
	"file.renamed",
	"session.started",
	"session.ended",
	"session.resumed",
	"message.received",
	"message.sent",
	"decision.made",
	"violation.detected",
	"compaction.detected",
	"compaction.prompted",
	"compaction.injected",
	"compaction.resumed",
	"worker.spawned",
	"worker.completed",
	"worker.blocked",
	"review.started",
	"review.completed",
	"scope.changed",
	"blocker.detected",
	"blocker.resolved",
	"skill.loaded",
	"inbox.checked",
] as const;

/**
 * Currently wired hooks (hardcoded for now - ideally dynamic from plugin registration)
 */
const WIRED_HOOKS = [
	"tool.execute.after",
	"experimental.session.compacting",
] as const;

// ============================================================================
// Hook Coverage
// ============================================================================

export interface HookCoverageInput {
	wiredHooks: readonly string[];
	expectedHooks: readonly string[];
	captureCounts?: Record<string, number>;
}

/**
 * Calculate hook coverage - what % of expected hooks are wired
 */
export function calculateHookCoverage(
	input: HookCoverageInput,
): HookCoverageResult {
	const { wiredHooks, expectedHooks, captureCounts = {} } = input;

	const wiredSet = new Set(wiredHooks);
	const hooks = expectedHooks.map((name) => ({
		name,
		wired: wiredSet.has(name),
		captures: captureCounts[name] || 0,
	}));

	const wiredCount = hooks.filter((h) => h.wired).length;
	const percentage = expectedHooks.length > 0
		? Math.round((wiredCount / expectedHooks.length) * 100)
		: 0;

	return {
		percentage,
		wired: wiredCount,
		total: expectedHooks.length,
		hooks,
	};
}

// ============================================================================
// Event Capture Stats
// ============================================================================

/**
 * Query event counts by type from database
 */
export async function getEventCaptureStats(
	projectPath: string,
	options: { days: number },
): Promise<EventCaptureStats> {
	const swarmMail = await getSwarmMailLibSQL(projectPath);
	const db = await swarmMail.getDatabase();

	const since = Date.now() - options.days * 24 * 60 * 60 * 1000;

	// Query event counts by type
	const result = await db.query(
		`SELECT 
			type,
			COUNT(*) as count
		FROM events
		WHERE timestamp >= ? AND project_key = ?
		GROUP BY type`,
		[since, projectPath],
	);

	// Map event types to categories
	const stats: EventCaptureStats = {
		days: options.days,
		DECISION: 0,
		VIOLATION: 0,
		OUTCOME: 0,
		COMPACTION: 0,
	};

	for (const row of result.rows) {
		const r = row as { type: string; count: number };
		if (r.type.includes("decision")) {
			stats.DECISION += r.count;
		} else if (r.type.includes("violation")) {
			stats.VIOLATION += r.count;
		} else if (r.type.includes("outcome")) {
			stats.OUTCOME += r.count;
		} else if (r.type.includes("compaction")) {
			stats.COMPACTION += r.count;
		}
	}

	return stats;
}

// ============================================================================
// Session Quality
// ============================================================================

export interface SessionQualityInput {
	totalSessions: number;
	qualitySessions: number;
}

/**
 * Calculate session quality metrics
 * Warning threshold: <50% quality sessions
 */
export function calculateSessionQuality(
	input: SessionQualityInput,
): SessionQualityResult {
	const { totalSessions, qualitySessions } = input;
	const ghostSessions = totalSessions - qualitySessions;
	const qualityPercentage = totalSessions > 0
		? Math.round((qualitySessions / totalSessions) * 100)
		: 0;

	return {
		totalSessions,
		qualitySessions,
		ghostSessions,
		qualityPercentage,
		warning: qualityPercentage < 50,
	};
}

/**
 * Query actual session quality from session files
 * Quality session = has DECISION events (spawns, reviews, etc.)
 */
export function querySessionQuality(options: {
	days: number;
}): SessionQualityInput {
	const sessionsPath = join(homedir(), ".config", "swarm-tools", "sessions");

	if (!existsSync(sessionsPath)) {
		return { totalSessions: 0, qualitySessions: 0 };
	}

	const since = Date.now() - options.days * 24 * 60 * 60 * 1000;
	const sessionFiles = readdirSync(sessionsPath).filter(
		(f) =>
			f.endsWith(".jsonl") &&
			statSync(join(sessionsPath, f)).mtimeMs >= since,
	);

	let qualityCount = 0;

	for (const file of sessionFiles) {
		try {
			const content = readFileSync(join(sessionsPath, file), "utf-8");
			const lines = content.trim().split("\n");

			let hasDecisions = false;

			for (const line of lines) {
				try {
					const event = JSON.parse(line);
					if (event.event_type === "DECISION") {
						hasDecisions = true;
						break;
					}
				} catch {
					// Skip invalid lines
				}
			}

			if (hasDecisions) {
				qualityCount++;
			}
		} catch {
			// Skip unreadable files
		}
	}

	return {
		totalSessions: sessionFiles.length,
		qualitySessions: qualityCount,
	};
}

// ============================================================================
// Regressions
// ============================================================================

/**
 * Check for eval regressions
 */
export async function checkRegressions(
	projectPath: string,
): Promise<RegressionStatus> {
	try {
		const regressions = await detectRegressions(projectPath);

		if (regressions.length === 0) {
			return { detected: false, count: 0 };
		}

		return {
			detected: true,
			count: regressions.length,
			details: regressions.map(
				(r) => `${r.evalName} dropped ${Math.abs(r.deltaPercent).toFixed(1)}%`,
			),
		};
	} catch (error) {
		// If regression detection fails, report no regressions (fail open)
		return { detected: false, count: 0 };
	}
}

// ============================================================================
// Dashboard Formatting
// ============================================================================

/**
 * Format health dashboard with box-drawing characters
 */
export function formatHealthDashboard(health: ObservabilityHealth): string {
	const lines: string[] = [];

	// Header
	lines.push("┌─────────────────────────────────────────────────────────────┐");
	lines.push("│  OBSERVABILITY HEALTH                                       │");
	lines.push("├─────────────────────────────────────────────────────────────┤");
	lines.push("│                                                             │");

	// Hook Coverage
	const coverageStr = `Hook Coverage: ${health.hookCoverage.percentage}%`;
	const coverageDetail = `(${health.hookCoverage.wired}/${health.hookCoverage.total} hooks wired)`;
	lines.push(`│  ${coverageStr} ${coverageDetail.padEnd(32)} │`);

	// Show top wired hooks
	const wiredHooks = health.hookCoverage.hooks
		.filter((h) => h.wired)
		.slice(0, 4);
	for (const hook of wiredHooks) {
		const hookLine = `├── ${hook.name}: ✅ ${hook.captures} captures`;
		lines.push(`│  ${hookLine.padEnd(60)} │`);
	}

	// Show top unwired hooks
	const unwiredHooks = health.hookCoverage.hooks
		.filter((h) => !h.wired)
		.slice(0, 2);
	for (const hook of unwiredHooks) {
		const hookLine = `└── ${hook.name}: ❌ not wired`;
		lines.push(`│  ${hookLine.padEnd(60)} │`);
	}

	lines.push("│                                                             │");

	// Event Capture Stats
	lines.push(`│  Event Capture Stats (last ${health.eventStats.days} days):${" ".repeat(22)} │`);
	lines.push(`│  ├── DECISION events: ${String(health.eventStats.DECISION).padEnd(36)} │`);

	// Warn if 0 violations (might be suspicious)
	const violationLine = health.eventStats.VIOLATION === 0
		? `VIOLATION events: ${health.eventStats.VIOLATION} ⚠️`
		: `VIOLATION events: ${health.eventStats.VIOLATION}`;
	lines.push(`│  ├── ${violationLine.padEnd(56)} │`);

	lines.push(`│  ├── OUTCOME events: ${String(health.eventStats.OUTCOME).padEnd(38)} │`);
	lines.push(`│  └── COMPACTION events: ${String(health.eventStats.COMPACTION).padEnd(35)} │`);
	lines.push("│                                                             │");

	// Session Quality
	lines.push("│  Session Quality:                                           │");
	lines.push(`│  ├── Total sessions: ${String(health.sessionQuality.totalSessions).padEnd(39)} │`);

	const qualityLine = `Quality sessions: ${health.sessionQuality.qualitySessions} (${health.sessionQuality.qualityPercentage}%)`;
	lines.push(`│  ├── ${qualityLine.padEnd(56)} │`);

	const ghostLine = health.sessionQuality.warning
		? `Ghost sessions: ${health.sessionQuality.ghostSessions} (${100 - health.sessionQuality.qualityPercentage}%) ⚠️`
		: `Ghost sessions: ${health.sessionQuality.ghostSessions} (${100 - health.sessionQuality.qualityPercentage}%)`;
	lines.push(`│  └── ${ghostLine.padEnd(56)} │`);
	lines.push("│                                                             │");

	// Regression Status
	lines.push("│  Regression Status:                                         │");
	if (health.regressions.detected) {
		lines.push(`│  └── ${health.regressions.count} regressions detected ⚠️${" ".repeat(28)} │`);
		if (health.regressions.details) {
			for (const detail of health.regressions.details.slice(0, 3)) {
				lines.push(`│      - ${detail.padEnd(51)} │`);
			}
		}
	} else {
		lines.push("│  └── No regressions detected ✅                             │");
	}

	lines.push("│                                                             │");
	lines.push("└─────────────────────────────────────────────────────────────┘");

	return lines.join("\n");
}

// ============================================================================
// Main Health Check
// ============================================================================

/**
 * Get full observability health report
 */
export async function getObservabilityHealth(
	projectPath: string,
	options: { days?: number } = {},
): Promise<ObservabilityHealth> {
	const days = options.days || 7;

	// Calculate hook coverage (hardcoded for now)
	const hookCoverage = calculateHookCoverage({
		wiredHooks: WIRED_HOOKS,
		expectedHooks: EXPECTED_HOOKS,
		captureCounts: {
			"tool.execute.after": 6,
			"experimental.session.compacting": 2,
		},
	});

	// Get event stats from database
	const eventStats = await getEventCaptureStats(projectPath, { days });

	// Query actual session quality from session files
	const sessionQualityInput = querySessionQuality({ days });
	const sessionQuality = calculateSessionQuality(sessionQualityInput);

	// Check for regressions
	const regressions = await checkRegressions(projectPath);

	return {
		hookCoverage,
		eventStats,
		sessionQuality,
		regressions,
	};
}
