/**
 * Hooks Index
 * 
 * Re-exports all hook functionality for integration into the main plugin.
 * 
 * @module hooks
 */

// Re-export all hook functionality
export { HIVE_TOOLS, SWARM_TOOLS, SWARMMAIL_TOOLS, ALL_HOOKED_TOOLS, isHookedTool } from "./constants";
export type { HookedTool } from "./constants";

export { handleToolComplete } from "./tool-complete";
export type { ToolHookInput, ToolHookOutput } from "./tool-complete";

export { injectSessionContext } from "./session-start";
export type { SessionContext } from "./session-start";

export { writeFileAtomic } from "./atomic-write";
export type { AtomicWriteOptions } from "./atomic-write";
