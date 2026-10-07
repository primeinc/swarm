import { describe, it, expect } from "bun:test";
import {
  HIVE_TOOLS,
  SWARM_TOOLS,
  SWARMMAIL_TOOLS,
  ALL_HOOKED_TOOLS,
  type HookedTool,
  isHookedTool,
} from "./constants";

describe("Hook Constants", () => {
  describe("HIVE_TOOLS", () => {
    it("contains all hive tool names", () => {
      expect(HIVE_TOOLS).toEqual([
        "hive_create",
        "hive_update",
        "hive_close",
        "hive_start",
        "hive_ready",
        "hive_query",
        "hive_sync",
        "hive_cells",
        "hive_create_epic",
      ]);
    });

    it("is readonly", () => {
      expect(Object.isFrozen(HIVE_TOOLS)).toBe(false); // as const makes it readonly at compile time
      // TypeScript prevents mutations, but runtime doesn't freeze
    });
  });

  describe("SWARM_TOOLS", () => {
    it("contains all swarm tool names", () => {
      expect(SWARM_TOOLS).toEqual([
        "swarm_spawn_subtask",
        "swarm_complete",
        "swarm_progress",
        "swarm_status",
        "swarm_record_outcome",
      ]);
    });
  });

  describe("SWARMMAIL_TOOLS", () => {
    it("contains all swarmmail tool names", () => {
      expect(SWARMMAIL_TOOLS).toEqual([
        "swarmmail_init",
        "swarmmail_send",
        "swarmmail_reserve",
        "swarmmail_release",
        "swarmmail_release_all",
        "swarmmail_release_agent",
        "swarmmail_inbox",
      ]);
    });
  });

  describe("ALL_HOOKED_TOOLS", () => {
    it("combines all tool arrays", () => {
      expect(ALL_HOOKED_TOOLS.length).toBe(
        HIVE_TOOLS.length + SWARM_TOOLS.length + SWARMMAIL_TOOLS.length
      );
    });

    it("includes all hive tools", () => {
      HIVE_TOOLS.forEach((tool) => {
        expect(ALL_HOOKED_TOOLS).toContain(tool);
      });
    });

    it("includes all swarm tools", () => {
      SWARM_TOOLS.forEach((tool) => {
        expect(ALL_HOOKED_TOOLS).toContain(tool);
      });
    });

    it("includes all swarmmail tools", () => {
      SWARMMAIL_TOOLS.forEach((tool) => {
        expect(ALL_HOOKED_TOOLS).toContain(tool);
      });
    });

    it("has no duplicates", () => {
      const unique = new Set(ALL_HOOKED_TOOLS);
      expect(unique.size).toBe(ALL_HOOKED_TOOLS.length);
    });
  });

  describe("isHookedTool type guard", () => {
    it("returns true for all hooked hive tools", () => {
      HIVE_TOOLS.forEach((tool) => {
        expect(isHookedTool(tool)).toBe(true);
      });
    });

    it("returns true for all hooked swarm tools", () => {
      SWARM_TOOLS.forEach((tool) => {
        expect(isHookedTool(tool)).toBe(true);
      });
    });

    it("returns true for all hooked swarmmail tools", () => {
      SWARMMAIL_TOOLS.forEach((tool) => {
        expect(isHookedTool(tool)).toBe(true);
      });
    });

    it("returns false for non-hooked tools", () => {
      expect(isHookedTool("not_a_tool")).toBe(false);
      expect(isHookedTool("bash")).toBe(false);
      expect(isHookedTool("glob")).toBe(false);
      expect(isHookedTool("")).toBe(false);
    });

    it("narrows type correctly", () => {
      const toolName: string = "hive_create";

      if (isHookedTool(toolName)) {
        // TypeScript should narrow toolName to HookedTool
        const typed: HookedTool = toolName;
        expect(typed).toBe("hive_create");
      }
    });

    it("works with real tool names", () => {
      // Verify specific tools we know should be hooked
      expect(isHookedTool("hive_create")).toBe(true);
      expect(isHookedTool("swarm_complete")).toBe(true);
      expect(isHookedTool("swarmmail_init")).toBe(true);
    });

    it("handles edge cases", () => {
      expect(isHookedTool("hive_create_extra")).toBe(false);
      expect(isHookedTool("hive")).toBe(false);
      expect(isHookedTool("HIVE_CREATE")).toBe(false); // Case sensitive
    });
  });

  describe("HookedTool type", () => {
    it("can be used for type checking", () => {
      const tool: HookedTool = "hive_create";
      expect(tool).toBe("hive_create");
    });

    it("includes all categories", () => {
      // This ensures the type union works correctly
      const hiveTool: HookedTool = "hive_create";
      const swarmTool: HookedTool = "swarm_complete";
      const swarmMailTool: HookedTool = "swarmmail_init";

      expect(hiveTool).toBeDefined();
      expect(swarmTool).toBeDefined();
      expect(swarmMailTool).toBeDefined();
    });
  });
});
