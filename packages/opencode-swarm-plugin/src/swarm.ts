/**
 * Swarm Module - High-level swarm coordination
 *
 * This module re-exports from focused submodules for backward compatibility.
 * For new code, prefer importing from specific modules:
 * - swarm-strategies.ts - Strategy selection
 * - swarm-decompose.ts - Task decomposition
 * - swarm-prompts.ts - Prompt templates
 * - swarm-orchestrate.ts - Status and completion
 *
 * @module swarm
 */

// Re-export everything for backward compatibility
export * from "./swarm-strategies";
export * from "./swarm-decompose";
export * from "./swarm-prompts";
export * from "./swarm-orchestrate";
export * from "./swarm-research";
export * from "./swarm-adversarial-review";

// Import tools from each module
import { decomposeTools } from "./swarm-decompose";
import { orchestrateTools } from "./swarm-orchestrate";
import { promptTools } from "./swarm-prompts";
import { researchTools } from "./swarm-research";
import { strategyTools } from "./swarm-strategies";
import { adversarialReviewTools } from "./swarm-adversarial-review";

/**
 * Combined swarm tools for plugin registration.
 * Includes all tools from strategy, decompose, prompt, orchestrate, research, and adversarial-review modules.
 */
export const swarmTools: Record<string, ReturnType<typeof import("@opencode-ai/plugin").tool>> = {
  ...strategyTools,
  ...decomposeTools,
  ...promptTools,
  ...orchestrateTools,
  ...researchTools,
  ...adversarialReviewTools,
};
