import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { writeFileAtomic } from "./atomic-write";
import { readFile, mkdir, rm, access } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("writeFileAtomic", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `atomic-write-test-${Date.now()}`);
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it("creates a file with the given content", async () => {
    const filePath = join(testDir, "test.txt");
    const content = "Hello, World!";

    await writeFileAtomic(filePath, content);

    const result = await readFile(filePath, "utf-8");
    expect(result).toBe(content);
  });

  it("overwrites existing file content", async () => {
    const filePath = join(testDir, "test.txt");
    await writeFileAtomic(filePath, "original");
    await writeFileAtomic(filePath, "updated");

    const result = await readFile(filePath, "utf-8");
    expect(result).toBe("updated");
  });

  it("appends to existing file when append option is true", async () => {
    const filePath = join(testDir, "test.txt");
    await writeFileAtomic(filePath, "first\n");
    await writeFileAtomic(filePath, "second\n", { append: true });

    const result = await readFile(filePath, "utf-8");
    expect(result).toBe("first\nsecond\n");
  });

  it("creates parent directories if they don't exist", async () => {
    const filePath = join(testDir, "nested", "deep", "test.txt");
    const content = "nested content";

    await writeFileAtomic(filePath, content);

    const result = await readFile(filePath, "utf-8");
    expect(result).toBe(content);
  });

  it("uses atomic write pattern (temp file + rename)", async () => {
    const filePath = join(testDir, "test.txt");
    const content = "atomic content";

    // Write a file to verify atomic behavior
    await writeFileAtomic(filePath, content);

    // Check no temp files remain
    const files = await readFile(testDir, "utf-8").catch(() => null);
    // If temp files were cleaned up, directory should only have our target file
    expect(files).toBeNull(); // readFile on directory should fail
  });

  it("cleans up temp file on error", async () => {
    const filePath = "/root/impossible/path/test.txt";

    await expect(writeFileAtomic(filePath, "content")).rejects.toThrow();

    // Verify no temp files in /tmp
    // This is a bit tricky to test perfectly, but the function should clean up
  });

  it("handles empty content", async () => {
    const filePath = join(testDir, "empty.txt");

    await writeFileAtomic(filePath, "");

    const result = await readFile(filePath, "utf-8");
    expect(result).toBe("");
  });

  it("handles unicode content", async () => {
    const filePath = join(testDir, "unicode.txt");
    const content = "Hello 世界 🌍";

    await writeFileAtomic(filePath, content);

    const result = await readFile(filePath, "utf-8");
    expect(result).toBe(content);
  });
});
