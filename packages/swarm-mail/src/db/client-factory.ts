import { type Client, type Config, createClient } from "@libsql/client";
import { drizzle, type LibSQLDatabase } from "drizzle-orm/libsql";
import { LibSQLAdapter } from "../libsql.js";
import type { DatabaseAdapter } from "../types/database.js";
import { DbPathResolver } from "./paths.js";
import { applySqlitePolicy } from "./policy.js";
import * as schema from "./schema/index.js";

/**
 * Managed Database Client
 *
 * Aggregates all database interfaces for a single connection:
 * 1. client: The raw libSQL driver
 * 2. adapter: The generic SQL execution bridge
 * 3. db: The type-safe Drizzle ORM instance
 */
export interface ManagedDb {
	client: Client;
	adapter: DatabaseAdapter;
	db: LibSQLDatabase<typeof schema>;
	close(): Promise<void>;
}

/**
 * Database Client Factory
 *
 * Centralizes the creation and lifecycle of libSQL connections.
 * Ensures consistent PRAGMA application and proper cleanup.
 */
export class DbClientFactory {
	private static instances = new Map<string, ManagedDb>();

	/**
	 * Get the global database singleton
	 */
	static async getGlobal(): Promise<ManagedDb> {
		const path = DbPathResolver.getGlobalPath();
		return DbClientFactory.getOrCreate(`file:${path}`);
	}

	/**
	 * Get or create a managed connection
	 */
	static async getOrCreate(url: string): Promise<ManagedDb> {
		const existing = DbClientFactory.instances.get(url);
		if (existing && !existing.client.closed) {
			return existing;
		}

		const managed = await DbClientFactory.create(url);
		DbClientFactory.instances.set(url, managed);
		return managed;
	}

	/**
	 * Create a new managed connection
	 */
	private static async create(url: string): Promise<ManagedDb> {
		const config: Config = { url };
		const client = createClient(config);

		// 1. Verify connection
		await client.execute("SELECT 1");

		// 2. Apply standard PRAGMA policy (WAL, NORMAL sync, etc.)
		await applySqlitePolicy(client);

		// 3. Initialize Drizzle and Adapter
		const adapter = new LibSQLAdapter(client);
		const db = drizzle(client, { schema });

		const managed: ManagedDb = {
			client,
			adapter,
			db,
			close: async () => {
				if (client.closed) return;

				// CRITICAL: TRUNCATE checkpoint before close for Windows reliability
				try {
					await client.execute("PRAGMA wal_checkpoint(TRUNCATE)");
				} catch (e) {
					console.warn(`[DbClientFactory] Checkpoint failed for ${url}:`, e);
				}

				client.close();
				DbClientFactory.instances.delete(url);
			},
		};

		return managed;
	}

	/**
	 * Close all active connections
	 */
	static async closeAll(): Promise<void> {
		const closures = Array.from(DbClientFactory.instances.values()).map((db) =>
			db.close(),
		);
		await Promise.all(closures);
		DbClientFactory.instances.clear();
	}
}
