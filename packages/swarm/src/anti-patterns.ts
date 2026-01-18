/**
 * Anti-Pattern Learning Module
 *
 * Tracks failed decomposition patterns and auto-inverts them to anti-patterns.
 * When a pattern consistently fails, it gets flagged as something to avoid.
 *
 * @see https://github.com/Dicklesworthstone/cass_memory_system/blob/main/src/curate.ts#L95-L117
 */
import { z } from "zod";

// ============================================================================
// Schemas
// ============================================================================

/**
 * Pattern kind - whether this is a positive pattern or an anti-pattern
 */
export const PatternKindSchema = z.enum(["pattern", "anti_pattern"]);
export type PatternKind = z.infer<typeof PatternKindSchema>;

/**
 * Decomposition pattern with success/failure tracking.
 *
 * Field relationships:
 * - `kind`: Tracks pattern lifecycle ("pattern" → "anti_pattern" when failure rate exceeds threshold)
 * - `is_negative`: Derived boolean flag for quick filtering (true when kind === "anti_pattern")
 *
 * Both fields exist because:
 * - `kind` is the source of truth for pattern status
 * - `is_negative` enables efficient filtering without string comparison
 */
export const DecompositionPatternSchema = z.object({
	/** Unique ID for this pattern */
	id: z.string(),
	/** Human-readable description of the pattern */
	content: z.string(),
	/** Whether this is a positive pattern or anti-pattern */
	kind: PatternKindSchema,
	/** Whether this pattern should be avoided (true for anti-patterns) */
	is_negative: z.boolean(),
	/** Number of times this pattern succeeded */
	success_count: z.number().int().min(0).default(0),
	/** Number of times this pattern failed */
	failure_count: z.number().int().min(0).default(0),
	/** When this pattern was first observed */
	created_at: z.string(), // ISO-8601
	/** When this pattern was last updated */
	updated_at: z.string(), // ISO-8601
	/** Context about why this pattern was created/inverted */
	reason: z.string().optional(),
	/** Tags for categorization (e.g., "file-splitting", "dependency-ordering") */
	tags: z.array(z.string()).default([]),
	/** Example cell IDs where this pattern was observed */
	example_cells: z.array(z.string()).default([]),
});
export type DecompositionPattern = z.infer<typeof DecompositionPatternSchema>;

/**
 * Result of pattern inversion
 */
export const PatternInversionResultSchema = z.object({
	/** The original pattern */
	original: DecompositionPatternSchema,
	/** The inverted anti-pattern */
	inverted: DecompositionPatternSchema,
	/** Why the inversion happened */
	reason: z.string(),
});
export type PatternInversionResult = z.infer<
	typeof PatternInversionResultSchema
>;

// ============================================================================
// Configuration
// ============================================================================

/** Maximum number of example cells to keep per pattern */
const MAX_EXAMPLE_CELLS = 10;

/**
 * Configuration for anti-pattern detection
 */
export interface AntiPatternConfig {
	/** Minimum observations before considering inversion */
	minObservations: number;
	/** Failure ratio threshold for inversion (0-1) */
	failureRatioThreshold: number;
	/** Prefix for anti-pattern content */
	antiPatternPrefix: string;
}

export const DEFAULT_ANTI_PATTERN_CONFIG: AntiPatternConfig = {
	minObservations: 3,
	failureRatioThreshold: 0.6, // 60% failure rate triggers inversion
	antiPatternPrefix: "AVOID: ",
};

// ============================================================================
// Core Functions
// ============================================================================

/**
 * Check if a pattern should be inverted to an anti-pattern
 *
 * A pattern is inverted when:
 * 1. It has enough observations (minObservations)
 * 2. Its failure ratio exceeds the threshold
 *
 * @param pattern - The pattern to check
 * @param config - Anti-pattern configuration
 * @returns Whether the pattern should be inverted
 */
export function shouldInvertPattern(
	pattern: DecompositionPattern,
	config: AntiPatternConfig = DEFAULT_ANTI_PATTERN_CONFIG,
): boolean {
	// Already an anti-pattern
	if (pattern.kind === "anti_pattern") {
		return false;
	}

	const total = pattern.success_count + pattern.failure_count;

	// Not enough observations
	if (total < config.minObservations) {
		return false;
	}

	const failureRatio = pattern.failure_count / total;
	return failureRatio >= config.failureRatioThreshold;
}

/**
 * Invert a pattern to an anti-pattern
 *
 * Creates a new anti-pattern from a failing pattern.
 * The content is prefixed with "AVOID: " and the kind is changed.
 *
 * @param pattern - The pattern to invert
 * @param reason - Why the inversion is happening
 * @param config - Anti-pattern configuration
 * @returns The inverted anti-pattern
 */
