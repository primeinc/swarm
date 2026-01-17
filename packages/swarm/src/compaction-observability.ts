/**
 * Compaction Hook Observability
 *
 * Structured logging, metrics, and queryable history for the pre-compaction hook.
 *
 * **Philosophy:** Make the invisible visible. When patterns aren't extracted,
 * when detection fails, when timing explodes - we need to know WHY.
 *
 * @example
 * ```typescript
 * const metrics = createMetricsCollector({ session_id: "abc123" });
 *
 * recordPhaseStart(metrics, CompactionPhase.DETECT);
 * // ... detection logic ...
 * recordPhaseComplete(metrics, CompactionPhase.DETECT, { confidence: "high" });
 *
 * recordPatternExtracted(metrics, "epic_state", "Found epic cell-123");
 *
 * const summary = getMetricsSummary(metrics);
 * console.log(`Detected: ${summary.detected}, Confidence: ${summary.confidence}`);
 * ```
 */

/**
 * Compaction phases - aligned with existing log structure
 *
 * From compaction-hook.ts:
 * - START: session_id, trigger
 * - GATHER: source (swarm-mail|hive), duration_ms, stats/counts
 * - DETECT: confidence, detected, reason_count, reasons
 * - INJECT: confidence, context_length, context_type (full|fallback|none)
 * - COMPLETE: duration_ms, success, detected, confidence, context_injected
 */
export enum CompactionPhase {
	START = "START",
	GATHER_SWARM_MAIL = "GATHER_SWARM_MAIL",
	GATHER_HIVE = "GATHER_HIVE",
	DETECT = "DETECT",
	INJECT = "INJECT",
	COMPLETE = "COMPLETE",
}

/**
 * Phase timing and outcome
 */
interface PhaseMetrics {
	duration_ms: number;
	success: boolean;
	error?: string;
	/** Additional phase-specific data */
	metadata?: Record<string, unknown>;
}

/**
 * Pattern extraction record
 */
interface PatternRecord {
	pattern_type: string;
	reason: string;
	/** Debug details (only captured if debug mode enabled) */
	details?: Record<string, unknown>;
	timestamp: number;
}

/**
 * Compaction metrics collector
 *
 * Mutable state object that accumulates metrics during a compaction run.
 */
export interface CompactionMetrics {
	/** Session metadata */
	session_id?: string;
	has_sdk_client?: boolean;
	debug?: boolean;

	/** Phase timings */
	phases: Map<
		CompactionPhase,
		{
			start_time: number;
			end_time?: number;
			metadata?: Record<string, unknown>;
			error?: string;
		}
	>;

	/** Pattern extraction tracking */
	extracted: PatternRecord[];
	skipped: PatternRecord[];

	/** Final detection result */
	confidence?: "high" | "medium" | "low" | "none";
	detected?: boolean;

	/** Overall timing */
	start_time: number;
	end_time?: number;
}

/**
 * Metrics summary (read-only snapshot)
 */
export interface CompactionMetricsSummary {
	session_id?: string;
	has_sdk_client?: boolean;

	/** Phase breakdown */
	phases: Record<string, PhaseMetrics>;

	/** Pattern extraction stats */
	patterns_extracted: number;
	patterns_skipped: number;
	extraction_success_rate: number;
	extracted_patterns: string[];
	skipped_patterns: string[];

	/** Detection outcome */
	confidence?: "high" | "medium" | "low" | "none";
	detected?: boolean;

	/** Timing */
	total_duration_ms: number;

	/** Debug info (only if debug mode enabled) */
	debug_info?: Array<{
		phase: string;
		pattern: string;
		details: Record<string, unknown>;
	}>;
}

/**
 * Create a metrics collector
 *
 * @param metadata - Session metadata to capture
 * @returns Mutable metrics collector
 */
export function createMetricsCollector(metadata?: {
	session_id?: string;
	has_sdk_client?: boolean;
	debug?: boolean;
}): CompactionMetrics {
	return {
		session_id: metadata?.session_id,
		has_sdk_client: metadata?.has_sdk_client,
		debug: metadata?.debug,
		phases: new Map(),
		extracted: [],
		skipped: [],
		start_time: Date.now(),
	};
}

/**
 * Record phase start
 *
 * @param metrics - Metrics collector
 * @param phase - Phase being started
 */
export function recordPhaseStart(
	metrics: CompactionMetrics,
	phase: CompactionPhase,
): void {
	metrics.phases.set(phase, {
		start_time: Date.now(),
	});
}

