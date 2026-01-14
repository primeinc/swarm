#!/usr/bin/env node
/**
 * Post-processing script for fumadocs-mdx generated files on Windows
 * 
 * fumadocs-mdx uses path.join() which generates Windows backslashes,
 * but these need to be forward slashes for URL paths in the runtime.
 * 
 * This script fixes the generated .source/server.ts file.
 */

import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const serverFilePath = join(__dirname, '../.source/server.ts');

try {
  let content = readFileSync(serverFilePath, 'utf-8');
  
  // Fix: Replace Windows backslashes in doc paths with forward slashes
  // Match pattern: create.docs("docs", "content\docs", ...)
  content = content.replace(
    /create\.docs\("docs",\s*"([^"]+)"/g,
    (match, path) => {
      const fixedPath = path.replace(/\\/g, '/');
      return `create.docs("docs", "${fixedPath}"`;
    }
  );
  
  writeFileSync(serverFilePath, content, 'utf-8');
  console.log('✓ Fixed Windows paths in .source/server.ts');
} catch (error) {
  // File might not exist on first install
  if (error.code !== 'ENOENT') {
    console.error('Error fixing paths:', error);
    process.exit(1);
  }
}
