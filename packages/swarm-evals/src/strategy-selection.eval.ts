/**
 * Strategy Selection Quality Eval
 *
 * Tests the quality of strategy selection for swarm task decomposition.
 * Validates that swarm_select_strategy chooses the correct strategy based on task characteristics.
 *
 * Strategies:
 * - file-based: Refactors, migrations, structural reorganization
 * - feature-based: New functionality, user stories, capabilities
 * - risk-based: Security, critical bugs, production incidents
 * - research-based: Investigation, debugging, exploration
 *
 * Run with: pnpm evalite evals/strategy-selection.eval.ts
 */
import { evalite } from "evalite";
import { createScorer } from "evalite";
import { strategySelectionCases } from "./fixtures/strategy-selection.js";
import { selectStrategy } from "swarm";

/**
 * Scorer: Validates correct strategy was selected
 *
 * Returns 1.0 if strategy matches expected, 0.0 otherwise.
 * Partial credit for reasonable alternative strategies.
 */
const strategyCorrectness = createScorer({
  name: "Strategy Correctness",
  description: "Validates correct strategy was selected",
  scorer: async ({ output, expected }) => {
    const result = output as {
      strategy: string;
      confidence: number;
      reasoning: string;
    };

    const expectedData = expected as {
      strategy: string;
      reasoning?: string;
    };

    // Exact match
    if (result.strategy === expectedData.strategy) {
      return {
        score: 1.0,
        message: `✓ Correct: ${result.strategy} (confidence: ${(result.confidence * 100).toFixed(0)}%)`,
      };
    }

    // Check if it's a reasonable alternative (some tasks are ambiguous)
    // Feature-based vs file-based can overlap for migrations
    // Research-based vs risk-based can overlap for critical bugs
    const reasonableAlternatives: Record<string, string[]> = {
      "file-based": ["feature-based"], // Some refactors could be feature-based
      "feature-based": ["file-based"], // Some features could be file-based
      "risk-based": ["research-based"], // Critical bugs might need investigation
      "research-based": ["risk-based"], // Investigation might uncover risks
    };

    const alternatives = reasonableAlternatives[expectedData.strategy] || [];
    if (alternatives.includes(result.strategy)) {
      return {
        score: 0.5,
        message: `⚠ Alternative: Got ${result.strategy}, expected ${expectedData.strategy} (both reasonable)`,
      };
    }

    return {
      score: 0.0,
      message: `✗ Wrong: Got ${result.strategy}, expected ${expectedData.strategy}`,
    };
  },
});

/**
 * Scorer: Validates confidence level is appropriate
 *
 * High confidence (>0.8) should only be for clear-cut cases.
 * Low confidence (<0.5) should trigger when keywords are ambiguous.
 */
const confidenceCalibration = createScorer({
  name: "Confidence Calibration",
  description: "Checks if confidence level matches task clarity",
  scorer: async ({ output, input }) => {
    const result = output as {
      strategy: string;
      confidence: number;
      reasoning: string;
    };

    const inputData = input as { task: string; context?: string };
    const taskLower = inputData.task.toLowerCase();

    // Clear-cut cases (should have high confidence)
    const clearCutKeywords = [
      "cve-",
      "security vulnerability",
      "refactor",
      "migrate",
      "investigate",
      "debug",
    ];
    const isClearCut = clearCutKeywords.some((kw) => taskLower.includes(kw));

    // Ambiguous cases (should have lower confidence)
    const ambiguousKeywords = ["fix", "improve", "update"];
    const isAmbiguous =
      ambiguousKeywords.some((kw) => taskLower.includes(kw)) &&
      !isClearCut;

    if (isClearCut && result.confidence > 0.7) {
      return {
        score: 1.0,
        message: `✓ High confidence (${(result.confidence * 100).toFixed(0)}%) for clear task`,
      };
    }

    if (isAmbiguous && result.confidence < 0.7) {
      return {
        score: 1.0,
        message: `✓ Appropriate uncertainty (${(result.confidence * 100).toFixed(0)}%) for ambiguous task`,
      };
    }

    if (isClearCut && result.confidence <= 0.7) {
      return {
        score: 0.5,
        message: `⚠ Low confidence (${(result.confidence * 100).toFixed(0)}%) for clear task`,
      };
    }

    if (isAmbiguous && result.confidence >= 0.7) {
      return {
        score: 0.5,
        message: `⚠ High confidence (${(result.confidence * 100).toFixed(0)}%) for ambiguous task`,
      };
    }

    // Reasonable confidence for normal cases
    return {
      score: 0.8,
      message: `Confidence: ${(result.confidence * 100).toFixed(0)}%`,
    };
  },
});

