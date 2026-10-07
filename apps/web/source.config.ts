import { remarkMdxMermaid } from "fumadocs-core/mdx-plugins";
import { defineConfig, defineDocs } from "fumadocs-mdx/config";
import { createGenerator, remarkAutoTypeTable } from "fumadocs-typescript";

/**
 * TypeScript generator for auto-type-table
 * Enables <AutoTypeTable path="./file.ts" name="MyType" /> in MDX
 */
const generator = createGenerator();

export const docs = defineDocs({
	dir: "content-docs",
});

export default defineConfig({
	mdxOptions: {
		remarkPlugins: [remarkMdxMermaid, [remarkAutoTypeTable, { generator }]],
	},
});
