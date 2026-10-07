import { type Page, source } from "@/lib/source";

/**
 * GET /llms.txt
 *
 * Returns an index of all documentation pages with titles, URLs, and descriptions.
 * This is the standard llms.txt format for AI agent discovery.
 *
 * Format:
 * ```
 * # Swarm Tools Documentation
 *
 * > Framework-agnostic primitives for multi-agent AI systems
 *
 * ## Pages
 *
 * - [Page Title](/docs/path): Description
 * ```
 *
 * Cached indefinitely (revalidate: false)
 */
export const revalidate = false;

export async function GET() {
	const pages = source.getPages() as Page[];

	const pageList = pages
		.map(
			(page) =>
				`- [${page.data.title}](${page.url}): ${page.data.description ?? "No description"}`,
		)
		.join("\n");

	const content = `# Swarm Tools Documentation

> Framework-agnostic primitives for multi-agent AI systems

## Full Documentation

For complete documentation content, fetch: /llms-full.txt

## Pages

${pageList}
`;

	return new Response(content, {
		headers: {
			"Content-Type": "text/plain; charset=utf-8",
		},
	});
}