export function invertToAntiPattern(
	pattern: DecompositionPattern,
	reason: string,
	config: AntiPatternConfig = DEFAULT_ANTI_PATTERN_CONFIG,
): PatternInversionResult {
	// Clean the content (remove any existing prefix)
	const cleaned = pattern.content
		.replace(/^AVOID:\s*/i, "")
		.replace(/^DO NOT:\s*/i, "")
		.replace(/^NEVER:\s*/i, "");

	const inverted: DecompositionPattern = {
		...pattern,
		id: `anti-${pattern.id}`,
		content: `${config.antiPatternPrefix}${cleaned}. ${reason}`,
		kind: "anti_pattern",
		is_negative: true,
		reason,
		updated_at: new Date().toISOString(),
	};

	return {
		original: pattern,
		inverted,
		reason,
	};
}

/**
 * Record a pattern observation (success or failure)
 *
 * Updates the pattern's success/failure counts and checks if
 * it should be inverted to an anti-pattern.
 *
 * @param pattern - The pattern to update
 * @param success - Whether this observation was successful
 * @param cellId - Optional cell ID to record as example
 * @param config - Anti-pattern configuration
 * @returns Updated pattern and optional inversion result
 */
export function recordPatternObservation(
	pattern: DecompositionPattern,
	success: boolean,
	cellId?: string,
	config: AntiPatternConfig = DEFAULT_ANTI_PATTERN_CONFIG,
): { pattern: DecompositionPattern; inversion?: PatternInversionResult } {
	// Update counts
	const updated: DecompositionPattern = {
		...pattern,
		success_count: success ? pattern.success_count + 1 : pattern.success_count,
		failure_count: success ? pattern.failure_count : pattern.failure_count + 1,
		updated_at: new Date().toISOString(),
		example_cells: cellId
			? [...pattern.example_cells.slice(-(MAX_EXAMPLE_CELLS - 1)), cellId]
			: pattern.example_cells,
	};

	// Check if should invert
	if (shouldInvertPattern(updated, config)) {
		const total = updated.success_count + updated.failure_count;
		const failureRatio = updated.failure_count / total;
		const reason = `Failed ${updated.failure_count}/${total} times (${Math.round(failureRatio * 100)}% failure rate)`;

		return {
			pattern: updated,
			inversion: invertToAntiPattern(updated, reason, config),
		};
	}

	return { pattern: updated };
}

/**
 * Extract patterns from a decomposition description
 *
 * Looks for common decomposition strategies in the text.
 *
 * @param description - Decomposition description or reasoning
 * @returns Extracted pattern descriptions
 */
export function extractPatternsFromDescription(description: string): string[] {
	const patterns: string[] = [];

	/**
	 * Regex patterns for detecting common decomposition strategies.
	 *
	 * Detection is keyword-based and not exhaustive - patterns can be
	 * manually created for novel strategies not covered here.
	 *
	 * Each pattern maps a regex to a strategy name that will be extracted
	 * from task descriptions during pattern observation.
	 */
	const strategyPatterns: Array<{ regex: RegExp; pattern: string }> = [
		{
			regex: /split(?:ting)?\s+by\s+file\s+type/i,
			pattern: "Split by file type",
		},
		{
			regex: /split(?:ting)?\s+by\s+component/i,
			pattern: "Split by component",
		},
		{
			regex: /split(?:ting)?\s+by\s+layer/i,
			pattern: "Split by layer (UI/logic/data)",
		},
		{ regex: /split(?:ting)?\s+by\s+feature/i, pattern: "Split by feature" },
		{
			regex: /one\s+file\s+per\s+(?:sub)?task/i,
			pattern: "One file per subtask",
		},
		{ regex: /shared\s+types?\s+first/i, pattern: "Handle shared types first" },
		{ regex: /api\s+(?:routes?)?\s+separate/i, pattern: "Separate API routes" },
		{
			regex: /tests?\s+(?:with|alongside)\s+(?:code|implementation)/i,
			pattern: "Tests alongside implementation",
		},
		{
			regex: /tests?\s+(?:in\s+)?separate\s+(?:sub)?task/i,
			pattern: "Tests in separate subtask",
		},
		{
			regex: /parallel(?:ize)?\s+(?:all|everything)/i,
			pattern: "Maximize parallelization",
		},
		{
			regex: /sequential\s+(?:order|execution)/i,
			pattern: "Sequential execution order",
		},
		{
			regex: /dependency\s+(?:chain|order)/i,
			pattern: "Respect dependency chain",
		},
	];

	for (const { regex, pattern } of strategyPatterns) {
		if (regex.test(description)) {
			patterns.push(pattern);
		}
	}

	return patterns;
}

