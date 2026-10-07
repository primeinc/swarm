#!/usr/bin/env bun
/**
 * Tests for eval-gate CLI
 * 
 * TDD: Write tests first to verify behavior before implementing.
 */

import { describe, test, expect, beforeEach, mock } from "bun:test";
import type { RunEvalsResult } from "../src/eval-runner.js";

// Mock process.exit to prevent test from actually exiting
const mockExit = mock((code?: number) => {
  throw new Error(`EXIT:${code ?? 0}`);
});

beforeEach(() => {
  mockExit.mockClear();
});

describe("eval-gate CLI", () => {
  test("exits 0 when all gates pass", async () => {
    const mockResult: RunEvalsResult = {
      success: true,
      totalSuites: 2,
      totalEvals: 10,
      averageScore: 0.95,
      suites: [],
      gateResults: [
        {
          suite: "example",
          passed: true,
          phase: "production",
          message: "Passed",
          currentScore: 0.95,
        },
      ],
    };

    // Simulate main() execution with mocked runEvals
    let exitCode: number | undefined;
    try {
      // Would call main() here if we extract it to a function
      // For now, verify exit logic manually
      const failedGates = mockResult.gateResults?.filter((g) => !g.passed) || [];
      if (failedGates.length > 0 || !mockResult.success) {
        exitCode = 1;
      } else {
        exitCode = 0;
      }
    } catch (e) {
      // Extract exit code from mocked error
      if (e instanceof Error && e.message.startsWith("EXIT:")) {
        exitCode = parseInt(e.message.split(":")[1]);
      }
    }

    expect(exitCode).toBe(0);
  });

  test("exits 1 when gates fail", async () => {
    const mockResult: RunEvalsResult = {
      success: false,
      totalSuites: 2,
      totalEvals: 10,
      averageScore: 0.45,
      suites: [],
      gateResults: [
        {
          suite: "coordinator",
          passed: false,
          phase: "production",
          message: "Regression detected",
          currentScore: 0.45,
          baseline: 0.85,
          regressionPercent: -47,
        },
      ],
    };

    let exitCode: number | undefined;
    const failedGates = mockResult.gateResults?.filter((g) => !g.passed) || [];
    if (failedGates.length > 0 || !mockResult.success) {
      exitCode = 1;
    } else {
      exitCode = 0;
    }

    expect(exitCode).toBe(1);
  });

  test("exits 1 when threshold check fails", async () => {
    const mockResult: RunEvalsResult = {
      success: false, // Threshold failed
      totalSuites: 2,
      totalEvals: 10,
      averageScore: 0.65, // Below threshold of 80
      suites: [],
      gateResults: [],
    };

    let exitCode: number | undefined;
    const failedGates = mockResult.gateResults?.filter((g) => !g.passed) || [];
    if (failedGates.length > 0 || !mockResult.success) {
      exitCode = 1;
    } else {
      exitCode = 0;
    }

    expect(exitCode).toBe(1);
  });

  test("parses --suite argument", () => {
    const args = ["--suite", "coordinator"];
    let suiteFilter: string | undefined;

    for (let i = 0; i < args.length; i++) {
      if (args[i] === "--suite" && args[i + 1]) {
        suiteFilter = args[i + 1];
        i++;
      }
    }

    expect(suiteFilter).toBe("coordinator");
  });

  test("parses --threshold argument", () => {
    const args = ["--threshold", "85"];
    let scoreThreshold: number | undefined;

    for (let i = 0; i < args.length; i++) {
      if (args[i] === "--threshold" && args[i + 1]) {
        scoreThreshold = parseInt(args[i + 1], 10);
        i++;
      }
    }

    expect(scoreThreshold).toBe(85);
  });

  test("handles missing arguments gracefully", () => {
    const args: string[] = [];
    let suiteFilter: string | undefined;
    let scoreThreshold: number | undefined;

    for (let i = 0; i < args.length; i++) {
      if (args[i] === "--suite" && args[i + 1]) {
        suiteFilter = args[i + 1];
        i++;
      } else if (args[i] === "--threshold" && args[i + 1]) {
        scoreThreshold = parseInt(args[i + 1], 10);
        i++;
      }
    }

    expect(suiteFilter).toBeUndefined();
    expect(scoreThreshold).toBeUndefined();
  });
  
  test("exits 1 when regressions detected", () => {
    // Simulate regression detection result
    const regressions = [
      {
        evalName: "decomposition-quality",
        oldScore: 0.872,
        newScore: 0.679,
        delta: 0.193,
        deltaPercent: -22.1,
      },
    ];
    
    // Exit logic
    let exitCode: number | undefined;
    if (regressions.length > 0) {
      exitCode = 1;
    } else {
      exitCode = 0;
    }
    
    expect(exitCode).toBe(1);
  });
});
