/**
 * Data Loader Tests
 *
 * Tests the PGlite-backed eval data loader functions.
 * Uses a real in-memory PGlite database for accurate testing.
 */
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import {
  loadEvalCases,
  hasRealEvalData,
  getEvalDataSummary,
} from "./data-loader.js";
import {
  appendEvent,
  getDatabase,
  closeDatabase,
  type DecompositionGeneratedEvent,
  type SubtaskOutcomeEvent,
} from "swarm-mail";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

const TEST_PROJECT_KEY = "test-project-eval-loader";

// Create a unique temp directory for this test run
let testDir: string;

describe("Data Loader", () => {
  beforeAll(async () => {
    // Create temp directory for test database
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), "eval-loader-test-"));

    // Initialize database by getting it (lazy init)
    await getDatabase(testDir);
  });

  afterAll(async () => {
    await closeDatabase(testDir);
    // Clean up temp directory
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  describe("loadEvalCases", () => {
    it("transforms eval records to EvalCase format", async () => {
      // Insert a decomposition event
      const decompositionEvent: DecompositionGeneratedEvent = {
        type: "decomposition_generated",
        timestamp: Date.now(),
        project_key: TEST_PROJECT_KEY,
        epic_id: "epic-load-1",
        task: "Add authentication",
        context: "Next.js app",
        strategy: "feature-based",
        epic_title: "Auth Epic",
        subtasks: [
          { title: "OAuth setup", files: ["src/auth/oauth.ts"], priority: 1 },
          {
            title: "Session management",
            files: ["src/auth/session.ts"],
            priority: 2,
          },
        ],
      };
      await appendEvent(decompositionEvent, testDir);

      // Insert outcome events for both subtasks
      const outcome1: SubtaskOutcomeEvent = {
        type: "subtask_outcome",
        timestamp: Date.now(),
        project_key: TEST_PROJECT_KEY,
        epic_id: "epic-load-1",
        cell_id: "epic-load-1.1",
        planned_files: ["src/auth/oauth.ts"],
        actual_files: ["src/auth/oauth.ts"],
        duration_ms: 5000,
        error_count: 0,
        retry_count: 0,
        success: true,
      };
      await appendEvent(outcome1, testDir);

      const outcome2: SubtaskOutcomeEvent = {
        type: "subtask_outcome",
        timestamp: Date.now(),
        project_key: TEST_PROJECT_KEY,
        epic_id: "epic-load-1",
        cell_id: "epic-load-1.2",
        planned_files: ["src/auth/session.ts"],
        actual_files: ["src/auth/session.ts"],
        duration_ms: 3000,
        error_count: 0,
        retry_count: 0,
        success: true,
      };
      await appendEvent(outcome2, testDir);

      const cases = await loadEvalCases(TEST_PROJECT_KEY, {
        projectPath: testDir,
      });

      expect(cases.length).toBeGreaterThanOrEqual(1);
      const authCase = cases.find((c) => c.input.task === "Add authentication");
      expect(authCase).toBeDefined();
      expect(authCase!.input.context).toBe("Next.js app");
      expect(authCase!.expected.minSubtasks).toBe(2);
      expect(authCase!.expected.maxSubtasks).toBe(2);
      expect(authCase!.expected.requiredFiles).toContain("src/auth/oauth.ts");
      expect(authCase!.expected.requiredFiles).toContain("src/auth/session.ts");
      expect(authCase!.actual).toBeDefined();
    });

    it("filters by success when successOnly is true", async () => {
      // Insert a successful decomposition
      const successEvent: DecompositionGeneratedEvent = {
        type: "decomposition_generated",
        timestamp: Date.now(),
        project_key: TEST_PROJECT_KEY,
        epic_id: "epic-success-filter",
        task: "Success task for filter",
        strategy: "feature-based",
        epic_title: "Success Epic",
        subtasks: [{ title: "Sub", files: ["src/success.ts"], priority: 1 }],
      };
      await appendEvent(successEvent, testDir);

      // Mark it successful
      const successOutcome: SubtaskOutcomeEvent = {
        type: "subtask_outcome",
        timestamp: Date.now(),
        project_key: TEST_PROJECT_KEY,
        epic_id: "epic-success-filter",
        cell_id: "epic-success-filter.1",
        planned_files: ["src/success.ts"],
        actual_files: ["src/success.ts"],
        duration_ms: 1000,
        error_count: 0,
        retry_count: 0,
        success: true,
      };
      await appendEvent(successOutcome, testDir);

      // Insert a failed decomposition
      const failEvent: DecompositionGeneratedEvent = {
        type: "decomposition_generated",
        timestamp: Date.now(),
        project_key: TEST_PROJECT_KEY,
        epic_id: "epic-fail-filter",
        task: "Failed task for filter",
        strategy: "feature-based",
        epic_title: "Failed Epic",
        subtasks: [{ title: "Sub", files: ["src/fail.ts"], priority: 1 }],
      };
      await appendEvent(failEvent, testDir);

      // Mark it failed
      const failOutcome: SubtaskOutcomeEvent = {
        type: "subtask_outcome",
        timestamp: Date.now(),
        project_key: TEST_PROJECT_KEY,
        epic_id: "epic-fail-filter",
        cell_id: "epic-fail-filter.1",
        planned_files: ["src/fail.ts"],
        actual_files: [],
        duration_ms: 500,
        error_count: 3,
        retry_count: 2,
        success: false,
      };
      await appendEvent(failOutcome, testDir);

      const successCases = await loadEvalCases(TEST_PROJECT_KEY, {
        successOnly: true,
        projectPath: testDir,
      });

      // Should only include successful cases
      const failedCase = successCases.find(
        (c) => c.input.task === "Failed task for filter",
      );
      expect(failedCase).toBeUndefined();
    });

    it("passes strategy filter to getEvalRecords", async () => {
      // Insert file-based decomposition
      const fileBasedEvent: DecompositionGeneratedEvent = {
        type: "decomposition_generated",
        timestamp: Date.now(),
        project_key: TEST_PROJECT_KEY,
        epic_id: "epic-file-based",
        task: "File-based task",
        strategy: "file-based",
        epic_title: "File Epic",
        subtasks: [{ title: "Sub", files: ["src/file.ts"], priority: 1 }],
      };
      await appendEvent(fileBasedEvent, testDir);

      const fileBasedCases = await loadEvalCases(TEST_PROJECT_KEY, {
        strategy: "file-based",
        projectPath: testDir,
      });

      // All returned cases should be file-based
      for (const c of fileBasedCases) {
        expect(c.actual?.strategy).toBe("file-based");
      }
    });

    it("passes limit to getEvalRecords", async () => {
      const cases = await loadEvalCases(TEST_PROJECT_KEY, {
        limit: 2,
        projectPath: testDir,
      });

      expect(cases.length).toBeLessThanOrEqual(2);
    });

    it("handles records with no context", async () => {
      const noContextEvent: DecompositionGeneratedEvent = {
        type: "decomposition_generated",
        timestamp: Date.now(),
        project_key: TEST_PROJECT_KEY,
        epic_id: "epic-no-context",
        task: "Task without context",
        // context is undefined
        strategy: "feature-based",
        epic_title: "No Context Epic",
        subtasks: [{ title: "Sub", files: [], priority: 1 }],
      };
      await appendEvent(noContextEvent, testDir);

      const cases = await loadEvalCases(TEST_PROJECT_KEY, {
        projectPath: testDir,
      });
      const noContextCase = cases.find(
        (c) => c.input.task === "Task without context",
      );

      expect(noContextCase).toBeDefined();
      expect(noContextCase!.input.context).toBeUndefined();
    });
  });

  describe("hasRealEvalData", () => {
    it("returns true when enough records exist", async () => {
      // We've inserted several records above, should have enough
      const hasData = await hasRealEvalData(TEST_PROJECT_KEY, 1, testDir);
      expect(hasData).toBe(true);
    });

    it("returns false when not enough records exist", async () => {
      // Use a project key with no data
      const hasData = await hasRealEvalData("nonexistent-project", 5, testDir);
      expect(hasData).toBe(false);
    });

    it("uses custom minRecords threshold", async () => {
      // Should have at least 1 record
      const hasData = await hasRealEvalData(TEST_PROJECT_KEY, 1, testDir);
      expect(hasData).toBe(true);

      // Should not have 1000 records
      const hasLotsOfData = await hasRealEvalData(
        TEST_PROJECT_KEY,
        1000,
        testDir,
      );
      expect(hasLotsOfData).toBe(false);
    });
  });

  describe("getEvalDataSummary", () => {
    it("returns formatted summary with hasEnoughData flag", async () => {
      const summary = await getEvalDataSummary(TEST_PROJECT_KEY, testDir);

      expect(summary.totalRecords).toBeGreaterThanOrEqual(1);
      expect(typeof summary.successRate).toBe("number");
      expect(typeof summary.byStrategy).toBe("object");
      expect(typeof summary.hasEnoughData).toBe("boolean");
    });

    it("sets hasEnoughData based on record count", async () => {
      // Empty project should not have enough data
      const emptySummary = await getEvalDataSummary("empty-project", testDir);
      expect(emptySummary.hasEnoughData).toBe(false);
      expect(emptySummary.totalRecords).toBe(0);
    });
  });
});
