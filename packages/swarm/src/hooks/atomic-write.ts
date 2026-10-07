import { writeFile, rename, unlink, appendFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";

export interface AtomicWriteOptions {
  append?: boolean;
}

/**
 * Writes content to a file atomically using a temp file + rename pattern.
 * 
 * @param path - Target file path
 * @param content - Content to write
 * @param options - Write options (append mode)
 * 
 * @example
 * ```typescript
 * // Basic write
 * await writeFileAtomic("output.txt", "Hello, World!");
 * 
 * // Append mode
 * await writeFileAtomic("log.txt", "New entry\n", { append: true });
 * ```
 */
export async function writeFileAtomic(
  path: string,
  content: string,
  options?: AtomicWriteOptions
): Promise<void> {
  if (options?.append) {
    await appendFile(path, content, "utf-8");
    return;
  }

  // Atomic write: write to temp file, then rename
  const dir = dirname(path);
  const tempPath = join(dir, `.tmp-${randomUUID()}`);

  try {
    await mkdir(dir, { recursive: true });
    await writeFile(tempPath, content, "utf-8");
    await rename(tempPath, path);
  } catch (err) {
    // Clean up temp file on error
    try {
      await unlink(tempPath);
    } catch {}
    throw err;
  }
}
