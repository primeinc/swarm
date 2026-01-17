/**
 * Pattern Maturity Module
 *
 * Tracks decomposition pattern maturity states through lifecycle:
 * candidate → established → proven (or deprecated)
 *
 * Patterns start as candidates until they accumulate enough feedback.
 * Strong positive feedback promotes to proven, strong negative deprecates.
 *
 * @see https://github.com/Dicklesworthstone/cass_memory_system/blob/main/src/scoring.ts#L73-L98
 */
import { z } from "zod";
import { calculateDecayedValue } from "./learning";

// ============================================================================
// Constants
// ============================================================================

/**
 * Tolerance for floating-point comparisons.
 * Used when comparing success rates to avoid floating-point precision issues.
 */
const FLOAT_EPSILON = 0.01;

// ============================================================================
// Schemas
// ============================================================================

/**
 * Maturity state for a decomposition pattern
 *
 * - candidate: Not enough feedback to judge (< minFeedback events)
 * - established: Enough feedback, neither proven nor deprecated
 * - proven: Strong positive signal (high helpful, low harmful ratio)
 * - deprecated: Strong negative signal (high harmful ratio)
 */
export const MaturityStateSchema = z.enum([
  "candidate",
  "established",
  "proven",
  "deprecated",
]);
export type MaturityState = z.infer<typeof MaturityStateSchema>;

/**
 * Pattern maturity tracking
 *
 * Tracks feedback counts and state transitions for a decomposition pattern.
 */
export const PatternMaturitySchema = z.object({
  /** Unique identifier for the pattern */
  pattern_id: z.string(),
  /** Current maturity state */
  state: MaturityStateSchema,
  /** Number of helpful feedback events */
  helpful_count: z.number().int().min(0),
  /** Number of harmful feedback events */
  harmful_count: z.number().int().min(0),
  /** When the pattern was last validated (ISO-8601) */
  last_validated: z.string(),
  /** When the pattern was promoted to proven (ISO-8601) */
  promoted_at: z.string().optional(),
  /** When the pattern was deprecated (ISO-8601) */
  deprecated_at: z.string().optional(),
});
export type PatternMaturity = z.infer<typeof PatternMaturitySchema>;

/**
 * Feedback event for maturity tracking
 */
export const MaturityFeedbackSchema = z.object({
  /** Pattern this feedback applies to */
  pattern_id: z.string(),
  /** Whether the pattern was helpful or harmful */
  type: z.enum(["helpful", "harmful"]),
  /** When this feedback was recorded (ISO-8601) */
  timestamp: z.string(),
  /** Raw weight before decay (0-1) */
  weight: z.number().min(0).max(1).default(1),
});
export type MaturityFeedback = z.infer<typeof MaturityFeedbackSchema>;

// ============================================================================
// Configuration
// ============================================================================

/**
 * Configuration for maturity calculations
 */
export interface MaturityConfig {
  /** Minimum feedback events before leaving candidate state */
  minFeedback: number;
  /** Minimum decayed helpful score to reach proven state */
  minHelpful: number;
  /** Maximum harmful ratio to reach/maintain proven state */
  maxHarmful: number;
  /** Harmful ratio threshold for deprecation */
  deprecationThreshold: number;
  /** Half-life for decay in days */
  halfLifeDays: number;
}

export const DEFAULT_MATURITY_CONFIG: MaturityConfig = {
  minFeedback: 3,
  minHelpful: 5,
  maxHarmful: 0.15, // 15% harmful is acceptable for proven
  deprecationThreshold: 0.3, // 30% harmful triggers deprecation
  halfLifeDays: 90,
};

// ============================================================================
// Core Functions
// ============================================================================

/**
 * Calculate decayed feedback counts
 *
 * Applies half-life decay to each feedback event based on age.
 *
 * @param feedbackEvents - Raw feedback events
 * @param config - Maturity configuration
 * @param now - Current timestamp for decay calculation
 * @returns Decayed helpful and harmful totals
 */
