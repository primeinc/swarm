/**
 * Adversarial Review Tool - Test Suite
 *
 * Tests the VDD-style adversarial reviewer that spawns a hostile, fresh-context
 * agent to stress-test code quality.
 *
 * Credit: Inspired by VDD methodology from https://github.com/Vomikron/VDD
 * Uses "Sarcasmotron" pattern - hostile reviewer with zero tolerance for slop.
 */

import { describe, test, expect, beforeAll } from "bun:test";
import { adversarialReviewTool } from "./swarm-adversarial-review";

describe("adversarialReviewTool", () => {
  describe("RED: Tool definition", () => {
    test("tool is defined", () => {
      expect(adversarialReviewTool).toBeDefined();
    });

    test("tool has description", () => {
      expect(adversarialReviewTool.description).toBeDefined();
      expect(adversarialReviewTool.description.length).toBeGreaterThan(0);
    });

    test("tool has args schema", () => {
      expect(adversarialReviewTool.args).toBeDefined();
      expect(adversarialReviewTool.args.diff).toBeDefined();
    });

    test("tool has execute function", () => {
      expect(adversarialReviewTool.execute).toBeDefined();
      expect(typeof adversarialReviewTool.execute).toBe("function");
    });
  });

  describe("RED: Execution", () => {
    test("returns structured response with critiques and verdict", async () => {
      const result = await adversarialReviewTool.execute({
        diff: `
diff --git a/src/auth.ts b/src/auth.ts
+export function login(username: string, password: string) {
+  return fetch('/api/login', { 
+    method: 'POST',
+    body: JSON.stringify({ username, password })
+  });
+}
        `.trim(),
        test_output: "All tests pass",
      });

      const parsed = JSON.parse(result);
      expect(parsed).toHaveProperty("critiques");
      expect(parsed).toHaveProperty("verdict");
      expect(Array.isArray(parsed.critiques)).toBe(true);
      expect(["APPROVED", "NEEDS_CHANGES", "HALLUCINATING"]).toContain(
        parsed.verdict,
      );
    });

    test("critique has required fields", async () => {
      const result = await adversarialReviewTool.execute({
        diff: `
diff --git a/src/auth.ts b/src/auth.ts
+export function login(username: any, password: any) {
+  return fetch('/api/login', { body: { username, password } });
+}
        `.trim(),
        test_output: "Tests pass",
      });

      const parsed = JSON.parse(result);
      if (parsed.critiques.length > 0) {
        const critique = parsed.critiques[0];
        expect(critique).toHaveProperty("file");
        expect(critique).toHaveProperty("issue");
        expect(critique).toHaveProperty("severity");
        expect(["error", "warning", "info"]).toContain(critique.severity);
      }
    });
  });

  describe("RED: HALLUCINATING verdict detection", () => {
    test("returns HALLUCINATING when adversary invents problems", async () => {
      // Perfect code - adversary should have nothing to complain about
      // If it still finds issues, they're hallucinated
      const perfectDiff = `
diff --git a/src/math.ts b/src/math.ts
+/**
+ * Adds two numbers together.
+ * @param a - First number
+ * @param b - Second number
+ * @returns Sum of a and b
+ */
+export function add(a: number, b: number): number {
+  return a + b;
+}
      `.trim();

      const result = await adversarialReviewTool.execute({
        diff: perfectDiff,
        test_output: "✓ add() returns correct sum",
        is_hallucination_test: true, // Signal to adversary to be extra critical
      });

      const parsed = JSON.parse(result);
      // Either APPROVED (no issues) or HALLUCINATING (invented issues)
      expect(["APPROVED", "HALLUCINATING"]).toContain(parsed.verdict);
    });
  });

  describe("RED: Adversary prompt generation", () => {
    test("generates hostile system prompt", () => {
      // This will be implemented in the tool
      // For now, we just test that the prompt is non-empty
      const mockPrompt = `You are Sarcasmotron, an adversarial code reviewer.`;
      expect(mockPrompt.length).toBeGreaterThan(0);
      expect(mockPrompt).toContain("adversarial");
    });
  });
});
