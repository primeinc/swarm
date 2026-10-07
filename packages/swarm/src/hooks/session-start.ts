import { getHiveAdapter } from "../hive.js";

/**
 * Debug logger factory
 * Checks DEBUG env var for namespace match at call time
 */
const debug = (namespace: string) => {
  return (message: string, data?: Record<string, unknown>) => {
    // Check env at call time, not creation time
    const enabled =
      process.env.DEBUG?.includes(namespace) || process.env.DEBUG?.includes("swarm:*");
    if (enabled) {
      console.log(`[${namespace}] ${message}`, data ? JSON.stringify(data) : "");
    }
  };
};

const log = debug("swarm:hooks");

export interface SessionContext {
  inProgressCells: Array<{ id: string; title: string }>;
  activeSwarms: Array<{ epicId: string; title: string }>;
}

/**
 * Injects session context by querying hive for in-progress work.
 * Called on session.created event.
 *
 * Note: Can't inject into OpenCode context yet (limitation), just logs for now.
 *
 * @param sessionID - The OpenCode session ID
 * @param projectKey - The project key (directory path)
 * @returns Session context with in-progress cells and active swarms, or null on error
 *
 * @example
 * ```typescript
 * const context = await injectSessionContext("session-123", "/path/to/project");
 * if (context) {
 *   console.log(`Found ${context.inProgressCells.length} in-progress cells`);
 * }
 * ```
 */
export async function injectSessionContext(
  sessionID: string,
  projectKey: string
): Promise<SessionContext | null> {
  try {
    const adapter = await getHiveAdapter(projectKey);

    // Query for in-progress cells
    const inProgressCells = await adapter.queryCells(projectKey, { status: "in_progress" });

    // Query for open epics (active swarms)
    const activeSwarms = await adapter.queryCells(projectKey, { type: "epic", status: "open" });

    const context: SessionContext = {
      inProgressCells: inProgressCells.map((c) => ({ id: c.id, title: c.title })),
      activeSwarms: activeSwarms.map((c) => ({ epicId: c.id, title: c.title })),
    };

    log("session_start", {
      sessionID,
      inProgressCount: context.inProgressCells.length,
      activeSwarmCount: context.activeSwarms.length,
    });

    if (context.inProgressCells.length > 0) {
      log("in_progress_cells", { cells: context.inProgressCells });
    }

    if (context.activeSwarms.length > 0) {
      log("active_swarms", { swarms: context.activeSwarms });
    }

    return context;
  } catch (err) {
    console.error("[swarm-plugin] Failed to inject session context:", err);
    return null;
  }
}
