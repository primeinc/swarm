/**
 * Tests for scoreOutcome() integration with swarm_complete
 *
 * Verifies that outcome scoring, feedback storage, and pattern maturity
 * updates happen automatically when workers complete tasks.
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { swarm_complete } from "./swarm-orchestrate";
import { createStorage, resetSessionStats, setStorage } from "./storage";
import type { LearningStorage } from "./storage";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

describe("swarm_complete learning integration", () => {
  let storage: LearningStorage;
  let testProjectPath: string;

  beforeEach(async () => {
    // Create temp project directory
    testProjectPath = fs.mkdtempSync(path.join(os.tmpdir(), "swarm-test-"));
    
    // Initialize git repo (required for hive operations)
    await Bun.$`cd ${testProjectPath} && git init && git config user.name "Test" && git config user.email "test@test.com"`.quiet();
    
    // Use in-memory storage for tests
    storage = createStorage({ backend: "memory" });
    setStorage(storage);
    resetSessionStats();
    
    // Set hive working directory
    const { setHiveWorkingDirectory } = await import("./hive");
    setHiveWorkingDirectory(testProjectPath);
  });

  afterEach(() => {
    if (fs.existsSync(testProjectPath)) {
      fs.rmSync(testProjectPath, { recursive: true, force: true });
    }
  });

  test("scoreOutcome function works correctly", async () => {
    const { scoreOutcome } = await import("./learning");
    
    // Fast completion with no errors = helpful
    const helpfulOutcome = scoreOutcome({
      cell_id: "test-123",
      duration_ms: 60000, // 1 minute (fast)
      error_count: 0,
      retry_count: 0,
      success: true,
      files_touched: ["src/test.ts"],
      timestamp: new Date().toISOString(),
    });
    
    expect(helpfulOutcome.type).toBe("helpful");
    expect(helpfulOutcome.score).toBeGreaterThanOrEqual(0.7);
    expect(helpfulOutcome.reasoning).toContain("succeeded");
    
    // Slow completion with errors = harmful or neutral
    const slowOutcome = scoreOutcome({
      cell_id: "test-456",
      duration_ms: 40 * 60 * 1000, // 40 minutes (slow)
      error_count: 5,
      retry_count: 3,
      success: true,
      files_touched: ["src/test.ts"],
      timestamp: new Date().toISOString(),
    });
    
    // Should be harmful or neutral (not helpful)
    expect(slowOutcome.type).not.toBe("helpful");
    expect(slowOutcome.reasoning).toContain("errors");
  });

  test("GREEN: swarm_complete scores outcome and stores feedback", async () => {
    const { hive_create } = await import("./hive");
    
    // Create a simple task (not an epic)
    const createResult = await hive_create.execute({
      title: "Test Task",
      type: "task",
      priority: 2,
    }, { sessionID: "test-session" } as any);
    
    const taskData = JSON.parse(createResult);
    const beadId = taskData.id;
    const startTime = Date.now() - 30000; // Started 30 seconds ago

    // Call swarm_complete
    const result = await swarm_complete.execute(
      {
        project_key: testProjectPath,
        agent_name: "TestAgent",
        cell_id: beadId,
        summary: "Completed test task",
        files_touched: ["src/test.ts"],
        skip_verification: true,
        skip_review: true,
        start_time: startTime,
        error_count: 0,
        retry_count: 0,
      },
      { sessionID: "test-session" } as any,
    );

    // Parse response
    const response = JSON.parse(result);
    
    // Verify outcome scoring happened
    expect(response.outcome_scoring).toBeDefined();
    expect(response.outcome_scoring.scored).toBe(true);
    expect(response.outcome_scoring.feedback_type).toBeDefined();
    expect(["helpful", "harmful", "neutral"]).toContain(response.outcome_scoring.feedback_type);
    expect(response.outcome_scoring.score).toBeGreaterThanOrEqual(0);
    expect(response.outcome_scoring.score).toBeLessThanOrEqual(1);
    
    // Verify feedback was stored
    const allFeedback = await storage.getAllFeedback();
    expect(allFeedback.length).toBeGreaterThan(0);
    
    const feedbackForBead = await storage.getFeedbackByBead(beadId);
    expect(feedbackForBead.length).toBeGreaterThan(0);
    expect(feedbackForBead[0].cell_id).toBe(beadId);
    expect(feedbackForBead[0].criterion).toBe("task_completion");
  });
});
