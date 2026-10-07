import type { Page } from "@/lib/source";

/**
 * Convert a Fumadocs page to LLM-friendly text format
 *
 * Output format:
 * ```
 * # Page Title
 * URL: /docs/path
 *
 * Page description
 *
 * [raw markdown content]
 * ```
 */
export async function getLLMText(page: Page): Promise<string> {
	// Get raw markdown content from the page
	const content = await page.data.getText("raw");

	return `# ${page.data.title}
URL: ${page.url}

${page.data.description ?? ""}

${content}`;
}