/**
 * Record phase completion
 *
 * @param metrics - Metrics collector
 * @param phase - Phase being completed
 * @param result - Phase outcome
 */
export function recordPhaseComplete(
	metrics: CompactionMetrics,
	phase: CompactionPhase,
	result?: {
		success?: boolean;
		error?: string;
		confidence?: "high" | "medium" | "low" | "none";
		detected?: boolean;
		[key: string]: unknown;
	},
): void {
	let phaseData = metrics.phases.get(phase);
	if (!phaseData) {
		// Phase wasn't started, record it now
		phaseData = {
			start_time: Date.now(),
			end_time: Date.now(),
			error: "Phase completed without start",
		};
		metrics.phases.set(phase, phaseData);
	} else {
		phaseData.end_time = Date.now();
	}

	if (result) {
		if (result.error) {
			phaseData.error = result.error;
		}

		// Extract known fields
		// biome-ignore lint/correctness/noUnusedVariables: extracting for spread
		const { success, error, confidence, detected, ...rest } = result;

		if (Object.keys(rest).length > 0) {
			phaseData.metadata = rest;
		}

		// Update top-level detection result if provided in result
		if (confidence) {
			metrics.confidence = confidence;
		}
		if (detected !== undefined) {
			metrics.detected = detected;
		}
	}
}

/**
 * Record an extracted pattern
 *
 * @param metrics - Metrics collector
 * @param pattern_type - Type of pattern extracted (e.g., "epic_state", "agent_name")
 * @param reason - Human-readable reason for extraction
 * @param details - Debug details (only captured if debug mode enabled)
 */
export function recordPatternExtracted(
	metrics: CompactionMetrics,
	pattern_type: string,
	reason: string,
	details?: Record<string, unknown>,
): void {
	const record: PatternRecord = {
		pattern_type,
		reason,
		timestamp: Date.now(),
	};

	if (metrics.debug && details) {
		record.details = details;
	}

	metrics.extracted.push(record);
}

/**
 * Record a skipped pattern
 *
 * @param metrics - Metrics collector
 * @param pattern_type - Type of pattern that was skipped
 * @param reason - Human-readable reason for skipping
 */
export function recordPatternSkipped(
	metrics: CompactionMetrics,
	pattern_type: string,
	reason: string,
): void {
	metrics.skipped.push({
		pattern_type,
		reason,
		timestamp: Date.now(),
	});
}

/**
 * Get metrics summary (read-only snapshot)
 *
 * Computes derived metrics like success rates and total duration.
 *
 * @param metrics - Metrics collector
 * @returns Immutable summary
 */
export function getMetricsSummary(
	metrics: CompactionMetrics,
): CompactionMetricsSummary {
	// Compute phase breakdown
	const phases: Record<string, PhaseMetrics> = {};
	for (const [phase, data] of metrics.phases) {
		const duration = data.end_time ? data.end_time - data.start_time : 0;
		phases[phase] = {
			duration_ms: duration,
			success: !data.error,
			error: data.error,
			metadata: data.metadata,
		};
	}

	// Compute extraction stats
	const totalPatterns = metrics.extracted.length + metrics.skipped.length;
	const extractionSuccessRate =
		totalPatterns > 0 ? metrics.extracted.length / totalPatterns : 0;

	// Compute total duration
	const totalDuration = metrics.end_time
		? metrics.end_time - metrics.start_time
		: Date.now() - metrics.start_time;

	const summary: CompactionMetricsSummary = {
		session_id: metrics.session_id,
		has_sdk_client: metrics.has_sdk_client,
		phases,
		patterns_extracted: metrics.extracted.length,
		patterns_skipped: metrics.skipped.length,
		extraction_success_rate: extractionSuccessRate,
		extracted_patterns: metrics.extracted.map((p) => p.pattern_type),
		skipped_patterns: metrics.skipped.map((p) => p.pattern_type),
		confidence: metrics.confidence,
		detected: metrics.detected,
		total_duration_ms: totalDuration,
	};

	// Add debug info if enabled
	if (metrics.debug) {
		summary.debug_info = metrics.extracted
			.filter((p) => p.details !== undefined)
			.map((p) => ({
				phase: "EXTRACT",
				pattern: p.pattern_type,
				details: p.details as Record<string, unknown>,
			}));
	}

	return summary;
}