/**
 * Scorer: Validates reasoning explains the choice
 *
 * Good reasoning should reference:
 * - Matched keywords
 * - Strategy characteristics
 * - Task context
 */
const reasoningQuality = createScorer({
  name: "Reasoning Quality",
  description: "Checks if reasoning explains the strategy choice",
  scorer: async ({ output }) => {
    const result = output as {
      strategy: string;
      confidence: number;
      reasoning: string;
    };

    let score = 0.5; // baseline

    // Reasoning should mention keywords or patterns
    if (
      result.reasoning.toLowerCase().includes("keyword") ||
      result.reasoning.toLowerCase().includes("matched")
    ) {
      score += 0.2;
    }

    // Reasoning should reference the strategy characteristics
    const strategyMentioned =
      result.reasoning.toLowerCase().includes(result.strategy);
    if (strategyMentioned) {
      score += 0.2;
    }

    // Reasoning should be substantive (>20 chars)
    if (result.reasoning.length > 20) {
      score += 0.1;
    }

    return {
      score: Math.min(1.0, score),
      message: `Reasoning: "${result.reasoning.slice(0, 80)}${result.reasoning.length > 80 ? "..." : ""}"`,
    };
  },
});

/**
 * Main Eval: Strategy Selection Quality
 *
 * Tests strategy selection against known task types.
 */
evalite("Strategy Selection Quality", {
  data: async () =>
    strategySelectionCases.map((testCase) => ({
      input: testCase.input,
      expected: testCase.expected,
    })),

  task: async (input) => {
    const result = await selectStrategy(input.task);
    return result;
  },

  scorers: [strategyCorrectness, confidenceCalibration, reasoningQuality],
});

/**
 * Edge Case Eval: Ambiguous Tasks
 *
 * Tests handling of tasks that could reasonably map to multiple strategies.
 * These should have lower confidence and provide alternatives.
 */
evalite("Strategy Selection: Ambiguous Cases", {
  data: async () => [
    {
      input: { task: "Fix the payment system" },
      expected: {
        // Could be risk-based (payment = critical) or research-based (vague "fix")
        acceptableStrategies: ["risk-based", "research-based"],
        maxConfidence: 0.7,
      },
    },
    {
      input: { task: "Improve the codebase" },
      expected: {
        // Too vague - could be anything
        acceptableStrategies: ["file-based", "feature-based", "research-based"],
        maxConfidence: 0.6,
      },
    },
    {
      input: { task: "Update dependencies" },
      expected: {
        // Could be file-based (systematic changes) or risk-based (security updates)
        acceptableStrategies: ["file-based", "risk-based"],
        maxConfidence: 0.7,
      },
    },
  ],

  task: async (input) => {
    const result = await selectStrategy(input.task);
    return result;
  },

  scorers: [
    createScorer({
      name: "Acceptable Strategy Chosen",
      description: "Validates strategy is one of the acceptable options",
      scorer: async ({ output, expected }) => {
        const result = output as { strategy: string; confidence: number };
        const expectedData = expected as {
          acceptableStrategies: string[];
          maxConfidence: number;
        };

        const isAcceptable = expectedData.acceptableStrategies.includes(
          result.strategy,
        );
        const confidenceOk = result.confidence <= expectedData.maxConfidence;

        if (isAcceptable && confidenceOk) {
          return {
            score: 1.0,
            message: `✓ ${result.strategy} is acceptable with confidence ${(result.confidence * 100).toFixed(0)}%`,
          };
        }

        if (isAcceptable && !confidenceOk) {
          return {
            score: 0.7,
            message: `⚠ ${result.strategy} is acceptable but confidence too high (${(result.confidence * 100).toFixed(0)}% > ${(expectedData.maxConfidence * 100).toFixed(0)}%)`,
          };
        }

        return {
          score: 0.0,
          message: `✗ ${result.strategy} not in acceptable strategies: ${expectedData.acceptableStrategies.join(", ")}`,
        };
      },
    }),
  ],
});
