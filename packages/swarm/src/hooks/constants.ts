/**
 * Hook Constants
 *
 * Defines which OpenCode tools are hooked for observability.
 * Used by the plugin to identify tool calls that should trigger
 * tool.execute.after hooks for logging, learning, and analytics.
 */

export const HIVE_TOOLS = [
  "hive_create",
  "hive_update",
  "hive_close",
  "hive_start",
  "hive_ready",
  "hive_query",
  "hive_sync",
  "hive_cells",
  "hive_create_epic",
] as const;

export const SWARM_TOOLS = [
  "swarm_spawn_subtask",
  "swarm_complete",
  "swarm_progress",
  "swarm_status",
  "swarm_record_outcome",
] as const;

export const SWARMMAIL_TOOLS = [
  "swarmmail_init",
  "swarmmail_send",
  "swarmmail_reserve",
  "swarmmail_release",
  "swarmmail_release_all",
  "swarmmail_release_agent",
  "swarmmail_inbox",
] as const;

export const ALL_HOOKED_TOOLS = [
  ...HIVE_TOOLS,
  ...SWARM_TOOLS,
  ...SWARMMAIL_TOOLS,
] as const;

export type HookedTool = (typeof ALL_HOOKED_TOOLS)[number];

/**
 * Type guard to check if a tool name is a hooked tool.
 *
 * @param name - The tool name to check
 * @returns true if the tool is hooked, false otherwise
 *
 * @example
 * ```typescript
 * if (isHookedTool(toolName)) {
 *   // toolName is narrowed to HookedTool
 *   recordToolExecution(toolName);
 * }
 * ```
 */
export function isHookedTool(name: string): name is HookedTool {
  return ALL_HOOKED_TOOLS.includes(name as HookedTool);
}
