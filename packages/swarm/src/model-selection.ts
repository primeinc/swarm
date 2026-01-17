/**
 * Model Selection Module
 *
 * Determines which model a worker agent should use based on subtask
 * characteristics like file types and complexity.
 *
 * Priority:
 * 1. Explicit model field in subtask
 * 2. File-type inference (docs/tests → lite model)
 * 3. Default to primary model
 */

import type { DecomposedSubtask } from "./schemas/task";

/**
 * Configuration interface for swarm models
 */
export interface SwarmConfig {
  primaryModel: string;
  liteModel?: string;
}

/**
 * Select the appropriate model for a worker agent based on subtask characteristics
 *
 * Priority order:
 * 1. Explicit `model` field in subtask (if present)
 * 2. File-type inference:
 *    - All .md/.mdx files → liteModel
 *    - All .test./.spec. files → liteModel
 * 3. Mixed files or implementation → primaryModel
 *
 * @param subtask - The subtask to evaluate
 * @param config - Swarm configuration with model preferences
 * @returns Model identifier string
 */
export function selectWorkerModel(
  subtask: DecomposedSubtask & { model?: string },
  config: SwarmConfig,
): string {
  // Priority 1: Explicit model in subtask
  if (subtask.model) {
    return subtask.model;
  }

  const files = subtask.files || [];

  // Priority 2: File-type inference
  if (files.length > 0) {
    const allDocs = files.every((f) => {
      const lower = f.toLowerCase();
      return lower.endsWith(".md") || lower.endsWith(".mdx");
    });

    const allTests = files.every((f) => {
      const lower = f.toLowerCase();
      return lower.includes(".test.") || lower.includes(".spec.");
    });

    if (allDocs || allTests) {
      // Use lite model if configured, otherwise fall back to primary
      return config.liteModel || config.primaryModel || "anthropic/claude-haiku-4-5";
    }
  }

  // Priority 3: Default to primary model
  return config.primaryModel || "anthropic/claude-haiku-4-5";
}
