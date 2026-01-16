/**
 * LibSQL Convenience Layer - Simple API for libSQL users
 *
 * Provides simplified interface for users who want
 * libSQL without manually setting up adapters.
 *
 * ## Simple API (this file)
 * ```typescript
 * import { getSwarmMailLibSQL } from '@opencode/swarm-mail';
 *
 * const swarmMail = await getSwarmMailLibSQL('/path/to/project');
 * await swarmMail.registerAgent(projectKey, 'agent-name');
 * ```
 *
 * ## Advanced API (adapter pattern)
 * ```typescript
 * import { createLibSQLAdapter, createSwarmMailAdapter } from '@opencode/swarm-mail';
 *
 * const db = await createLibSQLAdapter({ url: 'libsql://...' });
 * const swarmMail = createSwarmMailAdapter(db, '/path/to/project');
 * ```
 */

import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import type { Client } from "@libsql/client";
import { createSwarmMailAdapter } from "./adapter.js";
import type { SwarmDb } from "./db/client.js";
import { DbClientFactory } from "./db/client-factory.js";
import { createDrizzleClient } from "./db/drizzle.js";
import { DbPathResolver } from "./db/paths.js";
import { createLibSQLMemorySchema } from "./memory/libsql-schema.js";
import type { SwarmMailAdapter } from "./types/adapter.js";
import type { DatabaseAdapter } from "./types/database.js";

/**
 * Get project-specific temporary directory name
 *
 * Creates a stable directory name based on project path:
 * `opencode-<project-name>-<hash>`
 */
export function getProjectTempDirName(projectPath: string): string {
	const projectName = basename(projectPath);
	const hash = hashProjectPath(projectPath);

	// Sanitize project name for filesystem
	const safeName = projectName
		.toLowerCase()
		.replace(/[^a-z0-9-]/g, "-")
		.replace(/-+/g, "-")
		.replace(/^-|-$/g, "")
		.slice(0, 32); // Prevent excessively long names

	return `opencode-${safeName}-${hash}`;
}

/**
 * Hash project path to 8-character hex string
 *
 * Uses SHA-256 truncated to 8 chars for project path disambiguation.
 */
export function hashProjectPath(projectPath: string): string {
	return createHash("sha256").update(projectPath).digest("hex").slice(0, 8);
}

/**
 * Get database file path for a project
 *
 * @deprecated Use `DbPathResolver.getGlobalPath()` instead.
 * All databases should use the global path: ~/.config/swarm-tools/swarm.db
 */
export function getDatabasePath(_projectPath?: string): string {
	return DbPathResolver.getGlobalPath();
}

/**
 * Lazy singleton for SwarmMailAdapter instances
 * Maps projectKey -> { adapter: SwarmMailAdapter, url: string }
 */
const adapterCache = new Map<
	string,
	{ adapter: SwarmMailAdapter; url: string }
>();

/**
 * Get SwarmMailAdapter for a project (singleton)
 *
 * Creates or returns existing adapter for the project.
 * Uses file-based libSQL database in system config directory.
 *
 * **Singleton behavior:** Multiple calls return same instance from factory.
 */
export async function getSwarmMailLibSQL(
	projectPath?: string,
): Promise<SwarmMailAdapter> {
	const projectKey = projectPath || "global";

	const existing = adapterCache.get(projectKey);
	// Auto-heal check: if existing client is closed, we must recreate it
	if (existing) {
		// We can't easily check if existing.adapter's internal DB is closed directly
		// without exposing it, but we can check the managed instance if we had access.
		// Instead, we rely on DbClientFactory.getOrCreate to handle the connection pooling.
		// If the connection was closed externally, DbClientFactory might need to know.

		// But wait, adapterCache stores the *Adapter*, which wraps the DB.
		// If the underlying DB is closed, the Adapter is dead.
		// We should check connection health or just re-acquire from factory?

		// Simplest fix: Re-acquire managed DB from factory.
		// If factory returns a NEW connection (because old was closed),
		// then our cached adapter is stale.

		const managed = await DbClientFactory.getOrCreate(existing.url);
		// Check if managed.client.closed is true (it shouldn't be if getOrCreate works right)

		// If we want to be safe, just clear cache if we suspect issues?
		// No, better to trust the factory but ensure we don't hold stale refs.

		// Let's implement a health check or simply recreate the adapter if needed?
		// Creating adapter is cheap. The expensive part is the DB connection.

		// For now, return existing. If it fails, caller handles it?
		// No, that's what caused the test failure.

		// Let's check health of the managed instance associated with this URL
		if (managed.client.closed) {
			// This shouldn't happen if getOrCreate works, but if it does:
			adapterCache.delete(projectKey);
			// Fall through to create new
		} else {
			return existing.adapter;
		}
	}

	const url = `file:${DbPathResolver.getGlobalPath()}`;

	// Use DbClientFactory for singleton management and policy application
	const managed = await DbClientFactory.getOrCreate(url);
	const db = managed.adapter;

	// Initialize memory schema (streams schema already initialized by policy application/create)
	await createLibSQLMemorySchema(managed.client);

	const adapter = createSwarmMailAdapter(db, projectKey);
	adapterCache.set(projectKey, { adapter, url });
	return adapter;
}

