#!/usr/bin/env bun
/**
 * Normalize Windows backslashes to forward slashes in generated fumadocs files.
 * 
 * Context: fumadocs-mdx uses path.join() which produces platform-specific separators.
 * On Windows, this creates backslashes (content\docs) but URL paths and glob patterns
 * require forward slashes (content/docs).
 * 
 * References:
 * - Node.js docs: "You must use forward-slashes only in glob expressions"
 * - path.posix provides cross-platform consistency for URL paths
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const sourceFile = join(process.cwd(), '.source', 'server.ts');

try {
  let content = readFileSync(sourceFile, 'utf-8');
  
  // Replace Windows backslashes with forward slashes in create.docs() calls
  // Pattern: create.docs("docs", "content\docs", ...)
  // Replace with: create.docs("docs", "content/docs", ...)
  content = content.replace(
    /create\.docs\("([^"]+)",\s*"([^"]+)"/g,
    (match, name, path) => {
      const normalizedPath = path.replace(/\\/g, '/');
      return `create.docs("${name}", "${normalizedPath}"`;
    }
  );
  
  writeFileSync(sourceFile, content, 'utf-8');
  console.log('✓ Normalized paths in .source/server.ts');
} catch (error) {
  console.error('Failed to normalize paths:', error);
  process.exit(1);
}
