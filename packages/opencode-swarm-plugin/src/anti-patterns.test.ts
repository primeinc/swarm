/**
 * Tests for anti-pattern learning module
 */
import { describe, expect, it } from "vitest";
import {
  DEFAULT_ANTI_PATTERN_CONFIG,
  DecompositionPatternSchema,
  InMemoryPatternStorage,
  PatternInversionResultSchema,
  PatternKindSchema,
  createPattern,
  extractPatternsFromDescription,
  formatAntiPatternsForPrompt,
  formatSuccessfulPatternsForPrompt,
  invertToAntiPattern,
  recordPatternObservation,
  shouldInvertPattern,
  type AntiPatternConfig,
  type DecompositionPattern,
} from "./anti-patterns";

// ============================================================================
// Schema Validation Tests
// ============================================================================

describe("PatternKindSchema", () => {
  it("validates 'pattern' kind", () => {
    expect(() => PatternKindSchema.parse("pattern")).not.toThrow();
  });

  it("validates 'anti_pattern' kind", () => {
    expect(() => PatternKindSchema.parse("anti_pattern")).not.toThrow();
  });

  it("rejects invalid kind", () => {
    expect(() => PatternKindSchema.parse("invalid")).toThrow();
  });
});

describe("DecompositionPatternSchema", () => {
  it("validates a complete valid pattern", () => {
    const pattern = {
      id: "pattern-123",
      content: "Split by file type",
      kind: "pattern",
      is_negative: false,
      success_count: 5,
      failure_count: 2,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      example_cells: ["bd-123", "bd-456"],
      tags: ["file-splitting"],
      reason: "Test pattern",
    };
    expect(() => DecompositionPatternSchema.parse(pattern)).not.toThrow();
  });

  it("validates a valid anti-pattern", () => {
    const antiPattern = {
      id: "anti-pattern-123",
      content: "AVOID: Split by file type",
      kind: "anti_pattern",
      is_negative: true,
      success_count: 2,
      failure_count: 8,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      example_cells: [],
      tags: [],
    };
    expect(() => DecompositionPatternSchema.parse(antiPattern)).not.toThrow();
  });

  it("applies default values for optional fields", () => {
    const minimal = {
      id: "pattern-minimal",
      content: "Test pattern",
      kind: "pattern",
      is_negative: false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    const parsed = DecompositionPatternSchema.parse(minimal);
    expect(parsed.success_count).toBe(0);
    expect(parsed.failure_count).toBe(0);
    expect(parsed.tags).toEqual([]);
    expect(parsed.example_cells).toEqual([]);
  });

  it("rejects negative success_count", () => {
    const pattern = {
      id: "pattern-invalid",
      content: "Test",
      kind: "pattern",
      is_negative: false,
      success_count: -1,
      failure_count: 0,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    expect(() => DecompositionPatternSchema.parse(pattern)).toThrow();
  });

  it("rejects negative failure_count", () => {
    const pattern = {
      id: "pattern-invalid",
      content: "Test",
      kind: "pattern",
      is_negative: false,
      success_count: 0,
      failure_count: -1,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    expect(() => DecompositionPatternSchema.parse(pattern)).toThrow();
  });

  it("rejects invalid kind", () => {
    const pattern = {
      id: "pattern-invalid",
      content: "Test",
      kind: "invalid_kind",
      is_negative: false,
      success_count: 0,
      failure_count: 0,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    expect(() => DecompositionPatternSchema.parse(pattern)).toThrow();
  });
});

describe("PatternInversionResultSchema", () => {
  it("validates a complete inversion result", () => {
    const now = new Date().toISOString();
    const result = {
      original: {
        id: "pattern-123",
        content: "Split by file type",
        kind: "pattern",
        is_negative: false,
        success_count: 2,
        failure_count: 8,
        created_at: now,
        updated_at: now,
        tags: [],
        example_cells: [],
      },
      inverted: {
        id: "anti-pattern-123",
        content: "AVOID: Split by file type",
        kind: "anti_pattern",
        is_negative: true,
        success_count: 2,
        failure_count: 8,
        created_at: now,
        updated_at: now,
        tags: [],
        example_cells: [],
      },
      reason: "Failed 8/10 times (80% failure rate)",
    };
    expect(() => PatternInversionResultSchema.parse(result)).not.toThrow();
  });
});

// ============================================================================
// shouldInvertPattern Tests
// ============================================================================

describe("shouldInvertPattern", () => {
  const basePattern: DecompositionPattern = {
    id: "pattern-test",
    content: "Test pattern",
    kind: "pattern",
    is_negative: false,
    success_count: 0,
    failure_count: 0,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    tags: [],
    example_cells: [],
  };

  it("returns true when failure rate exceeds 60%", () => {
    const pattern = {
      ...basePattern,
      success_count: 3,
      failure_count: 7, // 70% failure rate
    };
    expect(shouldInvertPattern(pattern)).toBe(true);
  });

  it("returns true when failure rate equals 60%", () => {
    const pattern = {
      ...basePattern,
      success_count: 4,
      failure_count: 6, // Exactly 60% failure rate
    };
    expect(shouldInvertPattern(pattern)).toBe(true);
  });

  it("returns false when failure rate is below 60%", () => {
    const pattern = {
      ...basePattern,
      success_count: 6,
      failure_count: 4, // 40% failure rate
    };
    expect(shouldInvertPattern(pattern)).toBe(false);
  });

  it("returns false when failure rate is just below threshold", () => {
    const pattern = {
      ...basePattern,
      success_count: 41,
      failure_count: 59, // 59% failure rate (just below 60%)
    };
    expect(shouldInvertPattern(pattern)).toBe(false);
  });

  it("returns false with insufficient observations (< minObservations)", () => {
    const pattern = {
      ...basePattern,
      success_count: 0,
      failure_count: 2, // Only 2 observations, need 3
    };
    expect(shouldInvertPattern(pattern)).toBe(false);
  });

  it("returns false when exactly at minObservations but low failure rate", () => {
    const pattern = {
      ...basePattern,
      success_count: 2,
      failure_count: 1, // Exactly 3 observations, 33% failure
    };
    expect(shouldInvertPattern(pattern)).toBe(false);
  });

  it("returns true when at minObservations with high failure rate", () => {
    const pattern = {
      ...basePattern,
      success_count: 1,
      failure_count: 2, // Exactly 3 observations, 67% failure
    };
    expect(shouldInvertPattern(pattern)).toBe(true);
  });

  it("returns false when already an anti-pattern", () => {
    const antiPattern = {
      ...basePattern,
      kind: "anti_pattern" as const,
      is_negative: true,
      success_count: 0,
      failure_count: 10, // 100% failure but already anti-pattern
    };
    expect(shouldInvertPattern(antiPattern)).toBe(false);
  });

  it("returns false with zero observations", () => {
    const pattern = {
      ...basePattern,
      success_count: 0,
      failure_count: 0,
    };
    expect(shouldInvertPattern(pattern)).toBe(false);
  });

  it("respects custom config minObservations", () => {
    const pattern = {
      ...basePattern,
      success_count: 1,
      failure_count: 4, // 80% failure
    };
    const config: AntiPatternConfig = {
      ...DEFAULT_ANTI_PATTERN_CONFIG,
      minObservations: 5,
    };
    expect(shouldInvertPattern(pattern, config)).toBe(true);
  });

  it("respects custom config failureRatioThreshold", () => {
    const pattern = {
      ...basePattern,
      success_count: 3,
      failure_count: 7, // 70% failure
    };
    const config: AntiPatternConfig = {
      ...DEFAULT_ANTI_PATTERN_CONFIG,
      failureRatioThreshold: 0.8, // Need 80% failure
    };
    expect(shouldInvertPattern(pattern, config)).toBe(false);
  });
});

// ============================================================================
// invertToAntiPattern Tests
// ============================================================================

describe("invertToAntiPattern", () => {
  const basePattern: DecompositionPattern = {
    id: "pattern-123",
    content: "Split by file type",
    kind: "pattern",
    is_negative: false,
    success_count: 2,
    failure_count: 8,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    tags: ["file-splitting"],
    example_cells: ["bd-123", "bd-456"],
  };

  it("converts pattern to anti-pattern with correct kind", () => {
    const result = invertToAntiPattern(basePattern, "Test reason");
    expect(result.inverted.kind).toBe("anti_pattern");
    expect(result.inverted.is_negative).toBe(true);
  });

  it("prefixes content with AVOID:", () => {
    const result = invertToAntiPattern(basePattern, "Test reason");
    expect(result.inverted.content).toContain("AVOID:");
    expect(result.inverted.content).toContain("Split by file type");
  });

  it("appends reason to content", () => {
    const result = invertToAntiPattern(basePattern, "Failed too many times");
    expect(result.inverted.content).toContain("Failed too many times");
  });

  it("preserves success and failure counts", () => {
    const result = invertToAntiPattern(basePattern, "Test");
    expect(result.inverted.success_count).toBe(basePattern.success_count);
    expect(result.inverted.failure_count).toBe(basePattern.failure_count);
  });

  it("preserves example_cells", () => {
    const result = invertToAntiPattern(basePattern, "Test");
    expect(result.inverted.example_cells).toEqual(["bd-123", "bd-456"]);
  });

  it("preserves tags", () => {
    const result = invertToAntiPattern(basePattern, "Test");
    expect(result.inverted.tags).toEqual(["file-splitting"]);
  });

  it("generates new ID with 'anti-' prefix", () => {
    const result = invertToAntiPattern(basePattern, "Test");
    expect(result.inverted.id).toBe("anti-pattern-123");
  });

  it("stores reason in inverted pattern", () => {
    const result = invertToAntiPattern(basePattern, "Custom reason");
    expect(result.inverted.reason).toBe("Custom reason");
  });

  it("updates updated_at timestamp", () => {
    const before = new Date();
    const result = invertToAntiPattern(basePattern, "Test");
    const after = new Date();
    const updatedAt = new Date(result.inverted.updated_at);
    expect(updatedAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(updatedAt.getTime()).toBeLessThanOrEqual(after.getTime());
  });

  it("returns original pattern in result", () => {
    const result = invertToAntiPattern(basePattern, "Test");
    expect(result.original).toEqual(basePattern);
  });

  it("returns reason in result", () => {
    const result = invertToAntiPattern(basePattern, "Test reason");
    expect(result.reason).toBe("Test reason");
  });

  it("cleans existing AVOID: prefix", () => {
    const pattern = {
      ...basePattern,
      content: "AVOID: Split by file type",
    };
    const result = invertToAntiPattern(pattern, "Test");
    // Should not have double prefix
    expect(result.inverted.content).toMatch(/^AVOID: Split by file type\./);
    expect(result.inverted.content).not.toMatch(/AVOID:.*AVOID:/);
  });

  it("cleans existing DO NOT: prefix", () => {
    const pattern = {
      ...basePattern,
      content: "DO NOT: Split by file type",
    };
    const result = invertToAntiPattern(pattern, "Test");
    expect(result.inverted.content).toMatch(/^AVOID: Split by file type\./);
  });

  it("cleans existing NEVER: prefix", () => {
    const pattern = {
      ...basePattern,
      content: "NEVER: Split by file type",
    };
    const result = invertToAntiPattern(pattern, "Test");
    expect(result.inverted.content).toMatch(/^AVOID: Split by file type\./);
  });

  it("respects custom antiPatternPrefix", () => {
    const config: AntiPatternConfig = {
      ...DEFAULT_ANTI_PATTERN_CONFIG,
      antiPatternPrefix: "DO NOT: ",
    };
    const result = invertToAntiPattern(basePattern, "Test", config);
    expect(result.inverted.content).toContain("DO NOT:");
  });
});

// ============================================================================
// recordPatternObservation Tests
// ============================================================================

describe("recordPatternObservation", () => {
  const basePattern: DecompositionPattern = {
    id: "pattern-test",
    content: "Test pattern",
    kind: "pattern",
    is_negative: false,
    success_count: 5,
    failure_count: 2,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    tags: [],
    example_cells: [],
  };

  it("increments success count on success", () => {
    const result = recordPatternObservation(basePattern, true);
    expect(result.pattern.success_count).toBe(6);
    expect(result.pattern.failure_count).toBe(2);
  });

  it("increments failure count on failure", () => {
    const result = recordPatternObservation(basePattern, false);
    expect(result.pattern.success_count).toBe(5);
    expect(result.pattern.failure_count).toBe(3);
  });

  it("adds cell to example_cells when provided", () => {
    const result = recordPatternObservation(basePattern, true, "bd-789");
    expect(result.pattern.example_cells).toContain("bd-789");
  });

  it("does not modify example_cells when cellId not provided", () => {
    const result = recordPatternObservation(basePattern, true);
    expect(result.pattern.example_cells).toEqual([]);
  });

  it("limits example_cells to MAX_EXAMPLE_cellS (10)", () => {
    const pattern = {
      ...basePattern,
      example_cells: Array(10)
        .fill(0)
        .map((_, i) => `bd-${i}`),
    };
    const result = recordPatternObservation(pattern, true, "bd-new");
    expect(result.pattern.example_cells.length).toBe(10);
    expect(result.pattern.example_cells).toContain("bd-new");
    expect(result.pattern.example_cells).not.toContain("bd-0"); // Oldest removed
  });

  it("keeps newest cells when trimming example_cells", () => {
    const pattern = {
      ...basePattern,
      example_cells: [
        "bd-1",
        "bd-2",
        "bd-3",
        "bd-4",
        "bd-5",
        "bd-6",
        "bd-7",
        "bd-8",
        "bd-9",
        "bd-10",
      ],
    };
    const result = recordPatternObservation(pattern, true, "bd-new");
    expect(result.pattern.example_cells[0]).toBe("bd-2"); // First one removed
    expect(result.pattern.example_cells[9]).toBe("bd-new"); // New one added
  });

  it("updates updated_at timestamp", () => {
    const before = new Date();
    const result = recordPatternObservation(basePattern, true);
    const after = new Date();
    const updatedAt = new Date(result.pattern.updated_at);
    expect(updatedAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(updatedAt.getTime()).toBeLessThanOrEqual(after.getTime());
  });

  it("does not invert when below threshold", () => {
    const result = recordPatternObservation(basePattern, false); // 5 success, 3 failure = 37.5%
    expect(result.inversion).toBeUndefined();
  });

  it("inverts when crossing threshold", () => {
    const pattern = {
      ...basePattern,
      success_count: 2,
      failure_count: 4, // Currently 66% failure
    };
    const result = recordPatternObservation(pattern, false); // Now 2/7 = 71% failure
    expect(result.inversion).toBeDefined();
    if (result.inversion) {
      expect(result.inversion.inverted.kind).toBe("anti_pattern");
    }
  });

  it("includes failure statistics in inversion reason", () => {
    const pattern = {
      ...basePattern,
      success_count: 3,
      failure_count: 6, // 66% failure
    };
    const result = recordPatternObservation(pattern, false); // 70% failure
    expect(result.inversion).toBeDefined();
    if (result.inversion) {
      expect(result.inversion.reason).toContain("7/10");
      expect(result.inversion.reason).toContain("70%");
    }
  });

  it("does not invert already-inverted anti-patterns", () => {
    const antiPattern: DecompositionPattern = {
      ...basePattern,
      kind: "anti_pattern",
      is_negative: true,
      success_count: 0,
      failure_count: 10,
    };
    const result = recordPatternObservation(antiPattern, false);
    expect(result.inversion).toBeUndefined();
  });

  it("respects custom config for inversion", () => {
    const pattern = {
      ...basePattern,
      success_count: 2,
      failure_count: 3, // 60% failure
    };
    const config: AntiPatternConfig = {
      ...DEFAULT_ANTI_PATTERN_CONFIG,
      failureRatioThreshold: 0.7, // Need 70%
    };
    const result = recordPatternObservation(pattern, false, undefined, config);
    expect(result.inversion).toBeUndefined(); // 66% not enough
  });

  it("preserves original pattern fields", () => {
    const result = recordPatternObservation(basePattern, true);
    expect(result.pattern.id).toBe(basePattern.id);
    expect(result.pattern.content).toBe(basePattern.content);
    expect(result.pattern.kind).toBe(basePattern.kind);
    expect(result.pattern.tags).toEqual(basePattern.tags);
  });
});

// ============================================================================
// extractPatternsFromDescription Tests
// ============================================================================

describe("extractPatternsFromDescription", () => {
  it("detects 'split by file type' pattern", () => {
    const patterns = extractPatternsFromDescription("Split by file type");
    expect(patterns).toContain("Split by file type");
  });

  it("detects 'splitting by file type' variant", () => {
    const patterns = extractPatternsFromDescription("Splitting by file type");
    expect(patterns).toContain("Split by file type");
  });

  it("detects 'split by component' pattern", () => {
    const patterns = extractPatternsFromDescription("Split by component");
    expect(patterns).toContain("Split by component");
  });

  it("detects 'split by layer' pattern", () => {
    const patterns = extractPatternsFromDescription("Split by layer");
    expect(patterns).toContain("Split by layer (UI/logic/data)");
  });

  it("detects 'split by feature' pattern", () => {
    const patterns = extractPatternsFromDescription("Split by feature");
    expect(patterns).toContain("Split by feature");
  });

  it("detects 'one file per task' pattern", () => {
    const patterns = extractPatternsFromDescription("One file per task");
    expect(patterns).toContain("One file per subtask");
  });

  it("detects 'shared types first' pattern", () => {
    const patterns = extractPatternsFromDescription("shared types first");
    expect(patterns).toContain("Handle shared types first");
  });

  it("detects 'API routes separate' pattern", () => {
    const patterns = extractPatternsFromDescription("API routes separate");
    expect(patterns).toContain("Separate API routes");
  });

  it("detects 'tests with code' pattern", () => {
    const patterns = extractPatternsFromDescription("tests with code");
    expect(patterns).toContain("Tests alongside implementation");
  });

  it("detects 'tests in separate subtask' pattern", () => {
    const patterns = extractPatternsFromDescription(
      "tests in separate subtask",
    );
    expect(patterns).toContain("Tests in separate subtask");
  });

  it("detects 'parallelize all' pattern", () => {
    const patterns = extractPatternsFromDescription("Parallelize everything");
    expect(patterns).toContain("Maximize parallelization");
  });

  it("detects 'sequential order' pattern", () => {
    const patterns = extractPatternsFromDescription("Sequential execution");
    expect(patterns).toContain("Sequential execution order");
  });

  it("detects 'dependency chain' pattern", () => {
    const patterns = extractPatternsFromDescription("dependency chain");
    expect(patterns).toContain("Respect dependency chain");
  });

  it("returns empty array for unrecognized descriptions", () => {
    const patterns = extractPatternsFromDescription("random gibberish text");
    expect(patterns).toEqual([]);
  });

  it("detects multiple patterns in one description", () => {
    const patterns = extractPatternsFromDescription(
      "Split by file type and handle shared types first",
    );
    expect(patterns).toContain("Split by file type");
    expect(patterns).toContain("Handle shared types first");
    expect(patterns.length).toBeGreaterThanOrEqual(2);
  });

  it("is case-insensitive", () => {
    const patterns = extractPatternsFromDescription("SPLIT BY FILE TYPE");
    expect(patterns).toContain("Split by file type");
  });

  it("handles partial matches in longer sentences", () => {
    const patterns = extractPatternsFromDescription(
      "We should split by component for this refactor",
    );
    expect(patterns).toContain("Split by component");
  });
});

// ============================================================================
// createPattern Tests
// ============================================================================

describe("createPattern", () => {
  it("creates pattern with provided content", () => {
    const pattern = createPattern("Test pattern");
    expect(pattern.content).toBe("Test pattern");
  });

  it("creates pattern with kind='pattern'", () => {
    const pattern = createPattern("Test");
    expect(pattern.kind).toBe("pattern");
  });

  it("creates pattern with is_negative=false", () => {
    const pattern = createPattern("Test");
    expect(pattern.is_negative).toBe(false);
  });

  it("initializes counts to zero", () => {
    const pattern = createPattern("Test");
    expect(pattern.success_count).toBe(0);
    expect(pattern.failure_count).toBe(0);
  });

  it("includes provided tags", () => {
    const pattern = createPattern("Test", ["tag1", "tag2"]);
    expect(pattern.tags).toEqual(["tag1", "tag2"]);
  });

  it("defaults to empty tags array", () => {
    const pattern = createPattern("Test");
    expect(pattern.tags).toEqual([]);
  });

  it("generates unique ID", () => {
    const p1 = createPattern("Test");
    const p2 = createPattern("Test");
    expect(p1.id).not.toBe(p2.id);
  });

  it("sets created_at timestamp", () => {
    const before = new Date();
    const pattern = createPattern("Test");
    const after = new Date();
    const createdAt = new Date(pattern.created_at);
    expect(createdAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(createdAt.getTime()).toBeLessThanOrEqual(after.getTime());
  });

  it("sets updated_at equal to created_at", () => {
    const pattern = createPattern("Test");
    expect(pattern.updated_at).toBe(pattern.created_at);
  });

  it("initializes example_cells to empty array", () => {
    const pattern = createPattern("Test");
    expect(pattern.example_cells).toEqual([]);
  });
});

// ============================================================================
// formatAntiPatternsForPrompt Tests
// ============================================================================

describe("formatAntiPatternsForPrompt", () => {
  it("formats anti-patterns with header", () => {
    const patterns: DecompositionPattern[] = [
      {
        id: "anti-1",
        content: "AVOID: Split by file type",
        kind: "anti_pattern",
        is_negative: true,
        success_count: 0,
        failure_count: 10,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        tags: [],
        example_cells: [],
      },
    ];
    const formatted = formatAntiPatternsForPrompt(patterns);
    expect(formatted).toContain("## Anti-Patterns to Avoid");
    expect(formatted).toContain("AVOID: Split by file type");
  });

  it("filters out non-anti-patterns", () => {
    const patterns: DecompositionPattern[] = [
      {
        id: "pattern-1",
        content: "Good pattern",
        kind: "pattern",
        is_negative: false,
        success_count: 10,
        failure_count: 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        tags: [],
        example_cells: [],
      },
      {
        id: "anti-1",
        content: "AVOID: Bad pattern",
        kind: "anti_pattern",
        is_negative: true,
        success_count: 0,
        failure_count: 10,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        tags: [],
        example_cells: [],
      },
    ];
    const formatted = formatAntiPatternsForPrompt(patterns);
    expect(formatted).toContain("AVOID: Bad pattern");
    expect(formatted).not.toContain("Good pattern");
  });

  it("returns empty string when no anti-patterns", () => {
    const patterns: DecompositionPattern[] = [
      {
        id: "pattern-1",
        content: "Good pattern",
        kind: "pattern",
        is_negative: false,
        success_count: 10,
        failure_count: 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        tags: [],
        example_cells: [],
      },
    ];
    const formatted = formatAntiPatternsForPrompt(patterns);
    expect(formatted).toBe("");
  });

  it("returns empty string for empty array", () => {
    const formatted = formatAntiPatternsForPrompt([]);
    expect(formatted).toBe("");
  });

  it("formats multiple anti-patterns", () => {
    const patterns: DecompositionPattern[] = [
      {
        id: "anti-1",
        content: "AVOID: Pattern 1",
        kind: "anti_pattern",
        is_negative: true,
        success_count: 0,
        failure_count: 5,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        tags: [],
        example_cells: [],
      },
      {
        id: "anti-2",
        content: "AVOID: Pattern 2",
        kind: "anti_pattern",
        is_negative: true,
        success_count: 1,
        failure_count: 9,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        tags: [],
        example_cells: [],
      },
    ];
    const formatted = formatAntiPatternsForPrompt(patterns);
    expect(formatted).toContain("AVOID: Pattern 1");
    expect(formatted).toContain("AVOID: Pattern 2");
  });
});

// ============================================================================
// formatSuccessfulPatternsForPrompt Tests
// ============================================================================

describe("formatSuccessfulPatternsForPrompt", () => {
  it("filters patterns below minSuccessRate", () => {
    const patterns: DecompositionPattern[] = [
      {
        id: "pattern-1",
        content: "Good pattern",
        kind: "pattern",
        is_negative: false,
        success_count: 8,
        failure_count: 2, // 80% success
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        tags: [],
        example_cells: [],
      },
      {
        id: "pattern-2",
        content: "Bad pattern",
        kind: "pattern",
        is_negative: false,
        success_count: 5,
        failure_count: 5, // 50% success
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        tags: [],
        example_cells: [],
      },
    ];
    const formatted = formatSuccessfulPatternsForPrompt(patterns, 0.7);
    expect(formatted).toContain("Good pattern");
    expect(formatted).not.toContain("Bad pattern");
  });

  it("includes success rate percentage in output", () => {
    const patterns: DecompositionPattern[] = [
      {
        id: "pattern-1",
        content: "Test pattern",
        kind: "pattern",
        is_negative: false,
        success_count: 8,
        failure_count: 2, // 80%
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        tags: [],
        example_cells: [],
      },
    ];
    const formatted = formatSuccessfulPatternsForPrompt(patterns);
    expect(formatted).toContain("80% success rate");
  });

  it("filters out anti-patterns", () => {
    const patterns: DecompositionPattern[] = [
      {
        id: "anti-1",
        content: "AVOID: Bad",
        kind: "anti_pattern",
        is_negative: true,
        success_count: 10,
        failure_count: 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        tags: [],
        example_cells: [],
      },
    ];
    const formatted = formatSuccessfulPatternsForPrompt(patterns);
    expect(formatted).toBe("");
  });

  it("filters out patterns with < 2 total observations", () => {
    const patterns: DecompositionPattern[] = [
      {
        id: "pattern-1",
        content: "Not enough data",
        kind: "pattern",
        is_negative: false,
        success_count: 1,
        failure_count: 0, // Only 1 observation
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        tags: [],
        example_cells: [],
      },
    ];
    const formatted = formatSuccessfulPatternsForPrompt(patterns, 0.7);
    expect(formatted).toBe("");
  });

  it("returns empty string when no qualifying patterns", () => {
    const patterns: DecompositionPattern[] = [
      {
        id: "pattern-1",
        content: "Low success",
        kind: "pattern",
        is_negative: false,
        success_count: 1,
        failure_count: 9, // 10% success
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        tags: [],
        example_cells: [],
      },
    ];
    const formatted = formatSuccessfulPatternsForPrompt(patterns, 0.7);
    expect(formatted).toBe("");
  });

  it("returns empty string for empty array", () => {
    const formatted = formatSuccessfulPatternsForPrompt([]);
    expect(formatted).toBe("");
  });

  it("uses default minSuccessRate of 0.7", () => {
    const patterns: DecompositionPattern[] = [
      {
        id: "pattern-1",
        content: "69% success",
        kind: "pattern",
        is_negative: false,
        success_count: 69,
        failure_count: 31, // Just below 70%
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        tags: [],
        example_cells: [],
      },
    ];
    const formatted = formatSuccessfulPatternsForPrompt(patterns);
    expect(formatted).toBe(""); // Should be filtered out
  });

  it("respects custom minSuccessRate", () => {
    const patterns: DecompositionPattern[] = [
      {
        id: "pattern-1",
        content: "60% success",
        kind: "pattern",
        is_negative: false,
        success_count: 6,
        failure_count: 4,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        tags: [],
        example_cells: [],
      },
    ];
    const formatted = formatSuccessfulPatternsForPrompt(patterns, 0.5);
    expect(formatted).toContain("60% success");
  });

  it("formats multiple successful patterns", () => {
    const patterns: DecompositionPattern[] = [
      {
        id: "pattern-1",
        content: "Pattern A",
        kind: "pattern",
        is_negative: false,
        success_count: 8,
        failure_count: 2,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        tags: [],
        example_cells: [],
      },
      {
        id: "pattern-2",
        content: "Pattern B",
        kind: "pattern",
        is_negative: false,
        success_count: 7,
        failure_count: 3,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        tags: [],
        example_cells: [],
      },
    ];
    const formatted = formatSuccessfulPatternsForPrompt(patterns);
    expect(formatted).toContain("Pattern A");
    expect(formatted).toContain("Pattern B");
  });

  it("includes header when patterns exist", () => {
    const patterns: DecompositionPattern[] = [
      {
        id: "pattern-1",
        content: "Test",
        kind: "pattern",
        is_negative: false,
        success_count: 8,
        failure_count: 2,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        tags: [],
        example_cells: [],
      },
    ];
    const formatted = formatSuccessfulPatternsForPrompt(patterns);
    expect(formatted).toContain("## Successful Patterns");
  });
});

// ============================================================================
// InMemoryPatternStorage Tests
// ============================================================================

describe("InMemoryPatternStorage", () => {
  it("stores and retrieves a pattern", async () => {
    const storage = new InMemoryPatternStorage();
    const pattern = createPattern("Test pattern");
    await storage.store(pattern);
    const retrieved = await storage.get(pattern.id);
    expect(retrieved).toEqual(pattern);
  });

  it("returns null for non-existent pattern", async () => {
    const storage = new InMemoryPatternStorage();
    const retrieved = await storage.get("non-existent");
    expect(retrieved).toBeNull();
  });

  it("updates existing pattern on store", async () => {
    const storage = new InMemoryPatternStorage();
    const pattern = createPattern("Original");
    await storage.store(pattern);

    const updated = { ...pattern, content: "Updated" };
    await storage.store(updated);

    const retrieved = await storage.get(pattern.id);
    expect(retrieved?.content).toBe("Updated");
  });

  it("getAll returns all stored patterns", async () => {
    const storage = new InMemoryPatternStorage();
    const p1 = createPattern("Pattern 1");
    const p2 = createPattern("Pattern 2");
    await storage.store(p1);
    await storage.store(p2);

    const all = await storage.getAll();
    expect(all).toHaveLength(2);
    expect(all).toContainEqual(p1);
    expect(all).toContainEqual(p2);
  });

  it("getAll returns empty array when no patterns", async () => {
    const storage = new InMemoryPatternStorage();
    const all = await storage.getAll();
    expect(all).toEqual([]);
  });

  it("getAntiPatterns filters by kind", async () => {
    const storage = new InMemoryPatternStorage();
    const pattern = createPattern("Good pattern");
    const antiPattern: DecompositionPattern = {
      ...createPattern("Bad pattern"),
      kind: "anti_pattern",
      is_negative: true,
    };
    await storage.store(pattern);
    await storage.store(antiPattern);

    const antiPatterns = await storage.getAntiPatterns();
    expect(antiPatterns).toHaveLength(1);
    expect(antiPatterns[0].kind).toBe("anti_pattern");
  });

  it("getByTag filters by tag", async () => {
    const storage = new InMemoryPatternStorage();
    const p1 = createPattern("Pattern 1", ["tag1", "tag2"]);
    const p2 = createPattern("Pattern 2", ["tag2", "tag3"]);
    const p3 = createPattern("Pattern 3", ["tag3"]);
    await storage.store(p1);
    await storage.store(p2);
    await storage.store(p3);

    const tagged = await storage.getByTag("tag2");
    expect(tagged).toHaveLength(2);
    expect(tagged.map((p) => p.id)).toContain(p1.id);
    expect(tagged.map((p) => p.id)).toContain(p2.id);
  });

  it("getByTag returns empty for non-existent tag", async () => {
    const storage = new InMemoryPatternStorage();
    const pattern = createPattern("Test", ["tag1"]);
    await storage.store(pattern);

    const tagged = await storage.getByTag("tag2");
    expect(tagged).toEqual([]);
  });

  it("findByContent finds patterns by substring", async () => {
    const storage = new InMemoryPatternStorage();
    const p1 = createPattern("Split by file type");
    const p2 = createPattern("Split by component");
    const p3 = createPattern("Maximize parallelization");
    await storage.store(p1);
    await storage.store(p2);
    await storage.store(p3);

    const found = await storage.findByContent("split");
    expect(found).toHaveLength(2);
  });

  it("findByContent is case-insensitive", async () => {
    const storage = new InMemoryPatternStorage();
    const pattern = createPattern("Split by file type");
    await storage.store(pattern);

    const found = await storage.findByContent("SPLIT");
    expect(found).toHaveLength(1);
  });

  it("findByContent returns empty for no matches", async () => {
    const storage = new InMemoryPatternStorage();
    const pattern = createPattern("Test pattern");
    await storage.store(pattern);

    const found = await storage.findByContent("nonexistent");
    expect(found).toEqual([]);
  });
});
