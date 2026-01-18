/**
 * Tests for Compaction Observability
 *
 * TDD for adding structured metrics, timing breakdown, and queryable history
 * to the pre-compaction hook.
 */

import { describe, expect, it } from "bun:test";
import {
	CompactionPhase,
	createMetricsCollector,
	getMetricsSummary,
	recordPatternExtracted,
	recordPatternSkipped,
	recordPhaseComplete,
	recordPhaseStart,
} from "./compaction-observability";

describe("CompactionMetrics", () => {
	describe("Phase timing", () => {
		it("tracks timing for each phase", () => {
			const metrics = createMetricsCollector();

			recordPhaseStart(metrics, CompactionPhase.DETECT);
			// Simulate work
			recordPhaseComplete(metrics, CompactionPhase.DETECT);

			const summary = getMetricsSummary(metrics);

			expect(summary.phases.DETECT).toBeDefined();
			expect(summary.phases.DETECT.duration_ms).toBeGreaterThanOrEqual(0);
			expect(summary.phases.DETECT.success).toBe(true);
		});

		it("tracks multiple phases independently", () => {
			const metrics = createMetricsCollector();

			recordPhaseStart(metrics, CompactionPhase.GATHER_SWARM_MAIL);
			recordPhaseComplete(metrics, CompactionPhase.GATHER_SWARM_MAIL);

			recordPhaseStart(metrics, CompactionPhase.GATHER_HIVE);
			recordPhaseComplete(metrics, CompactionPhase.GATHER_HIVE);

			const summary = getMetricsSummary(metrics);

			expect(summary.phases.GATHER_SWARM_MAIL).toBeDefined();
			expect(summary.phases.GATHER_HIVE).toBeDefined();
		});

		it("tracks phase failures", () => {
			const metrics = createMetricsCollector();

			recordPhaseStart(metrics, CompactionPhase.INJECT);
			recordPhaseComplete(metrics, CompactionPhase.INJECT, {
				success: false,
				error: "Context injection failed",
			});

			const summary = getMetricsSummary(metrics);

			expect(summary.phases.INJECT.success).toBe(false);
			expect(summary.phases.INJECT.error).toBe("Context injection failed");
		});
	});

	describe("Pattern extraction tracking", () => {
		it("records extracted patterns with reasons", () => {
			const metrics = createMetricsCollector();

			recordPatternExtracted(
				metrics,
				"epic_state",
				"Epic cell-123 in_progress",
			);
			recordPatternExtracted(metrics, "agent_name", "BoldWind registered");

			const summary = getMetricsSummary(metrics);

			expect(summary.patterns_extracted).toBe(2);
			expect(summary.extracted_patterns).toContain("epic_state");
			expect(summary.extracted_patterns).toContain("agent_name");
		});

		it("records skipped patterns with reasons", () => {
			const metrics = createMetricsCollector();

			recordPatternSkipped(metrics, "subtask_details", "No subtasks found");

			const summary = getMetricsSummary(metrics);

			expect(summary.patterns_skipped).toBe(1);
			expect(summary.skipped_patterns).toContain("subtask_details");
		});

		it("tracks extraction success rate", () => {
			const metrics = createMetricsCollector();

			recordPatternExtracted(metrics, "epic_state", "Found epic");
			recordPatternExtracted(metrics, "agent_name", "Found agent");
			recordPatternSkipped(metrics, "reservations", "None active");

			const summary = getMetricsSummary(metrics);

			expect(summary.patterns_extracted).toBe(2);
			expect(summary.patterns_skipped).toBe(1);
			expect(summary.extraction_success_rate).toBeCloseTo(0.67, 1);
		});
	});

	describe("Overall metrics", () => {
		it("tracks total duration from start to complete", () => {
			const metrics = createMetricsCollector();
			const startTime = Date.now();

			recordPhaseStart(metrics, CompactionPhase.START);
			recordPhaseComplete(metrics, CompactionPhase.START);

			recordPhaseStart(metrics, CompactionPhase.DETECT);
			recordPhaseComplete(metrics, CompactionPhase.DETECT);

			recordPhaseStart(metrics, CompactionPhase.COMPLETE);
			recordPhaseComplete(metrics, CompactionPhase.COMPLETE);

			const summary = getMetricsSummary(metrics);

			expect(summary.total_duration_ms).toBeGreaterThanOrEqual(0);
			expect(summary.total_duration_ms).toBeLessThan(
				Date.now() - startTime + 10,
			);
		});

		it("captures session metadata", () => {
			const metrics = createMetricsCollector({
				session_id: "test-session-123",
				has_sdk_client: true,
			});

			const summary = getMetricsSummary(metrics);

			expect(summary.session_id).toBe("test-session-123");
			expect(summary.has_sdk_client).toBe(true);
		});

		it("captures final detection confidence", () => {
			const metrics = createMetricsCollector();

			recordPhaseComplete(metrics, CompactionPhase.DETECT, {
				confidence: "high",
				detected: true,
			});

			const summary = getMetricsSummary(metrics);

			expect(summary.confidence).toBe("high");
			expect(summary.detected).toBe(true);
		});
	});

	describe("Debug mode", () => {
		it("records verbose decision details when enabled", () => {
			const metrics = createMetricsCollector({ debug: true });

			recordPatternExtracted(
				metrics,
				"epic_state",
				"Epic cell-123 in_progress",
				{
					cell_id: "cell-123",
					cell_status: "in_progress",
					subtask_count: 5,
				},
			);

			const summary = getMetricsSummary(metrics);

			// Debug details should be captured
			expect(summary.debug_info).toBeDefined();
			expect(summary.debug_info.length).toBeGreaterThan(0);
		});
	});
});

describe("Metrics persistence", () => {
	it("can serialize metrics to JSON", () => {
		const metrics = createMetricsCollector({ session_id: "test-123" });

		recordPhaseStart(metrics, CompactionPhase.DETECT);
		recordPhaseComplete(metrics, CompactionPhase.DETECT);
		recordPatternExtracted(metrics, "epic_state", "Found epic");

		const summary = getMetricsSummary(metrics);
		const json = JSON.stringify(summary);

		expect(json).toContain("test-123");
		expect(json).toContain("DETECT");
		expect(json).toContain("epic_state");
	});
});
