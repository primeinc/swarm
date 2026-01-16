import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import { handleToolComplete } from "./tool-complete";
import type { ToolHookInput, ToolHookOutput } from "./tool-complete";

describe("handleToolComplete", () => {
  let originalDebug: string | undefined;
  
  beforeEach(() => {
    originalDebug = process.env.DEBUG;
    process.env.DEBUG = "swarm:hooks";
  });
  
  afterEach(() => {
    process.env.DEBUG = originalDebug;
  });

  describe("hooked tool dispatch", () => {
    test("dispatches hive_create to correct handler", async () => {
      const input: ToolHookInput = {
        tool: "hive_create",
        sessionID: "test-session-123",
        callID: "call-456",
      };
      
      const output: ToolHookOutput = {
        title: "Cell Created",
        output: JSON.stringify({
          id: "cell-789",
          title: "Test Cell",
          type: "task",
          status: "open",
        }),
      };

      // Should not throw
      await expect(handleToolComplete("hive_create", input, output)).resolves.toBeUndefined();
    });

    test("dispatches hive_close to correct handler", async () => {
      const input: ToolHookInput = {
        tool: "hive_close",
        sessionID: "test-session-123",
        callID: "call-456",
      };
      
      const output: ToolHookOutput = {
        output: JSON.stringify({
          id: "cell-789",
          status: "closed",
          reason: "Done",
        }),
      };

      await expect(handleToolComplete("hive_close", input, output)).resolves.toBeUndefined();
    });

    test("dispatches swarm_complete to correct handler", async () => {
      const input: ToolHookInput = {
        tool: "swarm_complete",
        sessionID: "test-session-123",
        callID: "call-456",
      };
      
      const output: ToolHookOutput = {
        output: JSON.stringify({
          cell_id: "bead-123",
          success: true,
          files_touched: ["src/test.ts"],
        }),
      };

      await expect(handleToolComplete("swarm_complete", input, output)).resolves.toBeUndefined();
    });

    test("dispatches swarm_spawn_subtask to correct handler", async () => {
      const input: ToolHookInput = {
        tool: "swarm_spawn_subtask",
        sessionID: "test-session-123",
        callID: "call-456",
      };
      
      const output: ToolHookOutput = {
        output: JSON.stringify({
          cell_id: "bead-456",
          worker_name: "TestWorker",
        }),
      };

      await expect(handleToolComplete("swarm_spawn_subtask", input, output)).resolves.toBeUndefined();
    });

    test("handles hooked tool without specific handler", async () => {
      const input: ToolHookInput = {
        tool: "hive_query",
        sessionID: "test-session-123",
        callID: "call-456",
      };
      
      const output: ToolHookOutput = {
        output: JSON.stringify({ cells: [] }),
      };

      // Should not throw, just log
      await expect(handleToolComplete("hive_query", input, output)).resolves.toBeUndefined();
    });
  });

  describe("non-hooked tools", () => {
    test("ignores non-hooked tool (no handler called)", async () => {
      const input: ToolHookInput = {
        tool: "some_random_tool",
        sessionID: "test-session-123",
        callID: "call-456",
      };
      
      const output: ToolHookOutput = {
        output: "some output",
      };

      // Should return immediately without doing anything
      await expect(handleToolComplete("some_random_tool", input, output)).resolves.toBeUndefined();
    });

    test("ignores bash commands", async () => {
      const input: ToolHookInput = {
        tool: "bash",
        sessionID: "test-session-123",
        callID: "call-456",
      };
      
      const output: ToolHookOutput = {
        output: "command output",
      };

      await expect(handleToolComplete("bash", input, output)).resolves.toBeUndefined();
    });
  });

  describe("error handling", () => {
    test("catches and logs JSON parse errors without throwing", async () => {
      const consoleSpy = mock(() => {});
      const originalError = console.error;
      console.error = consoleSpy;

      const input: ToolHookInput = {
        tool: "hive_create",
        sessionID: "test-session-123",
        callID: "call-456",
      };
      
      const output: ToolHookOutput = {
        output: "invalid json {",
      };

      // Should not throw despite invalid JSON
      await expect(handleToolComplete("hive_create", input, output)).resolves.toBeUndefined();
      
      // Should have logged error
      expect(consoleSpy).toHaveBeenCalled();
      
      console.error = originalError;
    });

    test("handles missing output gracefully", async () => {
      const input: ToolHookInput = {
        tool: "hive_create",
        sessionID: "test-session-123",
        callID: "call-456",
      };
      
      // Missing output - defaults to "{}"
      const output: ToolHookOutput = {
        title: "Test",
      };

      // Should not throw - gracefully handles missing output
      await expect(handleToolComplete("hive_create", input, output)).resolves.toBeUndefined();
    });
  });

  describe("concurrent execution", () => {
    test("handles concurrent hook calls without interference", async () => {
      const inputs: ToolHookInput[] = [
        { tool: "hive_create", sessionID: "session-1", callID: "call-1" },
        { tool: "hive_close", sessionID: "session-2", callID: "call-2" },
        { tool: "swarm_complete", sessionID: "session-3", callID: "call-3" },
      ];
      
      const outputs: ToolHookOutput[] = [
        { output: JSON.stringify({ id: "cell-1", title: "Cell 1" }) },
        { output: JSON.stringify({ id: "cell-2", status: "closed" }) },
        { output: JSON.stringify({ cell_id: "bead-3", success: true }) },
      ];

      // Execute all concurrently
      const promises = inputs.map((input, i) => 
        handleToolComplete(inputs[i].tool, input, outputs[i])
      );

      // All should complete without throwing
      await expect(Promise.all(promises)).resolves.toBeDefined();
    });

    test("handles rapid sequential calls", async () => {
      const input: ToolHookInput = {
        tool: "hive_create",
        sessionID: "test-session",
        callID: "call-base",
      };

      const promises = Array.from({ length: 10 }, (_, i) => {
        const output: ToolHookOutput = {
          output: JSON.stringify({ id: `cell-${i}`, title: `Cell ${i}` }),
        };
        
        return handleToolComplete("hive_create", { ...input, callID: `call-${i}` }, output);
      });

      // All should complete without throwing
      await expect(Promise.all(promises)).resolves.toBeDefined();
    });
  });
});
