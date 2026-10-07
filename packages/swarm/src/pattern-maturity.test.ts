/**
 * Comprehensive tests for pattern-maturity.ts
 *
 * Tests behavior of maturity state transitions, decay calculations,
 * and storage operations. Focuses on observable behavior over internal state.
 */
import { describe, test, expect, beforeEach } from "vitest";
import {
  calculateDecayedCounts,
  calculateMaturityState,
  createPatternMaturity,
  updatePatternMaturity,
  promotePattern,
  deprecatePattern,
  getMaturityMultiplier,
  formatMaturityForPrompt,
  formatPatternsWithMaturityForPrompt,
  InMemoryMaturityStorage,
  type MaturityFeedback,
  type PatternMaturity,
  DEFAULT_MATURITY_CONFIG,
} from "./pattern-maturity";

// ============================================================================
// Test Fixtures
// ============================================================================

/**
 * Create a feedback event with defaults
 */
function createFeedback(
  overrides: Partial<MaturityFeedback> = {},
): MaturityFeedback {
  return {
    pattern_id: "test-pattern",
    type: "helpful",
    timestamp: new Date().toISOString(),
    weight: 1,
    ...overrides,
  };
}

/**
 * Create feedback events at specific days ago
 */
function createFeedbackAt(
  daysAgo: number,
  type: "helpful" | "harmful",
  weight = 1,
): MaturityFeedback {
  const timestamp = new Date();
  timestamp.setDate(timestamp.getDate() - daysAgo);
  return createFeedback({ type, timestamp: timestamp.toISOString(), weight });
}

// ============================================================================
// calculateDecayedCounts Tests
// ============================================================================

describe("calculateDecayedCounts", () => {
  test("returns zero counts for empty feedback", () => {
    const result = calculateDecayedCounts([]);
    expect(result).toEqual({ decayedHelpful: 0, decayedHarmful: 0 });
  });

  test("counts recent helpful feedback at full weight", () => {
    const events = [createFeedback({ type: "helpful" })];
    const result = calculateDecayedCounts(events);
    // Recent feedback should be ~1 (minor decay allowed)
    expect(result.decayedHelpful).toBeGreaterThan(0.99);
    expect(result.decayedHarmful).toBe(0);
  });

  test("counts recent harmful feedback at full weight", () => {
    const events = [createFeedback({ type: "harmful" })];
    const result = calculateDecayedCounts(events);
    expect(result.decayedHelpful).toBe(0);
    expect(result.decayedHarmful).toBeGreaterThan(0.99);
  });

  test("applies decay to old feedback", () => {
    const oldEvent = createFeedbackAt(90, "helpful"); // one half-life
    const recentEvent = createFeedbackAt(0, "helpful");

    const result = calculateDecayedCounts([oldEvent, recentEvent]);

    // 90-day old feedback should be ~0.5x (one half-life)
    // Recent feedback should be ~1.0x
    // Total should be ~1.5
    expect(result.decayedHelpful).toBeGreaterThan(1.4);
    expect(result.decayedHelpful).toBeLessThan(1.6);
  });

  test("handles mixed feedback types", () => {
    const events = [
      createFeedbackAt(0, "helpful"),
      createFeedbackAt(0, "helpful"),
      createFeedbackAt(0, "harmful"),
    ];

    const result = calculateDecayedCounts(events);
    expect(result.decayedHelpful).toBeGreaterThan(1.9);
    expect(result.decayedHarmful).toBeGreaterThan(0.99);
  });

  test("respects weight parameter", () => {
    const fullWeight = createFeedback({ type: "helpful", weight: 1 });
    const halfWeight = createFeedback({ type: "helpful", weight: 0.5 });

    const result = calculateDecayedCounts([fullWeight, halfWeight]);

    // ~1.0 + ~0.5 = ~1.5
    expect(result.decayedHelpful).toBeGreaterThan(1.4);
    expect(result.decayedHelpful).toBeLessThan(1.6);
  });

  test("uses custom config half-life", () => {
    const event = createFeedbackAt(45, "helpful"); // half of 90-day half-life
    const config = { ...DEFAULT_MATURITY_CONFIG, halfLifeDays: 45 };

    const result = calculateDecayedCounts([event], config);

    // At custom half-life, should be ~0.5
    expect(result.decayedHelpful).toBeGreaterThan(0.4);
    expect(result.decayedHelpful).toBeLessThan(0.6);
  });

  test("uses custom now parameter for decay calculation", () => {
    const event = createFeedback({
      type: "helpful",
      timestamp: "2024-01-01T00:00:00Z",
    });
    const now = new Date("2024-04-01T00:00:00Z"); // 90 days later

    const result = calculateDecayedCounts(
      [event],
      DEFAULT_MATURITY_CONFIG,
      now,
    );

    // Should be decayed by one half-life
    expect(result.decayedHelpful).toBeGreaterThan(0.4);
    expect(result.decayedHelpful).toBeLessThan(0.6);
  });
});

