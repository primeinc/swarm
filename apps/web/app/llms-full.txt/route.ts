import { getLLMText } from "@/lib/get-llm-text";
import { type Page, source } from "@/lib/source";

/**
 * GET /llms-full.txt
 *
 * Returns all documentation pages as a single text file for LLM consumption.
 * Useful for AI agents that need to understand the full documentation.
 *
 * Cached indefinitely (revalidate: false)
 */
export const revalidate = false;

export async function GET() {
	const pages = source.getPages() as Page[];
	const texts = await Promise.all(pages.map(getLLMText));

	return new Response(texts.join("\n\n---\n\n"), {
		headers: {
			"Content-Type": "text/plain; charset=utf-8",
		},
	});
}
