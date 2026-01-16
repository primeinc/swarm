/**
 * Tool Complete Hook Handler
 *
 * Dispatches PostToolUse hooks for hooked tools.
 * Provides observability into tool execution without blocking the main flow.
 */

import { isHookedTool, type HookedTool } from "./constants";

/**
 * Debug logger factory with namespace support.
 * Enabled via DEBUG=swarm:hooks or DEBUG=swarm:*
 */
const debug = (namespace: string) => {
  const enabled =
    process.env.DEBUG?.includes(namespace) ||
    process.env.DEBUG?.includes("swarm:*");
  
  return (message: string, data?: Record<string, unknown>) => {
    if (enabled) {
      console.log(
        `[${namespace}] ${message}`,
        data ? JSON.stringify(data) : ""
      );
    }
  };
};

const log = debug("swarm:hooks");

/**
 * Input data for tool hook handlers.
 */
export interface ToolHookInput {
  /** Name of the tool that was executed */
  tool: string;
  /** OpenCode session ID */
  sessionID: string;
  /** Unique identifier for this tool call */
  callID: string;
}

/**
 * Output data from tool execution.
 */
export interface ToolHookOutput {
  /** Human-readable title for the result */
  title?: string;
  /** Raw output from the tool (often JSON) */
  output?: string;
  /** Additional metadata about the execution */
  metadata?: Record<string, unknown>;
}

/**
 * Handler function signature for individual tool hooks.
 */
type HookHandler = (
  input: ToolHookInput,
  output: ToolHookOutput
) => Promise<void>;

/**
 * Handler for hive_create tool.
 * Logs when a new cell is created.
 */
async function handleHiveCreate(
  input: ToolHookInput,
  output: ToolHookOutput
): Promise<void> {
  const cell = JSON.parse(output.output ?? "{}");
  log("hive_create", {
    sessionID: input.sessionID,
    cellID: cell.id,
    title: cell.title,
  });
}

/**
 * Handler for hive_close tool.
 * Logs when a cell is closed.
 */
async function handleHiveClose(
  input: ToolHookInput,
  output: ToolHookOutput
): Promise<void> {
  const result = JSON.parse(output.output ?? "{}");
  log("hive_close", {
    sessionID: input.sessionID,
    cellID: result.id,
  });
}

/**
 * Handler for swarm_complete tool.
 * Logs when a worker completes a subtask.
 */
async function handleSwarmComplete(
  input: ToolHookInput,
  output: ToolHookOutput
): Promise<void> {
  const result = JSON.parse(output.output ?? "{}");
  log("swarm_complete", {
    sessionID: input.sessionID,
    cellID: result.cell_id,
    success: result.success,
  });
}

/**
 * Handler for swarm_spawn_subtask tool.
 * Logs when a coordinator spawns a worker.
 */
async function handleSwarmSpawn(
  input: ToolHookInput,
  output: ToolHookOutput
): Promise<void> {
  const result = JSON.parse(output.output ?? "{}");
  log("swarm_spawn_subtask", {
    sessionID: input.sessionID,
    cellID: result.cell_id,
  });
}

/**
 * Dispatch map from tool names to their handlers.
 * Tools without specific handlers will use default logging.
 */
const HOOK_HANDLERS: Partial<Record<HookedTool, HookHandler>> = {
  hive_create: handleHiveCreate,
  hive_close: handleHiveClose,
  swarm_complete: handleSwarmComplete,
  swarm_spawn_subtask: handleSwarmSpawn,
  // Additional handlers can be added here as needed
};

/**
 * Main handler for tool completion hooks.
 * Dispatches to specific handlers based on tool name.
 *
 * @param toolName - Name of the tool that was executed
 * @param input - Input data for the hook
 * @param output - Output data from the tool
 *
 * @remarks
 * - Non-hooked tools are ignored (returns immediately)
 * - Hooked tools without specific handlers get default logging
 * - Errors are caught and logged but never thrown (hooks shouldn't break tool execution)
 *
 * @example
 * ```typescript
 * await handleToolComplete("hive_create", {
 *   tool: "hive_create",
 *   sessionID: "abc123",
 *   callID: "call-456"
 * }, {
 *   output: JSON.stringify({ id: "cell-789", title: "New Task" })
 * });
 * ```
 */
export async function handleToolComplete(
  toolName: string,
  input: ToolHookInput,
  output: ToolHookOutput
): Promise<void> {
  // Ignore non-hooked tools
  if (!isHookedTool(toolName)) {
    return;
  }

  // Get specific handler or use default logging
  const handler = HOOK_HANDLERS[toolName];
  
  if (!handler) {
    // Tool is hooked but no specific handler - just log
    log(toolName, { sessionID: input.sessionID });
    return;
  }

  try {
    await handler(input, output);
  } catch (err) {
    // Log errors but don't throw - hooks shouldn't break tool execution
    console.error(`[swarm-plugin] Hook error for ${toolName}:`, err);
  }
}
