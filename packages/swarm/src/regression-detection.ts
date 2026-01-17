/**
 * Regression Detection for Eval Scores
 *
 * Compares latest eval run to previous run and detects regressions above threshold.
 *
 * @module regression-detection
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { getEvalHistoryPath, type EvalRunRecord } from "./eval-history.js";

/**
 * Regression detection result
 */
export interface RegressionResult {
  /** Name of the eval that regressed */
  evalName: string;
  /** Previous run score */
  oldScore: number;
  /** Latest run score */
  newScore: number;
  /** Absolute delta (oldScore - newScore) */
  delta: number;
  /** Percentage change ((newScore - oldScore) / oldScore * 100) */
  deltaPercent: number;
}

/**
 * Read all eval run records from JSONL file
 *
 * Internal helper for parsing the history file
 */
function readAllRecords(projectPath: string): EvalRunRecord[] {
  const historyPath = getEvalHistoryPath(projectPath);

  if (!fs.existsSync(historyPath)) {
    return [];
  }

  const content = fs.readFileSync(historyPath, "utf-8");
  const lines = content.trim().split("\n").filter(Boolean);

  return lines.map((line) => JSON.parse(line) as EvalRunRecord);
}

/**
 * Get unique eval names from history
 */
function getEvalNames(records: EvalRunRecord[]): string[] {
  const names = new Set<string>();
  for (const record of records) {
    names.add(record.eval_name);
  }
  return Array.from(names);
}

/**
 * Get last N runs for a specific eval, sorted chronologically (oldest first)
 */
function getLastNRuns(
  records: EvalRunRecord[],
  evalName: string,
  n: number
): EvalRunRecord[] {
  const evalRecords = records.filter((r) => r.eval_name === evalName);

  // Sort by run_count descending, then take last N
  return evalRecords.sort((a, b) => b.run_count - a.run_count).slice(0, n);
}

/**
 * Detect regressions by comparing latest run to previous run
 *
 * Scans all evals in eval-history.jsonl and compares the last two runs
 * for each eval. Returns evals where the score dropped more than the
 * threshold.
 *
 * **Algorithm**:
 * 1. Read all eval history records
 * 2. Group by eval name
 * 3. For each eval with ≥2 runs:
 *    - Get last 2 runs
 *    - Calculate delta and deltaPercent
 *    - If delta exceeds threshold AND score dropped, record regression
 * 4. Sort results by severity (largest delta first)
 *
 * **Delta calculation**:
 * - delta = oldScore - newScore (absolute drop)
 * - deltaPercent = (newScore - oldScore) / oldScore * 100 (negative for regression)
 *
 * **Threshold**: Specified as absolute value (e.g., 0.10 = 10% drop required to report)
 *
 * @param projectPath - Absolute path to project root
 * @param threshold - Minimum delta to report (default: 0.10 = 10%)
 * @returns List of regressions sorted by severity (largest delta first)
 *
 * @example
 * ```typescript
 * import { detectRegressions } from "./regression-detection.js";
 *
 * const regressions = detectRegressions("/path/to/project", 0.10);
 *
 * if (regressions.length > 0) {
 *   console.error("⚠️ REGRESSION DETECTED");
 *   for (const reg of regressions) {
 *     console.error(`├── ${reg.evalName}: ${(reg.oldScore * 100).toFixed(1)}% → ${(reg.newScore * 100).toFixed(1)}% (${reg.deltaPercent.toFixed(1)}%)`);
 *   }
 *   console.error(`└── Threshold: ${(threshold * 100).toFixed(0)}%`);
 * }
 * ```
 */
export function detectRegressions(
  projectPath: string,
  threshold: number = 0.1
): RegressionResult[] {
  const records = readAllRecords(projectPath);

  if (records.length === 0) {
    return [];
  }

  const evalNames = getEvalNames(records);
  const regressions: RegressionResult[] = [];

  for (const evalName of evalNames) {
    const lastTwoRuns = getLastNRuns(records, evalName, 2);

    // Need at least 2 runs to compare
    if (lastTwoRuns.length < 2) {
      continue;
    }

    // lastTwoRuns is sorted descending by run_count
    // [0] = latest, [1] = previous
    const latest = lastTwoRuns[0];
    const previous = lastTwoRuns[1];

    const delta = previous.score - latest.score;
    const deltaPercent = ((latest.score - previous.score) / previous.score) * 100;

    // Only report if:
    // 1. Score dropped (delta > 0)
    // 2. Drop exceeds threshold
    if (delta > 0 && delta >= threshold) {
      regressions.push({
        evalName,
        oldScore: previous.score,
        newScore: latest.score,
        delta,
        deltaPercent,
      });
    }
  }

  // Sort by delta descending (largest regression first)
  return regressions.sort((a, b) => b.delta - a.delta);
}