export function calculateDecayedCounts(
  feedbackEvents: MaturityFeedback[],
  config: MaturityConfig = DEFAULT_MATURITY_CONFIG,
  now: Date = new Date(),
): { decayedHelpful: number; decayedHarmful: number } {
  let decayedHelpful = 0;
  let decayedHarmful = 0;

  for (const event of feedbackEvents) {
    const decay = calculateDecayedValue(
      event.timestamp,
      now,
      config.halfLifeDays,
    );
    const value = event.weight * decay;

    if (event.type === "helpful") {
      decayedHelpful += value;
    } else {
      decayedHarmful += value;
    }
  }

  return { decayedHelpful, decayedHarmful };
}

/**
 * Calculate maturity state from feedback events
 *
 * State determination logic:
 * 1. "deprecated" if harmful ratio > 0.3 AND total >= minFeedback
 * 2. "candidate" if total < minFeedback (not enough data)
 * 3. "proven" if decayedHelpful >= minHelpful AND harmfulRatio < maxHarmful
 * 4. "established" otherwise (enough data but not yet proven)
 *
 * @param feedbackEvents - Feedback events for this pattern
 * @param config - Maturity configuration
 * @param now - Current timestamp for decay calculation
 * @returns Calculated maturity state
 */
export function calculateMaturityState(
  feedbackEvents: MaturityFeedback[],
  config: MaturityConfig = DEFAULT_MATURITY_CONFIG,
  now: Date = new Date(),
): MaturityState {
  const { decayedHelpful, decayedHarmful } = calculateDecayedCounts(
    feedbackEvents,
    config,
    now,
  );

  const total = decayedHelpful + decayedHarmful;
  // Use FLOAT_EPSILON constant (defined at module level)
  const safeTotal = total > FLOAT_EPSILON ? total : 0;
  const harmfulRatio = safeTotal > 0 ? decayedHarmful / safeTotal : 0;

  // Deprecated: high harmful ratio with enough feedback
  if (
    harmfulRatio > config.deprecationThreshold &&
    safeTotal >= config.minFeedback - FLOAT_EPSILON
  ) {
    return "deprecated";
  }

  // Candidate: not enough feedback yet
  if (safeTotal < config.minFeedback - FLOAT_EPSILON) {
    return "candidate";
  }

  // Proven: strong positive signal
  if (
    decayedHelpful >= config.minHelpful - FLOAT_EPSILON &&
    harmfulRatio < config.maxHarmful
  ) {
    return "proven";
  }

  // Established: enough data but not proven
  return "established";
}

/**
 * Create initial pattern maturity record
 *
 * @param patternId - Unique pattern identifier
 * @returns New PatternMaturity in candidate state
 */
export function createPatternMaturity(patternId: string): PatternMaturity {
  return {
    pattern_id: patternId,
    state: "candidate",
    helpful_count: 0,
    harmful_count: 0,
    last_validated: new Date().toISOString(),
  };
}

/**
 * Update pattern maturity with new feedback.
 *
 * Side Effects:
 * - Sets `promoted_at` timestamp on first entry into 'proven' status
 * - Sets `deprecated_at` timestamp on first entry into 'deprecated' status
 * - Updates `helpful_count` and `harmful_count` based on feedback events
 * - Recalculates `state` based on decayed feedback counts
 *
 * State Transitions:
 * - candidate → established: After minFeedback observations (default 3)
 * - established → proven: When decayedHelpful >= minHelpful (5) AND harmfulRatio < maxHarmful (15%)
 * - any → deprecated: When harmfulRatio > deprecationThreshold (30%) AND total >= minFeedback
 *
 * @param maturity - Current maturity record
 * @param feedbackEvents - All feedback events for this pattern
 * @param config - Maturity configuration
 * @returns Updated maturity record with new state
 */
