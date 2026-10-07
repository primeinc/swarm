/**
 * Unified database client for swarm-mail.
 *
 * Wraps libSQL with Drizzle ORM and handles:
 * - Schema initialization (CREATE TABLE IF NOT EXISTS)
 * - Singleton pattern for production use
 * - In-memory instances for testing
 *
 * @example
 * ```typescript
 * // Production - singleton
 * const db = await getDb("file:./swarm.db");
 *
 * // Testing - fresh instance
 * const db = await createInMemoryDb();
 * ```
 */

import type { Client } from "@libsql/client";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import type { DatabaseAdapter } from "../types/database.js";
import { DbClientFactory, type ManagedDb } from "./client-factory.js";
import { DbPathResolver } from "./paths.js";
import type * as schema from "./schema/index.js";

/**
 * Drizzle database instance type with full schema
 */
export type SwarmDb = LibSQLDatabase<typeof schema>;

/**
 * Global singleton instance
 */
let globalManaged: ManagedDb | undefined;

/**
 * Initialize database schema.
 *
 * Creates tables if they don't exist using both:
 * - Streams schema (events, agents, messages, reservations, etc.)
 * - Memory schema (memories with FTS5 and vector indexes)
 *
 * @param client - libSQL client
 * @param adapter - Database adapter
 */
async function initializeSchema(
	client: Client,
	adapter: DatabaseAdapter,
): Promise<void> {
	// Import libSQL schema creation
	const { createLibSQLStreamsSchema } = await import(
		"../streams/libsql-schema.js"
	);
	const { createLibSQLMemorySchema } = await import(
		"../memory/libsql-schema.js"
	);

	// Initialize streams schema (events, agents, messages, etc.)
	await createLibSQLStreamsSchema(adapter);

	// Initialize memory schema (memories table with FTS5 and vector indexes)
	await createLibSQLMemorySchema(client);
}

/**
 * Create an in-memory database instance.
 *
 * Creates a fresh instance on each call - ideal for testing.
 *
 * @returns Fresh Drizzle database instance
 */
export async function createInMemoryDb(): Promise<SwarmDb> {
	// :memory: is special - each connection opens a new database
	// DbClientFactory manages this correctly by treating it as a unique URL each time
	// IF we don't cache it. But getOrCreate caches by URL.
	// So for :memory:, we need a way to bypass cache or use unique URLs.

	// libSQL on Windows strictly validates query params and rejects unknown ones like 'mode'.
	// To get unique in-memory DBs without 'mode=memory', we can use unique file paths in temp dir,
	// similar to what we did in libsql.convenience.ts.

	const { join } = await import("node:path");
	const { tmpdir } = await import("node:os");

	const uniqueId = `memdb${Date.now()}_${Math.random().toString(36).slice(2)}`;
	const tempFile = join(tmpdir(), `swarm-test-${uniqueId}.db`);
	const uniqueUrl = `file:${tempFile}`;

	const managed = await DbClientFactory.getOrCreate(uniqueUrl);

	await initializeSchema(managed.client, managed.adapter);

	return managed.db;
}

/**
 * Get the singleton database instance.
 *
 * Creates the instance on first call, returns cached instance on subsequent calls.
 * Defaults to the global path (~/.config/swarm-tools/swarm.db) if no path provided.
 *
 * @param path - Database file path (optional).
 * @returns Singleton Drizzle database instance
 */
export async function getDb(path?: string): Promise<SwarmDb> {
	if (!globalManaged) {
		const url = path || `file:${DbPathResolver.getGlobalPath()}`;
		globalManaged = await DbClientFactory.getOrCreate(url);

		await initializeSchema(globalManaged.client, globalManaged.adapter);
	}

	return globalManaged.db;
}

/**
 * Close and cleanup database connection.
 *
 * Closes the underlying libSQL client and clears singleton.
 */
export async function closeDb(): Promise<void> {
	if (globalManaged) {
		await globalManaged.close();
		globalManaged = undefined;
	}
}
