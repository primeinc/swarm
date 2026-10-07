/**
 * Observability Health - Tests for o11y health dashboard
 *
 * TDD: Write failing tests first, then implement.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { getSwarmMailLibSQL } from "swarm-mail";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdirSync, rmSync } from "node:fs";
import {
	type ObservabilityHealth,
	calculateHookCoverage,
	calculateSessionQuality,
	checkRegressions,
	formatHealthDashboard,
	getEventCaptureStats,
} from "./observability-health.js";

describe("observability health", () => {
	const testDir = join(tmpdir(), `o11y-health-test-${Date.now()}`);
	let projectPath: string;

	beforeAll(() => {
		mkdirSync(testDir, { recursive: true });
		projectPath = testDir;
	});

	afterAll(() => {
		rmSync(testDir, { recursive: true, force: true });
	});

	describe("calculateHookCoverage", () => {
		test("RED: reports 0% when no hooks wired", () => {
			const coverage = calculateHookCoverage({
				wiredHooks: [],
				expectedHooks: [
					"tool.execute.after",
					"experimental.session.compacting",
					"session.error",
				],
			});

			expect(coverage.percentage).toBe(0);
			expect(coverage.wired).toBe(0);
			expect(coverage.total).toBe(3);
		});

		test("RED: reports 50% when half wired", () => {
			const coverage = calculateHookCoverage({
				wiredHooks: ["tool.execute.after"],
				expectedHooks: [
					"tool.execute.after",
					"experimental.session.compacting",
				],
			});

			expect(coverage.percentage).toBe(50);
			expect(coverage.wired).toBe(1);
			expect(coverage.total).toBe(2);
		});

		test("RED: includes capture counts per hook", () => {
			const coverage = calculateHookCoverage({
				wiredHooks: ["tool.execute.after"],
				expectedHooks: ["tool.execute.after", "session.error"],
				captureCounts: {
					"tool.execute.after": 42,
					"session.error": 0,
				},
			});

			expect(coverage.hooks).toContainEqual({
				name: "tool.execute.after",
				wired: true,
				captures: 42,
			});
			expect(coverage.hooks).toContainEqual({
				name: "session.error",
				wired: false,
				captures: 0,
			});
		});
	});

	describe("getEventCaptureStats", () => {
		test("RED: queries event counts by type from last N days", async () => {
			// Use a unique project path per test to avoid pollution
			const testProjectPath = join(testDir, "test1");
			mkdirSync(testProjectPath, { recursive: true });

			const swarmMail = await getSwarmMailLibSQL(testProjectPath);
			const db = await swarmMail.getDatabase();

			// Seed events
			const now = Date.now();
			await db.query(
				`INSERT INTO events (type, data, timestamp, project_key) VALUES (?, ?, ?, ?)`,
				[
					"coordinator_decision",
					JSON.stringify({ action: "spawn" }),
					now,
					testProjectPath,
				],
			);
			await db.query(
				`INSERT INTO events (type, data, timestamp, project_key) VALUES (?, ?, ?, ?)`,
				[
					"coordinator_violation",
					JSON.stringify({ violation: "edited_file" }),
					now,
					testProjectPath,
				],
			);
			await db.query(
				`INSERT INTO events (type, data, timestamp, project_key) VALUES (?, ?, ?, ?)`,
				[
					"subtask_outcome",
					JSON.stringify({ success: true }),
					now,
					testProjectPath,
				],
			);

			const stats = await getEventCaptureStats(testProjectPath, { days: 7 });

			expect(stats.DECISION).toBeGreaterThanOrEqual(1);
			expect(stats.VIOLATION).toBeGreaterThanOrEqual(1);
			expect(stats.OUTCOME).toBeGreaterThanOrEqual(1);
			expect(stats.COMPACTION).toBe(0);
		});

		test("RED: respects time window", async () => {
			// Use a unique project path per test
			const testProjectPath = join(testDir, "test2");
			mkdirSync(testProjectPath, { recursive: true });

			const swarmMail = await getSwarmMailLibSQL(testProjectPath);
			const db = await swarmMail.getDatabase();

			// Old event (outside window)
			const oldTimestamp = Date.now() - 10 * 24 * 60 * 60 * 1000; // 10 days ago
			await db.query(
				`INSERT INTO events (type, data, timestamp, project_key) VALUES (?, ?, ?, ?)`,
				[
					"coordinator_decision",
					JSON.stringify({ action: "old" }),
					oldTimestamp,
					testProjectPath,
				],
			);

			// Query for last 1 day - should not include the old event
			const recentStats = await getEventCaptureStats(testProjectPath, {
				days: 1,
			});
			expect(recentStats.DECISION).toBe(0);
		});
	});

	describe("calculateSessionQuality", () => {
		test("RED: distinguishes quality sessions from ghost sessions", () => {
			const quality = calculateSessionQuality({
				totalSessions: 100,
				qualitySessions: 60,
			});

			expect(quality.totalSessions).toBe(100);
			expect(quality.qualitySessions).toBe(60);
			expect(quality.ghostSessions).toBe(40);
			expect(quality.qualityPercentage).toBe(60);
		});

		test("RED: warns when ghost session % is high", () => {
			const quality = calculateSessionQuality({
				totalSessions: 100,
				qualitySessions: 30,
			});

			expect(quality.warning).toBe(true);
			expect(quality.ghostSessions).toBe(70);
			expect(quality.qualityPercentage).toBe(30);
		});

		test("RED: no warning when quality is good", () => {
			const quality = calculateSessionQuality({
				totalSessions: 100,
				qualitySessions: 80,
			});

			expect(quality.warning).toBe(false);
		});
	});

	describe("checkRegressions", () => {
		test("RED: detects no regressions when all scores stable", async () => {
			// Will be implemented with eval-history integration
			const regressions = await checkRegressions(projectPath);

			expect(regressions.detected).toBe(false);
			expect(regressions.count).toBe(0);
		});
	});

	describe("formatHealthDashboard", () => {
		test("RED: formats full health dashboard with box-drawing characters", () => {
			const health: ObservabilityHealth = {
				hookCoverage: {
					percentage: 35,
					wired: 10,
					total: 28,
					hooks: [
						{ name: "tool.execute.after", wired: true, captures: 6 },
						{
							name: "experimental.session.compacting",
							wired: true,
							captures: 2,
						},
						{ name: "session.error", wired: false, captures: 0 },
						{ name: "file.edited", wired: false, captures: 0 },
					],
				},
				eventStats: {
					days: 7,
					DECISION: 142,
					VIOLATION: 0,
					OUTCOME: 89,
					COMPACTION: 7,
				},
				sessionQuality: {
					totalSessions: 178,
					qualitySessions: 79,
					ghostSessions: 99,
					qualityPercentage: 44,
					warning: true,
				},
				regressions: {
					detected: false,
					count: 0,
				},
			};

			const output = formatHealthDashboard(health);

			// Should have box-drawing characters
			expect(output).toContain("┌");
			expect(output).toContain("│");
			expect(output).toContain("└");

			// Should show hook coverage
			expect(output).toContain("Hook Coverage: 35%");
			expect(output).toContain("10/28");

			// Should show event stats
			expect(output).toContain("DECISION events: 142");
			expect(output).toContain("VIOLATION events: 0");

			// Should show session quality
			expect(output).toContain("Total sessions: 178");
			expect(output).toContain("Quality sessions: 79 (44%)");
			expect(output).toContain("Ghost sessions: 99 (56%)");

			// Should show warnings
			expect(output).toContain("⚠️");

			// Should show regression status
			expect(output).toContain("No regressions detected");
			expect(output).toContain("✅");
		});

		test("RED: shows warnings for concerning metrics", () => {
			const health: ObservabilityHealth = {
				hookCoverage: {
					percentage: 10,
					wired: 3,
					total: 28,
					hooks: [],
				},
				eventStats: {
					days: 7,
					DECISION: 0,
					VIOLATION: 0,
					OUTCOME: 0,
					COMPACTION: 0,
				},
				sessionQuality: {
					totalSessions: 10,
					qualitySessions: 1,
					ghostSessions: 9,
					qualityPercentage: 10,
					warning: true,
				},
				regressions: {
					detected: true,
					count: 3,
					details: ["eval1 dropped 15%", "eval2 dropped 20%"],
				},
			};

			const output = formatHealthDashboard(health);

			// Multiple warnings
			expect(output.match(/⚠️/g)?.length).toBeGreaterThan(1);

			// Low coverage warning
			expect(output).toContain("10%");

			// 0 violations might be suspicious
			expect(output).toContain("VIOLATION events: 0");

			// High ghost %
			expect(output).toContain("90%");

			// Regressions
			expect(output).toContain("3 regressions detected");
		});
	});
});
