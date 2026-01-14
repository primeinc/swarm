import { remarkMdxMermaid } from 'fumadocs-core/mdx-plugins';
import { remarkAutoTypeTable, createGenerator } from 'fumadocs-typescript';
import { defineConfig, defineDocs } from 'fumadocs-mdx/config';

/**
 * TypeScript generator for auto-type-table
 * Enables <AutoTypeTable path="./file.ts" name="MyType" /> in MDX
 */
const generator = createGenerator();

export const docs = defineDocs({
  dir: 'content-docs',
});

export default defineConfig({
  mdxOptions: {
    remarkPlugins: [remarkMdxMermaid, [remarkAutoTypeTable, { generator }]],
  },
});
