/**
 * Integration test for regression detection in eval-gate flow
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { recordEvalRun } from "./eval-history.js";
import { detectRegressions } from "./regression-detection.js";

describe("Regression detection integration", () => {
  const testDir = path.join(import.meta.dir, ".test-regression-integration");
  
  beforeEach(() => {
    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir, { recursive: true });
    }
    
    const opencodePath = path.join(testDir, ".opencode");
    if (!fs.existsSync(opencodePath)) {
      fs.mkdirSync(opencodePath, { recursive: true });
    }
  });
  
  afterEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });
  
  test("Real-world scenario: -19.3% decomposition quality regression", () => {
    // Simulate the actual regression that went unnoticed for 3 days
    
    // Baseline run (Dec 25)
    recordEvalRun(testDir, {
      timestamp: "2025-12-25T10:00:00Z",
      eval_name: "swarm-decomposition-quality",
      score: 0.872,
      run_count: 10,
    });
    
    // Regressed run (Dec 28) - went unnoticed
    recordEvalRun(testDir, {
      timestamp: "2025-12-28T10:00:00Z",
      eval_name: "swarm-decomposition-quality",
      score: 0.679,
      run_count: 11,
    });
    
    // Detect regressions
    const regressions = detectRegressions(testDir, 0.10);
    
    // Should detect the regression
    expect(regressions.length).toBe(1);
    expect(regressions[0].evalName).toBe("swarm-decomposition-quality");
    expect(regressions[0].oldScore).toBe(0.872);
    expect(regressions[0].newScore).toBe(0.679);
    
    // Delta should be ~19.3%
    expect(regressions[0].delta).toBeCloseTo(0.193, 3);
    expect(regressions[0].deltaPercent).toBeCloseTo(-22.1, 1);
  });
  
  test("CI integration scenario: multiple evals, some regressed", () => {
    // Simulate a CI run with multiple evals
    const evals = [
      { name: "coordinator-behavior", oldScore: 0.85, newScore: 0.86 }, // Improvement
      { name: "swarm-decomposition", oldScore: 0.92, newScore: 0.78 }, // -15.2% regression
      { name: "compaction-quality", oldScore: 0.88, newScore: 0.90 }, // Improvement
      { name: "example-eval", oldScore: 0.95, newScore: 0.75 }, // -21.1% regression
    ];
    
    for (const evalData of evals) {
      // Previous run
      recordEvalRun(testDir, {
        timestamp: "2025-12-27T10:00:00Z",
        eval_name: evalData.name,
        score: evalData.oldScore,
        run_count: 5,
      });
      
      // Latest run
      recordEvalRun(testDir, {
        timestamp: "2025-12-28T10:00:00Z",
        eval_name: evalData.name,
        score: evalData.newScore,
        run_count: 6,
      });
    }
    
    // Detect regressions
    const regressions = detectRegressions(testDir, 0.10);
    
    // Should detect 2 regressions (swarm-decomposition and example-eval)
    expect(regressions.length).toBe(2);
    
    // Should be sorted by severity (example-eval first with -21.1%)
    expect(regressions[0].evalName).toBe("example-eval");
    expect(regressions[0].deltaPercent).toBeCloseTo(-21.1, 1);
    
    expect(regressions[1].evalName).toBe("swarm-decomposition");
    expect(regressions[1].deltaPercent).toBeCloseTo(-15.2, 1);
  });
});