// ============================================================================
// calculateMaturityState Tests
// ============================================================================

describe("calculateMaturityState", () => {
  test("returns candidate with no feedback", () => {
    const state = calculateMaturityState([]);
    expect(state).toBe("candidate");
  });

  test("returns candidate with insufficient feedback", () => {
    // minFeedback = 3, so 2 events should be candidate
    const events = [
      createFeedbackAt(0, "helpful"),
      createFeedbackAt(0, "helpful"),
    ];
    const state = calculateMaturityState(events);
    expect(state).toBe("candidate");
  });

  test("returns established with enough neutral feedback", () => {
    // 3 helpful, 0 harmful = established (not enough for proven)
    const events = [
      createFeedbackAt(0, "helpful"),
      createFeedbackAt(0, "helpful"),
      createFeedbackAt(0, "helpful"),
    ];
    const state = calculateMaturityState(events);
    expect(state).toBe("established");
  });

  test("returns proven with strong positive feedback", () => {
    // minHelpful = 5, maxHarmful = 15%
    // 6 helpful, 1 harmful = 14% harmful, should be proven
    const events = [
      ...Array(6)
        .fill(null)
        .map(() => createFeedbackAt(0, "helpful")),
      createFeedbackAt(0, "harmful"),
    ];
    const state = calculateMaturityState(events);
    expect(state).toBe("proven");
  });

  test("returns deprecated with high harmful ratio", () => {
    // deprecationThreshold = 30%
    // 2 helpful, 3 harmful = 60% harmful
    const events = [
      createFeedbackAt(0, "helpful"),
      createFeedbackAt(0, "helpful"),
      createFeedbackAt(0, "harmful"),
      createFeedbackAt(0, "harmful"),
      createFeedbackAt(0, "harmful"),
    ];
    const state = calculateMaturityState(events);
    expect(state).toBe("deprecated");
  });

  test("proven requires minimum helpful count", () => {
    // 4 helpful is below minHelpful (5), even with low harmful ratio
    const events = [
      ...Array(4)
        .fill(null)
        .map(() => createFeedbackAt(0, "helpful")),
      createFeedbackAt(0, "harmful"),
    ];
    const state = calculateMaturityState(events);
    expect(state).toBe("established"); // not proven
  });

  test("proven requires low harmful ratio", () => {
    // 5 helpful, 2 harmful = 28% harmful (above maxHarmful of 15%)
    const events = [
      ...Array(5)
        .fill(null)
        .map(() => createFeedbackAt(0, "helpful")),
      createFeedbackAt(0, "harmful"),
      createFeedbackAt(0, "harmful"),
    ];
    const state = calculateMaturityState(events);
    expect(state).toBe("established"); // not proven due to harmful ratio
  });

  test("deprecation takes priority over proven", () => {
    // Even with high helpful count, high harmful ratio = deprecated
    const events = [
      ...Array(10)
        .fill(null)
        .map(() => createFeedbackAt(0, "helpful")),
      ...Array(8)
        .fill(null)
        .map(() => createFeedbackAt(0, "harmful")), // 44% harmful
    ];
    const state = calculateMaturityState(events);
    expect(state).toBe("deprecated");
  });

  test("uses custom config thresholds", () => {
    const config = {
      ...DEFAULT_MATURITY_CONFIG,
      minFeedback: 2,
      minHelpful: 3,
      maxHarmful: 0.2,
      deprecationThreshold: 0.4,
    };

    // 3 helpful, 0 harmful = proven with custom config
    const events = [
      createFeedbackAt(0, "helpful"),
      createFeedbackAt(0, "helpful"),
      createFeedbackAt(0, "helpful"),
    ];
    const state = calculateMaturityState(events, config);
    expect(state).toBe("proven");
  });

  test("accounts for decay in state calculation", () => {
    // Old helpful feedback decays, shifting ratios
    // 3 events at 180 days = 2 half-lives = ~0.25x each = ~0.75 total helpful
    // 1 event at 0 days = ~1.0x harmful
    // Total = ~1.75, harmful ratio = 1.0/1.75 = ~57%
    // BUT total < minFeedback (3), so state should be candidate
    const events = [
      createFeedbackAt(180, "helpful"), // heavily decayed (~0.25x)
      createFeedbackAt(180, "helpful"), // heavily decayed (~0.25x)
      createFeedbackAt(180, "helpful"), // heavily decayed (~0.25x)
      createFeedbackAt(0, "harmful"), // recent, full weight (~1.0x)
    ];

    const state = calculateMaturityState(events);
    // Total decayed feedback < minFeedback threshold
    expect(state).toBe("candidate");
  });
});

