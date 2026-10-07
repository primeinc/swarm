/**
 * SwarmMail Streams - Utility functions and re-exports
 *
 * This module provides utility functions (withTimeout, withTiming, getDatabasePath)
 * and re-exports from other modules for backward compatibility.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { DbPathResolver } from "../db/paths.js";
import { getMainRepoPath } from "../db/worktree.js";
import { migrateLocalDbToGlobal } from "./auto-migrate.js";

// ============================================================================
// Query Timeout Wrapper
// ============================================================================

export async function withTimeout<T>(
	promise: Promise<T>,
	ms: number,
	operation: string,
): Promise<T> {
	const timeout = new Promise<never>((_, reject) =>
		setTimeout(
			() => reject(new Error(`${operation} timed out after ${ms}ms`)),
			ms,
		),
	);
	return Promise.race([promise, timeout]);
}

// ============================================================================
// Performance Monitoring
// ============================================================================

const SLOW_QUERY_THRESHOLD_MS = 100;

export async function withTiming<T>(
	operation: string,
	fn: () => Promise<T>,
): Promise<T> {
	const start = performance.now();
	try {
		return await fn();
	} finally {
		const duration = performance.now() - start;
		if (duration > SLOW_QUERY_THRESHOLD_MS) {
			console.warn(
				`[SwarmMail] Slow operation: ${operation} took ${duration.toFixed(1)}ms`,
			);
		}
	}
}

// ============================================================================
// Configuration
// ============================================================================

/**
 * Get the database path for swarm-mail
 */
export function getDatabasePath(projectPath?: string): string {
	const globalDbPath = DbPathResolver.getGlobalPath();

	if (projectPath) {
		const oldPaths = getOldProjectDbPaths(projectPath);
		if (existsSync(oldPaths.libsql)) {
			migrateLocalDbToGlobal(oldPaths.libsql, globalDbPath).catch((err) => {
				console.error(`[swarm-mail] Migration failed: ${err.message}`);
			});
		}
	}

	return globalDbPath;
}

/**
 * Get paths to old project-local databases for migration detection
 */
export function getOldProjectDbPaths(projectPath: string): {
	libsql: string;
} {
	const mainRepoPath = getMainRepoPath(projectPath);
	const localDir = join(mainRepoPath, ".opencode");
	return {
		libsql: join(localDir, "streams.db"),
	};
}

// ============================================================================
// Exports
// ============================================================================

export * from "./agent-mail.js";
// Client buffer for backpressure handling
export * from "./client-buffer.js";
// Decision trace store for observability
export * from "./decision-trace-store.js";
export * from "./events.js";
export * from "./migrations.js";
export type {
	Agent,
	Conflict,
	EvalRecord,
	EvalStats,
	InboxOptions,
	Message,
	Reservation,
} from "./projections-drizzle.js";
export {
	checkConflicts,
	getActiveReservations,
	getAgent,
	getAgents,
	getEvalRecords,
	getEvalStats,
	getInbox,
	getMessage,
	getThreadMessages,
} from "./projections-drizzle.js";
// Export adapter cache management
export { clearAdapterCache, getOrCreateAdapter } from "./store.js";
// Export Drizzle wrapper functions (they match old signatures)
export {
	appendEvent,
	getLatestSequence,
	readEvents,
} from "./store-drizzle.js";
// Legacy exports for backward compatibility (still used by some high-level functions)
export * from "./swarm-mail.js";
