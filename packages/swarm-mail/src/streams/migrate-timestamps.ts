/**
 * Migration: Fix broken datetime('now') timestamps
 *
 * Problem: Some events have string literal "datetime('now')" instead of numeric timestamps.
 * This happened when schema used DEFAULT (datetime('now')) which SQLite interprets as
 * a string literal, not a function call.
 *
 * Solution: Replace all broken timestamps with current time (best effort - we don't
 * know the actual event time).
 *
 * Usage:
 * ```bash
 * bun run packages/swarm-mail/src/streams/migrate-timestamps.ts
 * ```
 */

import { createLibSQLAdapter } from "../libsql.js";
import { getDatabasePath } from "./index.js";

interface MigrationResult {
	brokenCount: number;
	fixedCount: number;
	errors: string[];
}

/**
 * Find and fix broken timestamps in the events table
 *
 * @param db - Database adapter (defaults to global DB)
 * @returns Migration result with counts and errors
 */
export async function migrateTimestamps(db?: any): Promise<MigrationResult> {
	const adapter =
		db || (await createLibSQLAdapter({ url: `file:${getDatabasePath()}` }));

	const result: MigrationResult = {
		brokenCount: 0,
		fixedCount: 0,
		errors: [],
	};

	try {
		// Find all broken records
		// Cast to TEXT to search for the literal string
		const broken = (await adapter.query(
			`SELECT id, timestamp FROM events WHERE CAST(timestamp AS TEXT) LIKE '%datetime%'`,
		)) as { rows: Array<{ id: number; timestamp: string }> };

		result.brokenCount = broken.rows.length;

		if (result.brokenCount === 0) {
			console.log("✅ No broken timestamps found");
			return result;
		}

		console.log(`Found ${result.brokenCount} broken timestamps. Fixing...`);

		// Fix them with current timestamp
		// NOTE: We use Date.now() as best-effort approximation since we don't know actual time
		await adapter.query(
			`UPDATE events 
       SET timestamp = ? 
       WHERE CAST(timestamp AS TEXT) LIKE '%datetime%'`,
			[Date.now()],
		);

		result.fixedCount = result.brokenCount;
		console.log(`✅ Fixed ${result.fixedCount} timestamps`);
	} catch (error) {
		result.errors.push(error instanceof Error ? error.message : String(error));
		console.error("❌ Migration failed:", error);
	} finally {
		if (!db) {
			// Only close if we created the adapter
			await adapter.close();
		}
	}

	return result;
}

/**
 * CLI entry point
 */
if (import.meta.main) {
	console.log("🔧 Migrating broken timestamps...\n");

	const result = await migrateTimestamps();

	console.log("\n📊 Migration Summary:");
	console.log(`   Broken: ${result.brokenCount}`);
	console.log(`   Fixed:  ${result.fixedCount}`);

	if (result.errors.length > 0) {
		console.log(`   Errors: ${result.errors.length}`);
		result.errors.forEach((err) => console.error(`     - ${err}`));
		process.exit(1);
	}

	process.exit(0);
}
