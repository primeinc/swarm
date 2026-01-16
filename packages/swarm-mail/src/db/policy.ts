/**
 * SQLite Database Policy - Standard PRAGMAs for 2026
 *
 * This module defines the authoritative PRAGMA policy for all SQLite/libSQL
 * databases in the swarm-tools ecosystem.
 *
 * Policy Goals:
 * 1. Performance: Use WAL mode and NORMAL synchronicity for high concurrency.
 * 2. Reliability: Enforce foreign keys and set a 5s busy timeout.
 * 3. Efficiency: Incremental auto-vacuum and optimized cache size.
 */

import type { Client } from "@libsql/client";

/**
 * Standard PRAGMAs for all SQLite connections
 */
export const SQLITE_POLICY = {
	/** Enable Write-Ahead Logging for concurrent read/write */
	JOURNAL_MODE: "WAL",
	/**
	 * NORMAL is faster than FULL and safe in WAL mode.
	 * Durable across application crashes, though potentially not OS crashes.
	 */
	SYNCHRONOUS: "NORMAL",
	/** Automatic retry on lock contention (5 seconds) */
	BUSY_TIMEOUT: 5000,
	/** Enforce referential integrity */
	FOREIGN_KEYS: "ON",
	/**
	 * Incremental auto-vacuum marks freed pages for reuse without
	 * blocking operations (unlike FULL vacuum).
	 */
	AUTO_VACUUM: "INCREMENTAL",
	/**
	 * Cache size in KB (negative value). -64000 = 64MB.
	 * Helps performance on larger databases like pdf-brain.
	 */
	CACHE_SIZE: -64000,
} as const;

/**
 * Apply the standard SQLite policy to a libSQL client
 *
 * @param client - libSQL client instance
 */
export async function applySqlitePolicy(client: Client): Promise<void> {
	await client.execute(`PRAGMA journal_mode = ${SQLITE_POLICY.JOURNAL_MODE}`);
	await client.execute(`PRAGMA synchronous = ${SQLITE_POLICY.SYNCHRONOUS}`);
	await client.execute(`PRAGMA busy_timeout = ${SQLITE_POLICY.BUSY_TIMEOUT}`);
	await client.execute(`PRAGMA foreign_keys = ${SQLITE_POLICY.FOREIGN_KEYS}`);
	await client.execute(`PRAGMA auto_vacuum = ${SQLITE_POLICY.AUTO_VACUUM}`);
	await client.execute(`PRAGMA cache_size = ${SQLITE_POLICY.CACHE_SIZE}`);
}