// ============================================================================
// createPatternMaturity Tests
// ============================================================================

describe("createPatternMaturity", () => {
  test("creates initial maturity in candidate state", () => {
    const maturity = createPatternMaturity("test-pattern");
    expect(maturity.pattern_id).toBe("test-pattern");
    expect(maturity.state).toBe("candidate");
    expect(maturity.helpful_count).toBe(0);
    expect(maturity.harmful_count).toBe(0);
  });

  test("sets last_validated timestamp", () => {
    const before = new Date();
    const maturity = createPatternMaturity("test-pattern");
    const after = new Date();

    const validated = new Date(maturity.last_validated);
    expect(validated.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(validated.getTime()).toBeLessThanOrEqual(after.getTime());
  });

  test("does not set promoted_at or deprecated_at initially", () => {
    const maturity = createPatternMaturity("test-pattern");
    expect(maturity.promoted_at).toBeUndefined();
    expect(maturity.deprecated_at).toBeUndefined();
  });
});

// ============================================================================
// updatePatternMaturity Tests
// ============================================================================

describe("updatePatternMaturity", () => {
  test("updates state based on feedback", () => {
    const maturity = createPatternMaturity("test-pattern");
    const events = [
      ...Array(6)
        .fill(null)
        .map(() => createFeedbackAt(0, "helpful")),
      createFeedbackAt(0, "harmful"),
    ];

    const updated = updatePatternMaturity(maturity, events);
    expect(updated.state).toBe("proven");
  });

  test("updates helpful and harmful counts", () => {
    const maturity = createPatternMaturity("test-pattern");
    const events = [
      createFeedbackAt(0, "helpful"),
      createFeedbackAt(0, "helpful"),
      createFeedbackAt(0, "harmful"),
    ];

    const updated = updatePatternMaturity(maturity, events);
    expect(updated.helpful_count).toBe(2);
    expect(updated.harmful_count).toBe(1);
  });

  test("sets promoted_at on first transition to proven", () => {
    const maturity = createPatternMaturity("test-pattern");
    const events = [
      ...Array(6)
        .fill(null)
        .map(() => createFeedbackAt(0, "helpful")),
    ];

    const updated = updatePatternMaturity(maturity, events);
    expect(updated.promoted_at).toBeDefined();
    expect(new Date(updated.promoted_at!).getTime()).toBeLessThanOrEqual(
      Date.now(),
    );
  });

  test("does not update promoted_at if already proven", () => {
    const maturity = createPatternMaturity("test-pattern");
    const events = [
      ...Array(6)
        .fill(null)
        .map(() => createFeedbackAt(0, "helpful")),
    ];

    const first = updatePatternMaturity(maturity, events);
    const promotedAt = first.promoted_at;

    // Add more helpful feedback
    const moreEvents = [
      ...events,
      createFeedbackAt(0, "helpful"),
      createFeedbackAt(0, "helpful"),
    ];
    const second = updatePatternMaturity(first, moreEvents);

    expect(second.promoted_at).toBe(promotedAt); // unchanged
  });

  test("sets deprecated_at on first transition to deprecated", () => {
    const maturity = createPatternMaturity("test-pattern");
    const events = [
      createFeedbackAt(0, "helpful"),
      createFeedbackAt(0, "harmful"),
      createFeedbackAt(0, "harmful"),
      createFeedbackAt(0, "harmful"),
    ];

    const updated = updatePatternMaturity(maturity, events);
    expect(updated.deprecated_at).toBeDefined();
  });

  test("does not update deprecated_at if already deprecated", () => {
    const maturity = createPatternMaturity("test-pattern");
    const events = [
      createFeedbackAt(0, "helpful"),
      createFeedbackAt(0, "harmful"),
      createFeedbackAt(0, "harmful"),
      createFeedbackAt(0, "harmful"),
    ];

    const first = updatePatternMaturity(maturity, events);
    const deprecatedAt = first.deprecated_at;

    const moreEvents = [...events, createFeedbackAt(0, "harmful")];
    const second = updatePatternMaturity(first, moreEvents);

    expect(second.deprecated_at).toBe(deprecatedAt); // unchanged
  });

  test("updates last_validated timestamp", () => {
    const maturity = createPatternMaturity("test-pattern");
    const events = [createFeedbackAt(0, "helpful")];

    const before = new Date();
    const updated = updatePatternMaturity(maturity, events);
    const after = new Date();

    const validated = new Date(updated.last_validated);
    expect(validated.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(validated.getTime()).toBeLessThanOrEqual(after.getTime());
  });

  test("handles state transitions: candidate -> established", () => {
    const maturity = createPatternMaturity("test-pattern");
    const events = [
      createFeedbackAt(0, "helpful"),
      createFeedbackAt(0, "helpful"),
      createFeedbackAt(0, "helpful"),
    ];

    const updated = updatePatternMaturity(maturity, events);
    expect(maturity.state).toBe("candidate");
    expect(updated.state).toBe("established");
  });

  test("handles state transitions: established -> proven", () => {
    let maturity = createPatternMaturity("test-pattern");
    // First get to established
    maturity = updatePatternMaturity(maturity, [
      createFeedbackAt(0, "helpful"),
      createFeedbackAt(0, "helpful"),
      createFeedbackAt(0, "helpful"),
    ]);
    expect(maturity.state).toBe("established");

    // Then add enough for proven
    const provenEvents = [
      ...Array(6)
        .fill(null)
        .map(() => createFeedbackAt(0, "helpful")),
    ];
    const updated = updatePatternMaturity(maturity, provenEvents);
    expect(updated.state).toBe("proven");
  });

  test("handles state transitions: proven -> deprecated", () => {
    let maturity = createPatternMaturity("test-pattern");
    // First get to proven
    maturity = updatePatternMaturity(maturity, [
      ...Array(6)
        .fill(null)
        .map(() => createFeedbackAt(0, "helpful")),
    ]);
    expect(maturity.state).toBe("proven");

    // Then add lots of harmful feedback
    const deprecatedEvents = [
      ...Array(6)
        .fill(null)
        .map(() => createFeedbackAt(0, "helpful")),
      ...Array(8)
        .fill(null)
        .map(() => createFeedbackAt(0, "harmful")),
    ];
    const updated = updatePatternMaturity(maturity, deprecatedEvents);
    expect(updated.state).toBe("deprecated");
  });

  test("handles empty feedback array", () => {
    const maturity = createPatternMaturity("test-pattern");
    const updated = updatePatternMaturity(maturity, []);
    expect(updated.state).toBe("candidate");
    expect(updated.helpful_count).toBe(0);
    expect(updated.harmful_count).toBe(0);
  });
});

// ============================================================================
// promotePattern Tests
// ============================================================================

describe("promotePattern", () => {
  test("promotes candidate to proven", () => {
    const maturity = createPatternMaturity("test-pattern");
    const promoted = promotePattern(maturity);
    expect(promoted.state).toBe("proven");
  });

  test("promotes established to proven", () => {
    const maturity: PatternMaturity = {
      pattern_id: "test-pattern",
      state: "established",
      helpful_count: 3,
      harmful_count: 0,
      last_validated: new Date().toISOString(),
    };
    const promoted = promotePattern(maturity);
    expect(promoted.state).toBe("proven");
  });

  test("sets promoted_at timestamp", () => {
    const maturity = createPatternMaturity("test-pattern");
    const before = new Date();
    const promoted = promotePattern(maturity);
    const after = new Date();

    expect(promoted.promoted_at).toBeDefined();
    const promotedAt = new Date(promoted.promoted_at!);
    expect(promotedAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(promotedAt.getTime()).toBeLessThanOrEqual(after.getTime());
  });

  test("updates last_validated timestamp", () => {
    const maturity = createPatternMaturity("test-pattern");
    const before = new Date();
    const promoted = promotePattern(maturity);
    const after = new Date();

    const validated = new Date(promoted.last_validated);
    expect(validated.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(validated.getTime()).toBeLessThanOrEqual(after.getTime());
  });

  test("throws error when promoting deprecated pattern", () => {
    const maturity: PatternMaturity = {
      pattern_id: "test-pattern",
      state: "deprecated",
      helpful_count: 1,
      harmful_count: 3,
      last_validated: new Date().toISOString(),
      deprecated_at: new Date().toISOString(),
    };

    expect(() => promotePattern(maturity)).toThrow(
      "Cannot promote a deprecated pattern",
    );
  });

  test("returns unchanged maturity when already proven", () => {
    const maturity: PatternMaturity = {
      pattern_id: "test-pattern",
      state: "proven",
      helpful_count: 10,
      harmful_count: 1,
      last_validated: new Date().toISOString(),
      promoted_at: "2024-01-01T00:00:00Z",
    };

    const promoted = promotePattern(maturity);
    expect(promoted).toBe(maturity); // same reference
    expect(promoted.state).toBe("proven");
  });
});

// ============================================================================
// deprecatePattern Tests
// ============================================================================

describe("deprecatePattern", () => {
  test("deprecates candidate pattern", () => {
    const maturity = createPatternMaturity("test-pattern");
    const deprecated = deprecatePattern(maturity);
    expect(deprecated.state).toBe("deprecated");
  });

  test("deprecates established pattern", () => {
    const maturity: PatternMaturity = {
      pattern_id: "test-pattern",
      state: "established",
      helpful_count: 3,
      harmful_count: 1,
      last_validated: new Date().toISOString(),
    };
    const deprecated = deprecatePattern(maturity);
    expect(deprecated.state).toBe("deprecated");
  });

  test("deprecates proven pattern", () => {
    const maturity: PatternMaturity = {
      pattern_id: "test-pattern",
      state: "proven",
      helpful_count: 10,
      harmful_count: 1,
      last_validated: new Date().toISOString(),
      promoted_at: new Date().toISOString(),
    };
    const deprecated = deprecatePattern(maturity);
    expect(deprecated.state).toBe("deprecated");
  });

  test("sets deprecated_at timestamp", () => {
    const maturity = createPatternMaturity("test-pattern");
    const before = new Date();
    const deprecated = deprecatePattern(maturity);
    const after = new Date();

    expect(deprecated.deprecated_at).toBeDefined();
    const deprecatedAt = new Date(deprecated.deprecated_at!);
    expect(deprecatedAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(deprecatedAt.getTime()).toBeLessThanOrEqual(after.getTime());
  });

  test("updates last_validated timestamp", () => {
    const maturity = createPatternMaturity("test-pattern");
    const before = new Date();
    const deprecated = deprecatePattern(maturity);
    const after = new Date();

    const validated = new Date(deprecated.last_validated);
    expect(validated.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(validated.getTime()).toBeLessThanOrEqual(after.getTime());
  });

  test("returns unchanged maturity when already deprecated", () => {
    const maturity: PatternMaturity = {
      pattern_id: "test-pattern",
      state: "deprecated",
      helpful_count: 1,
      harmful_count: 3,
      last_validated: new Date().toISOString(),
      deprecated_at: "2024-01-01T00:00:00Z",
    };

    const deprecated = deprecatePattern(maturity);
    expect(deprecated).toBe(maturity); // same reference
    expect(deprecated.state).toBe("deprecated");
  });

  test("accepts optional reason parameter", () => {
    const maturity = createPatternMaturity("test-pattern");
    // Reason is accepted but not stored (parameter prefixed with _)
    const deprecated = deprecatePattern(maturity, "test reason");
    expect(deprecated.state).toBe("deprecated");
  });
});

// ============================================================================
// getMaturityMultiplier Tests
// ============================================================================

describe("getMaturityMultiplier", () => {
  test("returns 0.5 for candidate", () => {
    expect(getMaturityMultiplier("candidate")).toBe(0.5);
  });

  test("returns 1.0 for established", () => {
    expect(getMaturityMultiplier("established")).toBe(1.0);
  });

  test("returns 1.5 for proven", () => {
    expect(getMaturityMultiplier("proven")).toBe(1.5);
  });

  test("returns 0 for deprecated", () => {
    expect(getMaturityMultiplier("deprecated")).toBe(0);
  });
});

// ============================================================================
// formatMaturityForPrompt Tests
// ============================================================================

describe("formatMaturityForPrompt", () => {
  test("shows limited data for insufficient observations", () => {
    const maturity: PatternMaturity = {
      pattern_id: "test",
      state: "candidate",
      helpful_count: 2,
      harmful_count: 0,
      last_validated: new Date().toISOString(),
    };

    const formatted = formatMaturityForPrompt(maturity);
    expect(formatted).toBe("[LIMITED DATA - 2 observations]");
  });

  test("shows singular observation for count of 1", () => {
    const maturity: PatternMaturity = {
      pattern_id: "test",
      state: "candidate",
      helpful_count: 1,
      harmful_count: 0,
      last_validated: new Date().toISOString(),
    };

    const formatted = formatMaturityForPrompt(maturity);
    expect(formatted).toBe("[LIMITED DATA - 1 observation]");
  });

  test("shows candidate with observation count when >= 3", () => {
    const maturity: PatternMaturity = {
      pattern_id: "test",
      state: "candidate",
      helpful_count: 3,
      harmful_count: 0,
      last_validated: new Date().toISOString(),
    };

    const formatted = formatMaturityForPrompt(maturity);
    expect(formatted).toBe("[CANDIDATE - 3 observations, needs more data]");
  });

  test("shows established with percentages", () => {
    const maturity: PatternMaturity = {
      pattern_id: "test",
      state: "established",
      helpful_count: 7,
      harmful_count: 3,
      last_validated: new Date().toISOString(),
    };

    const formatted = formatMaturityForPrompt(maturity);
    expect(formatted).toBe(
      "[ESTABLISHED - 70% helpful, 30% harmful from 10 observations]",
    );
  });

  test("shows proven with helpful percentage", () => {
    const maturity: PatternMaturity = {
      pattern_id: "test",
      state: "proven",
      helpful_count: 9,
      harmful_count: 1,
      last_validated: new Date().toISOString(),
      promoted_at: new Date().toISOString(),
    };

    const formatted = formatMaturityForPrompt(maturity);
    expect(formatted).toBe("[PROVEN - 90% helpful from 10 observations]");
  });

  test("shows deprecated with harmful percentage", () => {
    const maturity: PatternMaturity = {
      pattern_id: "test",
      state: "deprecated",
      helpful_count: 2,
      harmful_count: 8,
      last_validated: new Date().toISOString(),
      deprecated_at: new Date().toISOString(),
    };

    const formatted = formatMaturityForPrompt(maturity);
    expect(formatted).toBe("[DEPRECATED - 80% harmful, avoid using]");
  });

  test("rounds percentages correctly", () => {
    const maturity: PatternMaturity = {
      pattern_id: "test",
      state: "established",
      helpful_count: 2,
      harmful_count: 1,
      last_validated: new Date().toISOString(),
    };

    const formatted = formatMaturityForPrompt(maturity);
    // 2/3 = 66.666... rounds to 67%, 1/3 = 33.333... rounds to 33%
    expect(formatted).toBe(
      "[ESTABLISHED - 67% helpful, 33% harmful from 3 observations]",
    );
  });

  test("handles zero counts edge case", () => {
    const maturity: PatternMaturity = {
      pattern_id: "test",
      state: "candidate",
      helpful_count: 0,
      harmful_count: 0,
      last_validated: new Date().toISOString(),
    };

    const formatted = formatMaturityForPrompt(maturity);
    expect(formatted).toBe("[LIMITED DATA - 0 observations]");
  });
});

// ============================================================================
// formatPatternsWithMaturityForPrompt Tests
// ============================================================================

describe("formatPatternsWithMaturityForPrompt", () => {
  test("formats empty map", () => {
    const patterns = new Map<string, PatternMaturity>();
    const formatted = formatPatternsWithMaturityForPrompt(patterns);
    expect(formatted).toBe("");
  });

  test("groups patterns by maturity state", () => {
    const patterns = new Map<string, PatternMaturity>();

    patterns.set("Proven pattern", {
      pattern_id: "p1",
      state: "proven",
      helpful_count: 9,
      harmful_count: 1,
      last_validated: new Date().toISOString(),
      promoted_at: new Date().toISOString(),
    });

    patterns.set("Established pattern", {
      pattern_id: "p2",
      state: "established",
      helpful_count: 5,
      harmful_count: 2,
      last_validated: new Date().toISOString(),
    });

    patterns.set("Candidate pattern", {
      pattern_id: "p3",
      state: "candidate",
      helpful_count: 3,
      harmful_count: 0,
      last_validated: new Date().toISOString(),
    });

    patterns.set("Deprecated pattern", {
      pattern_id: "p4",
      state: "deprecated",
      helpful_count: 1,
      harmful_count: 5,
      last_validated: new Date().toISOString(),
      deprecated_at: new Date().toISOString(),
    });

    const formatted = formatPatternsWithMaturityForPrompt(patterns);

    expect(formatted).toContain("## Proven Patterns");
    expect(formatted).toContain("- Proven pattern");
    expect(formatted).toContain("## Established Patterns");
    expect(formatted).toContain("- Established pattern");
    expect(formatted).toContain("## Candidate Patterns");
    expect(formatted).toContain("- Candidate pattern");
    expect(formatted).toContain("## Deprecated Patterns");
    expect(formatted).toContain("- Deprecated pattern");
  });

  test("omits sections with no patterns", () => {
    const patterns = new Map<string, PatternMaturity>();

    patterns.set("Only proven", {
      pattern_id: "p1",
      state: "proven",
      helpful_count: 10,
      harmful_count: 0,
      last_validated: new Date().toISOString(),
      promoted_at: new Date().toISOString(),
    });

    const formatted = formatPatternsWithMaturityForPrompt(patterns);

    expect(formatted).toContain("## Proven Patterns");
    expect(formatted).not.toContain("## Established Patterns");
    expect(formatted).not.toContain("## Candidate Patterns");
    expect(formatted).not.toContain("## Deprecated Patterns");
  });

  test("includes pattern maturity labels", () => {
    const patterns = new Map<string, PatternMaturity>();

    patterns.set("Test pattern", {
      pattern_id: "p1",
      state: "proven",
      helpful_count: 9,
      harmful_count: 1,
      last_validated: new Date().toISOString(),
      promoted_at: new Date().toISOString(),
    });

    const formatted = formatPatternsWithMaturityForPrompt(patterns);
    expect(formatted).toContain("[PROVEN - 90% helpful from 10 observations]");
  });

  test("maintains multiple patterns in same section", () => {
    const patterns = new Map<string, PatternMaturity>();

    patterns.set("Pattern A", {
      pattern_id: "p1",
      state: "proven",
      helpful_count: 10,
      harmful_count: 0,
      last_validated: new Date().toISOString(),
      promoted_at: new Date().toISOString(),
    });

    patterns.set("Pattern B", {
      pattern_id: "p2",
      state: "proven",
      helpful_count: 8,
      harmful_count: 1,
      last_validated: new Date().toISOString(),
      promoted_at: new Date().toISOString(),
    });

    const formatted = formatPatternsWithMaturityForPrompt(patterns);
    expect(formatted).toContain("- Pattern A");
    expect(formatted).toContain("- Pattern B");
  });

  test("formats section headers correctly", () => {
    const patterns = new Map<string, PatternMaturity>();

    patterns.set("Test", {
      pattern_id: "p1",
      state: "deprecated",
      helpful_count: 0,
      harmful_count: 5,
      last_validated: new Date().toISOString(),
      deprecated_at: new Date().toISOString(),
    });

    const formatted = formatPatternsWithMaturityForPrompt(patterns);
    expect(formatted).toContain(
      "## Deprecated Patterns\n\nAVOID these patterns - they have poor track records:",
    );
  });
});

// ============================================================================
// InMemoryMaturityStorage Tests
// ============================================================================

describe("InMemoryMaturityStorage", () => {
  let storage: InMemoryMaturityStorage;

  beforeEach(() => {
    storage = new InMemoryMaturityStorage();
  });

  describe("store and get", () => {
    test("stores and retrieves maturity by pattern ID", async () => {
      const maturity = createPatternMaturity("test-pattern");
      await storage.store(maturity);

      const retrieved = await storage.get("test-pattern");
      expect(retrieved).toEqual(maturity);
    });

    test("returns null for non-existent pattern", async () => {
      const retrieved = await storage.get("non-existent");
      expect(retrieved).toBeNull();
    });

    test("overwrites existing maturity on store", async () => {
      const maturity1 = createPatternMaturity("test-pattern");
      await storage.store(maturity1);

      const maturity2 = { ...maturity1, helpful_count: 5 };
      await storage.store(maturity2);

      const retrieved = await storage.get("test-pattern");
      expect(retrieved?.helpful_count).toBe(5);
    });
  });

  describe("getAll", () => {
    test("returns empty array when no maturities stored", async () => {
      const all = await storage.getAll();
      expect(all).toEqual([]);
    });

    test("returns all stored maturities", async () => {
      const m1 = createPatternMaturity("pattern-1");
      const m2 = createPatternMaturity("pattern-2");
      const m3 = createPatternMaturity("pattern-3");

      await storage.store(m1);
      await storage.store(m2);
      await storage.store(m3);

      const all = await storage.getAll();
      expect(all).toHaveLength(3);
      expect(all).toContainEqual(m1);
      expect(all).toContainEqual(m2);
      expect(all).toContainEqual(m3);
    });
  });

  describe("getByState", () => {
    test("returns empty array when no patterns match state", async () => {
      const maturity = createPatternMaturity("test-pattern");
      await storage.store(maturity);

      const proven = await storage.getByState("proven");
      expect(proven).toEqual([]);
    });

    test("returns only patterns matching state", async () => {
      const candidate: PatternMaturity = {
        pattern_id: "p1",
        state: "candidate",
        helpful_count: 1,
        harmful_count: 0,
        last_validated: new Date().toISOString(),
      };

      const proven: PatternMaturity = {
        pattern_id: "p2",
        state: "proven",
        helpful_count: 10,
        harmful_count: 0,
        last_validated: new Date().toISOString(),
        promoted_at: new Date().toISOString(),
      };

      const deprecated: PatternMaturity = {
        pattern_id: "p3",
        state: "deprecated",
        helpful_count: 1,
        harmful_count: 5,
        last_validated: new Date().toISOString(),
        deprecated_at: new Date().toISOString(),
      };

      await storage.store(candidate);
      await storage.store(proven);
      await storage.store(deprecated);

      const provenResults = await storage.getByState("proven");
      expect(provenResults).toHaveLength(1);
      expect(provenResults[0]).toEqual(proven);

      const candidateResults = await storage.getByState("candidate");
      expect(candidateResults).toHaveLength(1);
      expect(candidateResults[0]).toEqual(candidate);
    });

    test("handles multiple patterns with same state", async () => {
      const p1: PatternMaturity = {
        pattern_id: "p1",
        state: "proven",
        helpful_count: 10,
        harmful_count: 0,
        last_validated: new Date().toISOString(),
        promoted_at: new Date().toISOString(),
      };

      const p2: PatternMaturity = {
        pattern_id: "p2",
        state: "proven",
        helpful_count: 8,
        harmful_count: 1,
        last_validated: new Date().toISOString(),
        promoted_at: new Date().toISOString(),
      };

      await storage.store(p1);
      await storage.store(p2);

      const proven = await storage.getByState("proven");
      expect(proven).toHaveLength(2);
    });
  });

  describe("storeFeedback and getFeedback", () => {
    test("stores and retrieves feedback for pattern", async () => {
      const feedback = createFeedback({ pattern_id: "test-pattern" });
      await storage.storeFeedback(feedback);

      const retrieved = await storage.getFeedback("test-pattern");
      expect(retrieved).toHaveLength(1);
      expect(retrieved[0]).toEqual(feedback);
    });

    test("returns empty array for pattern with no feedback", async () => {
      const feedback = await storage.getFeedback("non-existent");
      expect(feedback).toEqual([]);
    });

    test("stores multiple feedback events for same pattern", async () => {
      const f1 = createFeedback({
        pattern_id: "test-pattern",
        type: "helpful",
      });
      const f2 = createFeedback({
        pattern_id: "test-pattern",
        type: "harmful",
      });
      const f3 = createFeedback({
        pattern_id: "test-pattern",
        type: "helpful",
      });

      await storage.storeFeedback(f1);
      await storage.storeFeedback(f2);
      await storage.storeFeedback(f3);

      const retrieved = await storage.getFeedback("test-pattern");
      expect(retrieved).toHaveLength(3);
    });

    test("filters feedback by pattern ID", async () => {
      const f1 = createFeedback({ pattern_id: "pattern-1" });
      const f2 = createFeedback({ pattern_id: "pattern-2" });
      const f3 = createFeedback({ pattern_id: "pattern-1" });

      await storage.storeFeedback(f1);
      await storage.storeFeedback(f2);
      await storage.storeFeedback(f3);

      const pattern1Feedback = await storage.getFeedback("pattern-1");
      expect(pattern1Feedback).toHaveLength(2);

      const pattern2Feedback = await storage.getFeedback("pattern-2");
      expect(pattern2Feedback).toHaveLength(1);
    });

    test("preserves feedback event data", async () => {
      const feedback = createFeedback({
        pattern_id: "test-pattern",
        type: "helpful",
        weight: 0.75,
        timestamp: "2024-01-01T00:00:00Z",
      });

      await storage.storeFeedback(feedback);
      const retrieved = await storage.getFeedback("test-pattern");

      expect(retrieved[0].type).toBe("helpful");
      expect(retrieved[0].weight).toBe(0.75);
      expect(retrieved[0].timestamp).toBe("2024-01-01T00:00:00Z");
    });
  });

  describe("integration: full workflow", () => {
    test("supports complete maturity tracking workflow", async () => {
      // Create and store initial maturity
      const maturity = createPatternMaturity("test-pattern");
      await storage.store(maturity);

      // Add feedback events
      const feedback1 = createFeedback({ type: "helpful" });
      const feedback2 = createFeedback({ type: "helpful" });
      const feedback3 = createFeedback({ type: "helpful" });
      await storage.storeFeedback(feedback1);
      await storage.storeFeedback(feedback2);
      await storage.storeFeedback(feedback3);

      // Retrieve and update maturity
      const current = await storage.get("test-pattern");
      const feedbackEvents = await storage.getFeedback("test-pattern");
      const updated = updatePatternMaturity(current!, feedbackEvents);
      await storage.store(updated);

      // Verify final state
      const final = await storage.get("test-pattern");
      expect(final?.state).toBe("established");
      expect(final?.helpful_count).toBe(3);
    });
  });
});