/**
 * Create a new pattern from a description
 *
 * @param content - Pattern description
 * @param tags - Optional tags for categorization
 * @returns New pattern
 */
export function createPattern(
	content: string,
	tags: string[] = [],
): DecompositionPattern {
	const now = new Date().toISOString();
	return {
		id: `pattern-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
		content,
		kind: "pattern",
		is_negative: false,
		success_count: 0,
		failure_count: 0,
		created_at: now,
		updated_at: now,
		tags,
		example_cells: [],
	};
}

/**
 * Format anti-patterns for inclusion in decomposition prompts
 *
 * @param patterns - Anti-patterns to format
 * @returns Formatted string for prompt inclusion
 */
export function formatAntiPatternsForPrompt(
	patterns: DecompositionPattern[],
): string {
	const antiPatterns = patterns.filter((p) => p.kind === "anti_pattern");

	if (antiPatterns.length === 0) {
		return "";
	}

	const lines = [
		"## Anti-Patterns to Avoid",
		"",
		"Based on past failures, avoid these decomposition strategies:",
		"",
		...antiPatterns.map((p) => `- ${p.content}`),
		"",
	];

	return lines.join("\n");
}

/**
 * Format successful patterns for inclusion in prompts.
 *
 * @param patterns - Array of decomposition patterns to filter and format
 * @param minSuccessRate - Minimum success rate to include (default 0.7 = 70%).
 *   Chosen to filter out patterns with marginal track records - only patterns
 *   that succeed at least 70% of the time are recommended.
 * @returns Formatted string of successful patterns for prompt injection
 */
export function formatSuccessfulPatternsForPrompt(
	patterns: DecompositionPattern[],
	minSuccessRate = 0.7,
): string {
	const successful = patterns.filter((p) => {
		if (p.kind === "anti_pattern") return false;
		const total = p.success_count + p.failure_count;
		if (total < 2) return false;
		return p.success_count / total >= minSuccessRate;
	});

	if (successful.length === 0) {
		return "";
	}

	const lines = [
		"## Successful Patterns",
		"",
		"These decomposition strategies have worked well in the past:",
		"",
		...successful.map((p) => {
			const total = p.success_count + p.failure_count;
			const rate = Math.round((p.success_count / total) * 100);
			return `- ${p.content} (${rate}% success rate)`;
		}),
		"",
	];

	return lines.join("\n");
}

// ============================================================================
// Storage Interface
// ============================================================================

/**
 * Storage interface for decomposition patterns
 */
export interface PatternStorage {
	/** Store or update a pattern */
	store(pattern: DecompositionPattern): Promise<void>;
	/** Get a pattern by ID */
	get(id: string): Promise<DecompositionPattern | null>;
	/** Get all patterns */
	getAll(): Promise<DecompositionPattern[]>;
	/** Get all anti-patterns */
	getAntiPatterns(): Promise<DecompositionPattern[]>;
	/** Get patterns by tag */
	getByTag(tag: string): Promise<DecompositionPattern[]>;
	/** Find patterns matching content */
	findByContent(content: string): Promise<DecompositionPattern[]>;
}

/**
 * In-memory pattern storage (for testing and short-lived sessions)
 */
export class InMemoryPatternStorage implements PatternStorage {
	private patterns: Map<string, DecompositionPattern> = new Map();

	async store(pattern: DecompositionPattern): Promise<void> {
		this.patterns.set(pattern.id, pattern);
	}

	async get(id: string): Promise<DecompositionPattern | null> {
		return this.patterns.get(id) ?? null;
	}

	async getAll(): Promise<DecompositionPattern[]> {
		return Array.from(this.patterns.values());
	}

	async getAntiPatterns(): Promise<DecompositionPattern[]> {
		return Array.from(this.patterns.values()).filter(
			(p) => p.kind === "anti_pattern",
		);
	}

	async getByTag(tag: string): Promise<DecompositionPattern[]> {
		return Array.from(this.patterns.values()).filter((p) =>
			p.tags.includes(tag),
		);
	}

	async findByContent(content: string): Promise<DecompositionPattern[]> {
		const lower = content.toLowerCase();
		return Array.from(this.patterns.values()).filter((p) =>
			p.content.toLowerCase().includes(lower),
		);
	}
}

// ============================================================================
// Exports
// ============================================================================

export const antiPatternSchemas = {
	PatternKindSchema,
	DecompositionPatternSchema,
	PatternInversionResultSchema,
};
