import { createScorer } from "evalite";
import type { EvalRecord } from "swarm/eval-capture";

/**
 * Outcome-based scorers for evaluating decomposition quality
 *
 * These scorers evaluate based on ACTUAL execution outcomes,
 * not just the structure of the decomposition.
 *
 * Requires EvalRecord with outcomes populated.
 */

/**
 * Execution Success Scorer
 *
 * Measures whether all subtasks succeeded without errors.
 * This is the ultimate measure - did the decomposition actually work?
 *
 * Score: 1.0 if all outcomes.success === true, 0.0 otherwise
 */
export const executionSuccess = createScorer({
  name: "Execution Success",
  description: "All subtasks completed successfully without errors",
  scorer: ({ output }) => {
    try {
      const record = JSON.parse(String(output)) as EvalRecord;

      // Check if outcomes exist
      if (!record.outcomes || record.outcomes.length === 0) {
        return {
          score: 0,
          message: "No outcome data available",
        };
      }

      // Check if all subtasks succeeded
      const allSucceeded = record.outcomes.every((outcome) => outcome.success);

      if (allSucceeded) {
        return {
          score: 1,
          message: `All ${record.outcomes.length} subtasks succeeded`,
        };
      }

      // Report failures
      const failures = record.outcomes.filter((o) => !o.success);
      const failureList = failures.map((f) => f.title || f.bead_id).join(", ");

      return {
        score: 0,
        message: `${failures.length}/${record.outcomes.length} subtasks failed: ${failureList}`,
      };
    } catch (error) {
      return {
        score: 0,
        message: `Failed to parse EvalRecord: ${error}`,
      };
    }
  },
});

/**
 * Time Balance Scorer
 *
 * Measures how evenly balanced the work was across subtasks.
 * Unbalanced work means some agents finish early while others are bottlenecked.
 *
 * Score: 1.0 if max/min ratio < 2.0 (well balanced)
 *        0.5 if ratio < 4.0 (moderately balanced)
 *        0.0 if ratio >= 4.0 (poorly balanced)
 */
export const timeBalance = createScorer({
  name: "Time Balance",
  description: "Work is evenly distributed across subtasks (max/min duration)",
  scorer: ({ output }) => {
    try {
      const record = JSON.parse(String(output)) as EvalRecord;

      // Check if outcomes exist
      if (!record.outcomes || record.outcomes.length === 0) {
        return {
          score: 0,
          message: "No outcome data available",
        };
      }

      // Need at least 2 subtasks to measure balance
      if (record.outcomes.length < 2) {
        return {
          score: 1,
          message: "Only one subtask - perfect balance",
        };
      }

      // Get durations (filter out zeros)
      const durations = record.outcomes
        .map((o) => o.duration_ms)
        .filter((d) => d > 0);

      if (durations.length === 0) {
        return {
          score: 0,
          message: "No duration data available",
        };
      }

      const maxDuration = Math.max(...durations);
      const minDuration = Math.min(...durations);
      const ratio = maxDuration / minDuration;

      // Score based on ratio
      let score: number;
      let assessment: string;

      if (ratio < 2.0) {
        score = 1.0;
        assessment = "well balanced";
      } else if (ratio < 4.0) {
        score = 0.5;
        assessment = "moderately balanced";
      } else {
        score = 0.0;
        assessment = "poorly balanced";
      }

      const maxSeconds = Math.round(maxDuration / 1000);
      const minSeconds = Math.round(minDuration / 1000);

      return {
        score,
        message: `Ratio ${ratio.toFixed(1)}x (${maxSeconds}s / ${minSeconds}s) - ${assessment}`,
      };
    } catch (error) {
      return {
        score: 0,
        message: `Failed to parse EvalRecord: ${error}`,
      };
    }
  },
});

/**
 * Scope Accuracy Scorer
 *
 * Measures how accurately the decomposition predicted which files would be touched.
 * High accuracy means the planner understood the work scope correctly.
 *
 * Score: intersection(actual, planned) / planned.length
 *        1.0 = all planned files were touched, no extras
 *        0.5 = half the planned files were touched
 *        0.0 = none of the planned files were touched
 */