export function updatePatternMaturity(
  maturity: PatternMaturity,
  feedbackEvents: MaturityFeedback[],
  config: MaturityConfig = DEFAULT_MATURITY_CONFIG,
): PatternMaturity {
  const now = new Date();
  const newState = calculateMaturityState(feedbackEvents, config, now);

  // Count raw feedback (not decayed)
  const helpfulCount = feedbackEvents.filter(
    (e) => e.type === "helpful",
  ).length;
  const harmfulCount = feedbackEvents.filter(
    (e) => e.type === "harmful",
  ).length;

  const updated: PatternMaturity = {
    ...maturity,
    state: newState,
    helpful_count: helpfulCount,
    harmful_count: harmfulCount,
    last_validated: now.toISOString(),
  };

  // Track state transitions
  if (newState === "proven" && maturity.state !== "proven") {
    updated.promoted_at = now.toISOString();
  }
  if (newState === "deprecated" && maturity.state !== "deprecated") {
    updated.deprecated_at = now.toISOString();
  }

  return updated;
}

/**
 * Promote a pattern to proven state
 *
 * Manually promotes a pattern regardless of feedback counts.
 * Use when external validation confirms pattern effectiveness.
 *
 * @param maturity - Current maturity record
 * @returns Updated maturity record with proven state
 */
export function promotePattern(maturity: PatternMaturity): PatternMaturity {
  if (maturity.state === "deprecated") {
    throw new Error("Cannot promote a deprecated pattern");
  }

  if (maturity.state === "proven") {
    console.warn(
      `[PatternMaturity] Pattern already proven: ${maturity.pattern_id}`,
    );
    return maturity; // No-op but warn
  }

  if (maturity.state === "candidate" && maturity.helpful_count < 3) {
    console.warn(
      `[PatternMaturity] Promoting candidate with insufficient data: ${maturity.pattern_id} (${maturity.helpful_count} helpful observations)`,
    );
  }

  const now = new Date().toISOString();
  return {
    ...maturity,
    state: "proven",
    promoted_at: now,
    last_validated: now,
  };
}

/**
 * Deprecate a pattern
 *
 * Manually deprecates a pattern regardless of feedback counts.
 * Use when external validation shows pattern is harmful.
 *
 * @param maturity - Current maturity record
 * @param reason - Optional reason for deprecation
 * @returns Updated maturity record with deprecated state
 */
export function deprecatePattern(
  maturity: PatternMaturity,
  _reason?: string,
): PatternMaturity {
  if (maturity.state === "deprecated") {
    return maturity; // Already deprecated
  }

  const now = new Date().toISOString();
  return {
    ...maturity,
    state: "deprecated",
    deprecated_at: now,
    last_validated: now,
  };
}

/**
 * Get weight multiplier based on pattern maturity status.
 *
 * Multipliers chosen to:
 * - Heavily penalize deprecated patterns (0x) - never recommend
 * - Slightly boost proven patterns (1.5x) - reward validated success
 * - Penalize unvalidated candidates (0.5x) - reduce impact until proven
 * - Neutral for established (1.0x) - baseline weight
 *
 * @param state - Pattern maturity status
 * @returns Multiplier to apply to pattern weight
 */
export function getMaturityMultiplier(state: MaturityState): number {
  const multipliers: Record<MaturityState, number> = {
    candidate: 0.5,
    established: 1.0,
    proven: 1.5,
    deprecated: 0,
  };
  return multipliers[state];
}

/**
 * Format maturity state for inclusion in prompts
 *
 * Shows pattern reliability to help agents make informed decisions.
 *
 * @param maturity - Pattern maturity record
 * @returns Formatted string describing pattern reliability
 */
export function formatMaturityForPrompt(maturity: PatternMaturity): string {
  const total = maturity.helpful_count + maturity.harmful_count;

  // Don't show percentages for insufficient data
  if (total < 3) {
    return `[LIMITED DATA - ${total} observation${total !== 1 ? "s" : ""}]`;
  }

  const harmfulRatio =
    total > 0 ? Math.round((maturity.harmful_count / total) * 100) : 0;
  const helpfulRatio =
    total > 0 ? Math.round((maturity.helpful_count / total) * 100) : 0;

  switch (maturity.state) {
    case "candidate":
      return `[CANDIDATE - ${total} observations, needs more data]`;
    case "established":
      return `[ESTABLISHED - ${helpfulRatio}% helpful, ${harmfulRatio}% harmful from ${total} observations]`;
    case "proven":
      return `[PROVEN - ${helpfulRatio}% helpful from ${total} observations]`;
    case "deprecated":
      return `[DEPRECATED - ${harmfulRatio}% harmful, avoid using]`;
  }
}