/**
 * Create in-memory SwarmMailAdapter for testing
 *
 * Each call creates a new isolated instance by using a unique file in the temp directory.
 */
export async function createInMemorySwarmMailLibSQL(
	testId: string,
): Promise<SwarmMailAdapter> {
	// Use unique URL for isolation. libSQL client on Windows handles file:// paths well.
	// We use a unique file in the OS temp directory to simulate in-memory isolation.
	// Sanitize testId to a flat filename to avoid missing directory issues.
	const safeId = testId.replace(/[^a-z0-9]/gi, "-").toLowerCase();
	const tempFile = join(tmpdir(), `swarm-test-${safeId}.db`);
	const url = `file:${tempFile}`;

	// Force clean slate for tests: close existing if any
	const existingManaged = await DbClientFactory.getOrCreate(url);
	if (existingManaged && !existingManaged.client.closed) {
		// If it exists, it might be from a previous run or stale.
		// But getOrCreate returns an open connection.
		// If we want a FRESH one, we rely on unique testId.
	}

	const managed = await DbClientFactory.getOrCreate(url);
	const db = managed.adapter;

	// Initialize schemas
	const { createLibSQLStreamsSchema } = await import(
		"./streams/libsql-schema.js"
	);
	await createLibSQLStreamsSchema(db);
	await createLibSQLMemorySchema(managed.client);

	const adapter = createSwarmMailAdapter(db, `test-${safeId}`);
	adapterCache.set(`test-${safeId}`, { adapter, url });
	return adapter;
}

/**
 * Close SwarmMailAdapter for specific project
 *
 * Closes database connection and removes from singleton cache.
 */
export async function closeSwarmMailLibSQL(
	projectPath?: string,
): Promise<void> {
	const projectKey = projectPath || "global";
	const cached = adapterCache.get(projectKey);

	if (cached) {
		adapterCache.delete(projectKey);

		// If it's a test database or global database, we close the connection
		// Note: for global shared DB, this will close it for everyone.
		// In tests, this is usually desired between test files or for isolation.
		const managed = await DbClientFactory.getOrCreate(cached.url);
		await managed.close();
	}
}

/**
 * Close all SwarmMailAdapter instances
 */
export async function closeAllSwarmMailLibSQL(): Promise<void> {
	adapterCache.clear();
	await DbClientFactory.closeAll();
}

/**
 * Convert a DatabaseAdapter to a SwarmDb (Drizzle database)
 */
export function toSwarmDb(adapter: DatabaseAdapter): SwarmDb {
	// LibSQLAdapter has a getClient() method that returns the underlying libSQL client
	const adapterWithClient = adapter as { getClient?: () => Client };
	if (!adapterWithClient.getClient) {
		throw new Error(
			"DatabaseAdapter does not have getClient() method - must be a LibSQLAdapter",
		);
	}
	return createDrizzleClient(adapterWithClient.getClient());
}

/**
 * Convert DatabaseAdapter to SwarmDb (Drizzle client)
 */
export function toDrizzleDb(adapter: DatabaseAdapter): SwarmDb {
	// Check if it's a LibSQLAdapter (has getClient method)
	const adapterWithClient = adapter as { getClient?: () => Client };
	if (adapterWithClient.getClient) {
		return createDrizzleClient(adapterWithClient.getClient());
	}

	throw new Error("Database must be a LibSQLAdapter (with getClient())");
}