export const scopeAccuracy = createScorer({
  name: "Scope Accuracy",
  description:
    "Planned files match actual files touched (accuracy of scope prediction)",
  scorer: ({ output }) => {
    try {
      const record = JSON.parse(String(output)) as EvalRecord;

      // Check if outcomes exist
      if (!record.outcomes || record.outcomes.length === 0) {
        return {
          score: 0,
          message: "No outcome data available",
        };
      }

      // Calculate accuracy per subtask
      let totalPlanned = 0;
      let totalCorrect = 0;

      for (const outcome of record.outcomes) {
        const planned = new Set(outcome.planned_files);
        const actual = new Set(outcome.actual_files);

        // Count intersection (files in both planned and actual)
        const intersection = Array.from(planned).filter((f) => actual.has(f));

        totalPlanned += planned.size;
        totalCorrect += intersection.length;
      }

      if (totalPlanned === 0) {
        return {
          score: 0,
          message: "No planned files to measure against",
        };
      }

      const accuracy = totalCorrect / totalPlanned;

      return {
        score: accuracy,
        message: `${totalCorrect}/${totalPlanned} planned files touched (${(accuracy * 100).toFixed(0)}% accuracy)`,
      };
    } catch (error) {
      return {
        score: 0,
        message: `Failed to parse EvalRecord: ${error}`,
      };
    }
  },
});

/**
 * Scope Drift Scorer
 *
 * Penalizes when agents touch files NOT in their planned scope.
 * Scope drift indicates poor planning or unexpected dependencies.
 *
 * Score: 1.0 if no drift (all actual files were planned)
 *        Decreases linearly with drift percentage
 *        0.0 if drift > 50%
 */
export const scopeDrift = createScorer({
  name: "Scope Drift",
  description:
    "Agents stayed within their planned file scope (no unexpected files)",
  scorer: ({ output }) => {
    try {
      const record = JSON.parse(String(output)) as EvalRecord;

      // Check if outcomes exist
      if (!record.outcomes || record.outcomes.length === 0) {
        return {
          score: 0,
          message: "No outcome data available",
        };
      }

      // Calculate drift per subtask
      let totalActual = 0;
      let totalDrift = 0;

      for (const outcome of record.outcomes) {
        const planned = new Set(outcome.planned_files);
        const actual = new Set(outcome.actual_files);

        // Count files in actual but NOT in planned
        const drift = Array.from(actual).filter((f) => !planned.has(f));

        totalActual += actual.size;
        totalDrift += drift.length;
      }

      if (totalActual === 0) {
        return {
          score: 1,
          message: "No files touched",
        };
      }

      const driftRatio = totalDrift / totalActual;

      // Score: 1.0 if no drift, linearly decrease to 0 at 50% drift
      const score = Math.max(0, 1.0 - driftRatio * 2);

      const driftPct = (driftRatio * 100).toFixed(0);

      return {
        score,
        message: `${totalDrift}/${totalActual} files were unplanned (${driftPct}% drift)`,
      };
    } catch (error) {
      return {
        score: 0,
        message: `Failed to parse EvalRecord: ${error}`,
      };
    }
  },
});

/**
 * No Rework Scorer
 *
 * Checks that no subtask touched files assigned to another subtask.
 * Rework indicates poor decomposition or missing dependencies.
 *
 * Score: 1.0 if no rework (no subtask touched another's planned files)
 *        0.0 if rework detected
 */
export const noRework = createScorer({
  name: "No Rework",
  description: "No subtask touched files assigned to another subtask",
  scorer: ({ output }) => {
    try {
      const record = JSON.parse(String(output)) as EvalRecord;

      // Check if outcomes exist
      if (!record.outcomes || record.outcomes.length === 0) {
        return {
          score: 0,
          message: "No outcome data available",
        };
      }

      // Build map of planned files per subtask
      const plannedBySubtask = new Map<string, Set<string>>();

      for (const outcome of record.outcomes) {
        plannedBySubtask.set(outcome.bead_id, new Set(outcome.planned_files));
      }

      // Check each subtask for rework
      const reworkCases: string[] = [];

      for (const outcome of record.outcomes) {
        const actualFiles = new Set(outcome.actual_files);

        // Check if this subtask touched files planned for another subtask
        for (const [otherBeadId, otherPlanned] of plannedBySubtask.entries()) {
          if (otherBeadId === outcome.bead_id) {
            continue; // Skip self
          }

          // Find intersection
          const overlap = Array.from(actualFiles).filter((f) =>
            otherPlanned.has(f),
          );

          if (overlap.length > 0) {
            reworkCases.push(
              `${outcome.title || outcome.bead_id} touched ${overlap.length} file(s) from ${otherBeadId}`,
            );
          }
        }
      }

      if (reworkCases.length > 0) {
        return {
          score: 0,
          message: `Rework detected: ${reworkCases.join("; ")}`,
        };
      }

      return {
        score: 1,
        message: "No rework - all subtasks stayed in their lanes",
      };
    } catch (error) {
      return {
        score: 0,
        message: `Failed to parse EvalRecord: ${error}`,
      };
    }
  },
});
