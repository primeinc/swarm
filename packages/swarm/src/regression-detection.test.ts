/**
 * Tests for eval regression detection
 * 
 * TDD approach:
 * 1. Write failing test
 * 2. Implement minimal detectRegressions()
 * 3. Refactor while green
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { recordEvalRun } from "./eval-history.js";
import { detectRegressions, type RegressionResult } from "./regression-detection.js";

describe("detectRegressions", () => {
  const testDir = path.join(import.meta.dir, ".test-regression-detection");
  
  beforeEach(() => {
    // Create test directory
    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir, { recursive: true });
    }
    
    // Create .opencode subdirectory
    const opencodePath = path.join(testDir, ".opencode");
    if (!fs.existsSync(opencodePath)) {
      fs.mkdirSync(opencodePath, { recursive: true });
    }
  });
  
  afterEach(() => {
    // Clean up test directory
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });
  
  test("returns empty array when no history exists", () => {
    const result = detectRegressions(testDir);
    expect(result).toEqual([]);
  });
  
  test("returns empty array when only one run exists", () => {
    // Record single run
    recordEvalRun(testDir, {
      timestamp: new Date().toISOString(),
      eval_name: "test-eval",
      score: 0.85,
      run_count: 1,
    });
    
    const result = detectRegressions(testDir);
    expect(result).toEqual([]);
  });
  
  test("detects regression when score drops >10% (default threshold)", () => {
    // Record baseline run
    recordEvalRun(testDir, {
      timestamp: "2025-12-25T10:00:00Z",
      eval_name: "decomposition-quality",
      score: 0.872,
      run_count: 1,
    });
    
    // Record regressed run
    recordEvalRun(testDir, {
      timestamp: "2025-12-28T10:00:00Z",
      eval_name: "decomposition-quality",
      score: 0.679,
      run_count: 2,
    });
    
    const result = detectRegressions(testDir);
    
    expect(result.length).toBe(1);
    expect(result[0].evalName).toBe("decomposition-quality");
    expect(result[0].oldScore).toBe(0.872);
    expect(result[0].newScore).toBe(0.679);
    expect(result[0].delta).toBeCloseTo(0.193, 3);
    expect(result[0].deltaPercent).toBeCloseTo(-22.1, 1);
  });
  
  test("ignores regression below threshold", () => {
    // Record baseline run
    recordEvalRun(testDir, {
      timestamp: "2025-12-25T10:00:00Z",
      eval_name: "test-eval",
      score: 0.85,
      run_count: 1,
    });
    
    // Record slight regression (5% drop, below 10% threshold)
    recordEvalRun(testDir, {
      timestamp: "2025-12-28T10:00:00Z",
      eval_name: "test-eval",
      score: 0.8075, // 5% drop
      run_count: 2,
    });
    
    const result = detectRegressions(testDir);
    expect(result).toEqual([]);
  });
  
  test("ignores improvements (score increases)", () => {
    // Record baseline run
    recordEvalRun(testDir, {
      timestamp: "2025-12-25T10:00:00Z",
      eval_name: "test-eval",
      score: 0.75,
      run_count: 1,
    });
    
    // Record improvement (20% increase)
    recordEvalRun(testDir, {
      timestamp: "2025-12-28T10:00:00Z",
      eval_name: "test-eval",
      score: 0.90,
      run_count: 2,
    });
    
    const result = detectRegressions(testDir);
    expect(result).toEqual([]);
  });
  
  test("respects custom threshold", () => {
    // Record baseline run
    recordEvalRun(testDir, {
      timestamp: "2025-12-25T10:00:00Z",
      eval_name: "test-eval",
      score: 0.85,
      run_count: 1,
    });
    
    // Record 5% regression
    recordEvalRun(testDir, {
      timestamp: "2025-12-28T10:00:00Z",
      eval_name: "test-eval",
      score: 0.8075,
      run_count: 2,
    });
    
    // Default threshold (10%) should ignore
    expect(detectRegressions(testDir, 0.10)).toEqual([]);
    
    // Custom threshold (3%) should detect
    const result = detectRegressions(testDir, 0.03);
    expect(result.length).toBe(1);
    expect(result[0].evalName).toBe("test-eval");
  });
  
  test("detects multiple regressions across different evals", () => {
    // Eval 1: regression
    recordEvalRun(testDir, {
      timestamp: "2025-12-25T10:00:00Z",
      eval_name: "eval-a",
      score: 0.90,
      run_count: 1,
    });
    recordEvalRun(testDir, {
      timestamp: "2025-12-28T10:00:00Z",
      eval_name: "eval-a",
      score: 0.70, // 22% drop
      run_count: 2,
    });
    
    // Eval 2: regression
    recordEvalRun(testDir, {
      timestamp: "2025-12-25T10:00:00Z",
      eval_name: "eval-b",
      score: 0.80,
      run_count: 1,
    });
    recordEvalRun(testDir, {
      timestamp: "2025-12-28T10:00:00Z",
      eval_name: "eval-b",
      score: 0.68, // 15% drop
      run_count: 2,
    });
    
    // Eval 3: no regression
    recordEvalRun(testDir, {
      timestamp: "2025-12-25T10:00:00Z",
      eval_name: "eval-c",
      score: 0.75,
      run_count: 1,
    });
    recordEvalRun(testDir, {
      timestamp: "2025-12-28T10:00:00Z",
      eval_name: "eval-c",
      score: 0.80, // Improvement
      run_count: 2,
    });
    
    const result = detectRegressions(testDir);
    
    expect(result.length).toBe(2);
    
    // Should be sorted by severity (largest delta first)
    expect(result[0].evalName).toBe("eval-a");
    expect(result[0].deltaPercent).toBeCloseTo(-22.2, 1);
    
    expect(result[1].evalName).toBe("eval-b");
    expect(result[1].deltaPercent).toBeCloseTo(-15.0, 1);
  });
  
  test("compares only last two runs per eval", () => {
    // Record 3 runs
    recordEvalRun(testDir, {
      timestamp: "2025-12-20T10:00:00Z",
      eval_name: "test-eval",
      score: 0.95, // Old score that should be ignored
      run_count: 1,
    });
    recordEvalRun(testDir, {
      timestamp: "2025-12-25T10:00:00Z",
      eval_name: "test-eval",
      score: 0.85, // Previous run
      run_count: 2,
    });
    recordEvalRun(testDir, {
      timestamp: "2025-12-28T10:00:00Z",
      eval_name: "test-eval",
      score: 0.70, // Latest run
      run_count: 3,
    });
    
    const result = detectRegressions(testDir);
    
    // Should compare 0.85 (run 2) vs 0.70 (run 3), NOT 0.95 (run 1)
    expect(result.length).toBe(1);
    expect(result[0].oldScore).toBe(0.85);
    expect(result[0].newScore).toBe(0.70);
  });
});