/**
 * Format multiple patterns with maturity for prompt inclusion
 *
 * Groups patterns by maturity state for clear presentation.
 *
 * @param patterns - Map of pattern content to maturity record
 * @returns Formatted string for prompt inclusion
 */
export function formatPatternsWithMaturityForPrompt(
  patterns: Map<string, PatternMaturity>,
): string {
  const proven: string[] = [];
  const established: string[] = [];
  const candidates: string[] = [];
  const deprecated: string[] = [];

  for (const [content, maturity] of patterns) {
    const formatted = `- ${content} ${formatMaturityForPrompt(maturity)}`;
    switch (maturity.state) {
      case "proven":
        proven.push(formatted);
        break;
      case "established":
        established.push(formatted);
        break;
      case "candidate":
        candidates.push(formatted);
        break;
      case "deprecated":
        deprecated.push(formatted);
        break;
    }
  }

  const sections: string[] = [];

  if (proven.length > 0) {
    sections.push(
      "## Proven Patterns\n\nThese patterns consistently work well:\n\n" +
        proven.join("\n"),
    );
  }

  if (established.length > 0) {
    sections.push(
      "## Established Patterns\n\nThese patterns have track records:\n\n" +
        established.join("\n"),
    );
  }

  if (candidates.length > 0) {
    sections.push(
      "## Candidate Patterns\n\nThese patterns need more validation:\n\n" +
        candidates.join("\n"),
    );
  }

  if (deprecated.length > 0) {
    sections.push(
      "## Deprecated Patterns\n\nAVOID these patterns - they have poor track records:\n\n" +
        deprecated.join("\n"),
    );
  }

  return sections.join("\n\n");
}

// ============================================================================
// Storage
// ============================================================================

/**
 * Storage interface for pattern maturity records
 */
export interface MaturityStorage {
  /** Store or update a maturity record */
  store(maturity: PatternMaturity): Promise<void>;
  /** Get maturity record by pattern ID */
  get(patternId: string): Promise<PatternMaturity | null>;
  /** Get all maturity records */
  getAll(): Promise<PatternMaturity[]>;
  /** Get patterns by state */
  getByState(state: MaturityState): Promise<PatternMaturity[]>;
  /** Store a feedback event */
  storeFeedback(feedback: MaturityFeedback): Promise<void>;
  /** Get all feedback for a pattern */
  getFeedback(patternId: string): Promise<MaturityFeedback[]>;
}

/**
 * In-memory maturity storage (for testing and short-lived sessions)
 */
export class InMemoryMaturityStorage implements MaturityStorage {
  private maturities: Map<string, PatternMaturity> = new Map();
  private feedback: MaturityFeedback[] = [];

  async store(maturity: PatternMaturity): Promise<void> {
    this.maturities.set(maturity.pattern_id, maturity);
  }

  async get(patternId: string): Promise<PatternMaturity | null> {
    return this.maturities.get(patternId) ?? null;
  }

  async getAll(): Promise<PatternMaturity[]> {
    return Array.from(this.maturities.values());
  }

  async getByState(state: MaturityState): Promise<PatternMaturity[]> {
    return Array.from(this.maturities.values()).filter(
      (m) => m.state === state,
    );
  }

  async storeFeedback(feedback: MaturityFeedback): Promise<void> {
    this.feedback.push(feedback);
  }

  async getFeedback(patternId: string): Promise<MaturityFeedback[]> {
    return this.feedback.filter((f) => f.pattern_id === patternId);
  }
}

// ============================================================================
// Exports
// ============================================================================

export const maturitySchemas = {
  MaturityStateSchema,
  PatternMaturitySchema,
  MaturityFeedbackSchema,
};
