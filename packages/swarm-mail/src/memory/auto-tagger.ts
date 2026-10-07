/**
 * Auto-Tagger - Automatic tag and keyword generation using LLM
 *
 * Analyzes memory content to generate:
 * 1. tags: 3-5 categorical labels (lowercase, single words)
 * 2. keywords: 5-10 searchable terms extracted from content
 * 3. category: primary domain category
 *
 * Integration:
 * - Called in adapter.store() after content is provided
 * - Results stored in auto_tags column (JSON array) when schema updated
 * - Keywords stored in keywords column (space-separated for FTS boost)
 * - Falls back to metadata field if columns don't exist yet
 *
 * @module memory/auto-tagger
 */

import { generateText, Output } from "ai";
import { z } from "zod";

/**
 * Auto-tag result structure
 */
export interface AutoTagResult {
	/** 3-5 categorical labels (lowercase, single words) */
	tags: string[];
	/** 5-10 searchable terms from content */
	keywords: string[];
	/** Primary domain category */
	category: string;
}

/**
 * Zod schema for LLM response validation
 */
const AutoTagResultSchema = z.object({
	tags: z.array(z.string()).min(3).max(5),
	keywords: z.array(z.string()).min(5).max(10),
	category: z.string(),
});

/**
 * Configuration for auto-tagging
 */
export interface AutoTagConfig {
	/** Model string (e.g., "anthropic/claude-haiku-4-5") */
	model: string;
	/** Vercel AI Gateway API key */
	apiKey: string;
}

/**
 * Generate tags and keywords for memory content
 *
 * Uses Vercel AI SDK v6 pattern with generateText + Output.object.
 * Graceful degradation: returns empty result on LLM errors instead of throwing.
 *
 * @param content - Memory content to analyze
 * @param existingTags - User-provided tags to incorporate (optional)
 * @param config - LLM configuration
 * @returns AutoTagResult with generated tags, keywords, category
 *
 * @example
 * ```typescript
 * const result = await generateTags(
 *   "OAuth tokens need 5min buffer before expiry",
 *   ["auth", "tokens"],
 *   { model: "anthropic/claude-haiku-4-5", apiKey: process.env.AI_GATEWAY_API_KEY }
 * );
 * // result.tags: ["oauth", "tokens", "security", "api"]
 * // result.keywords: ["refresh", "expiry", "buffer", "race-condition", "5min", ...]
 * // result.category: "authentication"
 * ```
 */
export async function generateTags(
	content: string,
	existingTags: string[] | undefined,
	config: AutoTagConfig,
): Promise<AutoTagResult> {
	try {
		const userTagsHint =
			existingTags && existingTags.length > 0
				? `\n\nUSER-PROVIDED TAGS (incorporate these):\n${existingTags.join(", ")}`
				: "";

		const prompt = `Analyze this memory content and generate:
1. tags: 3-5 categorical labels (lowercase, single words like "auth", "database", "frontend")
2. keywords: 5-10 searchable terms extracted from the content (lowercase)
3. category: primary domain category (lowercase, e.g., "authentication", "database", "architecture")

CONTENT:
${content}${userTagsHint}

Rules:
- tags must be single lowercase words (no spaces, no hyphens)
- keywords can be multi-word but should be lowercase
- category should be a clear domain label
- incorporate user-provided tags when present
- extract key technical terms as keywords`;

		const { output } = await generateText({
			model: config.model,
			prompt,
			output: Output.object({
				schema: AutoTagResultSchema,
			}),
			// AI Gateway config - uses AI_GATEWAY_API_KEY from env automatically
			headers: {
				Authorization: `Bearer ${config.apiKey}`,
			},
		});

		return output as AutoTagResult;
	} catch (error) {
		// Graceful degradation on LLM errors
		console.error("[auto-tagger] Failed to generate tags:", error);
		return {
			tags: [],
			keywords: [],
			category: "",
		};
	}
}
