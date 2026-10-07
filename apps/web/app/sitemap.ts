import type { MetadataRoute } from "next";
import { source } from "@/lib/source";

const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://swarmtools.ai";

/**
 * Generate sitemap for all documentation pages
 *
 * Next.js automatically serves this at /sitemap.xml
 * @see https://nextjs.org/docs/app/api-reference/file-conventions/metadata/sitemap
 */
export default function sitemap(): MetadataRoute.Sitemap {
	const pages = source.getPages();

	const docPages: MetadataRoute.Sitemap = pages.map((page) => ({
		url: `${baseUrl}${page.url}`,
		lastModified: new Date(),
		changeFrequency: "weekly",
		priority: page.url === "/docs" ? 1.0 : 0.8,
	}));

	// Add static pages
	const staticPages: MetadataRoute.Sitemap = [
		{
			url: baseUrl,
			lastModified: new Date(),
			changeFrequency: "monthly",
			priority: 1.0,
		},
	];

	return [...staticPages, ...docPages];
}
