/**
 * Hive Normalization Tests
 *
 * These tests verify that permissive inputs (aliases, coercions, flexible shapes)
 * are accepted across hive tools via the normalization layer, and that validation
 * failures return actionable, friendly error messages.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  clearHiveAdapterCache,
  hive_create,
  hive_create_epic,
  hive_update,
  hive_query,
  hive_cells,
  hive_close,
  setHiveWorkingDirectory,
  getHiveAdapter,
  HiveValidationError,
} from "./hive";
import type { HiveAdapter } from "swarm-mail";
import type { Cell } from "./schemas";

// Minimal ToolContext mock expected by @opencode-ai/plugin
const ctx: any = {
  sessionID: "norm-session-" + Date.now(),
  messageID: "norm-message-" + Date.now(),
  agent: "norm-tests",
  abort: new AbortController().signal,
  metadata: {},
  ask: async () => undefined,
};

function parse<T>(s: string): T { return JSON.parse(s) as T; }

const createdIds: string[] = [];
const TEST_PROJECT = join(tmpdir(), `hive-normalization-${Date.now()}`);
let adapter: HiveAdapter;

async function cleanup() {
  for (const id of createdIds) {
    try { await hive_close.execute({ id, reason: "cleanup" }, ctx); } catch {}
  }
  createdIds.length = 0;
}

describe("hive normalization", () => {
  beforeAll(async () => {
    clearHiveAdapterCache();
    setHiveWorkingDirectory(TEST_PROJECT);
    adapter = await getHiveAdapter(TEST_PROJECT);
  });

  afterAll(async () => {
    await cleanup();
    clearHiveAdapterCache();
  });

  describe("create normalization", () => {
    it("accepts title as a raw string", async () => {
      const raw = "Just a title string";
      const json = await hive_create.execute(raw as any, ctx);
      const cell = parse<Cell>(json);
      createdIds.push(cell.id);
      expect(cell.title).toBe("Just a title string");
      expect(cell.status).toBe("open");
    });

    it("accepts camelCase and snake_case aliases", async () => {
      const json = await hive_create.execute({ title: "Alias test", issueType: "feature" } as any, ctx);
      const cell = parse<Cell>(json);
      createdIds.push(cell.id);
      expect(cell.title).toBe("Alias test");
      expect(cell.issue_type).toBe("feature");
    });

    it("coerces numbers and types", async () => {
      const json = await hive_create.execute({ title: "Coercions", priority: "1", type: "Feature" } as any, ctx);
      const cell = parse<Cell>(json);
      createdIds.push(cell.id);
      expect(cell.priority).toBe(1);
      expect(cell.issue_type).toBe("feature");
    });
  });

  describe("update/query normalization", () => {
    let id: string;

    beforeEach(async () => {
      const json = await hive_create.execute({ title: "Norm update target" }, ctx);
      const cell = parse<Cell>(json);
      id = cell.id;
      createdIds.push(id);
    });

    it("normalizes status variants like 'in-progress'", async () => {
      const json = await hive_update.execute({ id, status: "in-progress" } as any, ctx);
      const cell = parse<Cell>(json);
      expect(cell.status).toBe("in_progress");
    });

    it("coerces priority as string in update", async () => {
      const json = await hive_update.execute({ id, priority: "0" } as any, ctx);
      const cell = parse<Cell>(json);
      expect(cell.priority).toBe(0);
    });

    it("query accepts booleans as strings", async () => {
      const list = parse<Cell[]>(await hive_query.execute({ ready: "true" } as any, ctx));
      expect(Array.isArray(list)).toBe(true);
    });
  });

  describe("epic/subtasks normalization", () => {
    it("accepts subtasks as strings, objects, or mixed", async () => {
      const res = await hive_create_epic.execute({
        epicTitle: "Epic Aliases", // alias for epic_title
        epicDescription: "Alias description", // alias for epic_description
        subtasks: [
          "String subtask",
          { title: "Object subtask", files: "src/index.ts" as any, priority: "2" as any },
        ],
      } as any, ctx);

      const { epic, subtasks } = parse<{ epic: Cell; subtasks: Cell[] }>(res);
      createdIds.push(epic.id, ...subtasks.map(s => s.id));

      expect(epic.title).toBe("Epic Aliases");
      expect(subtasks.length).toBe(2);
      expect(subtasks[0].title).toBe("String subtask");
      expect(subtasks[1].priority).toBe(2);
    });
  });

  describe("friendly errors", () => {
    it("surfaces actionable Zod messages with field paths", async () => {
      await expect(
        hive_update.execute({ id: 12345, status: "wat" } as any, ctx), // id should coerce to string; status invalid
      ).rejects.toThrow(HiveValidationError);

      try {
        await hive_update.execute({ id: 12345, status: "wat" } as any, ctx);
      } catch (e: any) {
        expect(e.name).toBe("HiveValidationError");
        // Message should include path and guidance hints
        expect(String(e.message)).toMatch(/Invalid arguments|How to fix|status/);
      }
    });
  });
});
