/**
 * Timestamp Format Fix Tests
 *
 * RED: Tests that detect datetime('now') string literal bugs
 * GREEN: Fix schema defaults and add migration
 * REFACTOR: Add validation to prevent regression
 *
 * Context: 1,642 events have broken timestamps like "datetime('now')" instead of numeric ms
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createLibSQLAdapter } from "../libsql.js";
import type { DatabaseAdapter } from "../types/database.js";
import { createEvent } from "./events.js";
import { createLibSQLStreamsSchema } from "./libsql-schema.js";
import { appendEvent } from "./store.js";

describe("Timestamp Format Fix", () => {
	let db: DatabaseAdapter;

	beforeAll(async () => {
		db = await createLibSQLAdapter({ url: ":memory:" });
		await createLibSQLStreamsSchema(db);
	});

	afterAll(async () => {
		await db.close();
	});

	describe("RED: Detect broken datetime() string literals", () => {
		test("events table schema should NOT use datetime('now') as DEFAULT", async () => {
			// Query schema to check DEFAULT clause
			const result = await db.query<{ sql: string }>(
				`SELECT sql FROM sqlite_master WHERE type='table' AND name='events'`,
			);

			const schema = result.rows[0]?.sql || "";

			// This should FAIL initially - schema uses datetime('now')
			expect(schema).not.toContain("datetime('now')");
			expect(schema).not.toContain("DEFAULT (datetime");
		});

		test("inserted events should have numeric timestamps, not string literals", async () => {
			// Create and insert an event
			const event = createEvent("agent_registered", {
				project_key: "/test/project",
				agent_name: "TestAgent",
				program: "opencode",
				model: "claude-4",
			});

			const inserted = await appendEvent(event, undefined, db);

			// Query raw timestamp from database
			const result = await db.query<{ timestamp: string | number }>(
				`SELECT timestamp FROM events WHERE id = ?`,
				[inserted.id],
			);

			const timestamp = result.rows[0]?.timestamp;

			// Should be a NUMBER, not a string literal
			expect(typeof timestamp).toBe("number");
			expect(timestamp).toBeGreaterThan(0);
			expect(timestamp).toBeLessThan(Date.now() + 1000); // Within 1s of now

			// Should NOT be the string "datetime('now')"
			expect(timestamp).not.toBe("datetime('now')");
			expect(String(timestamp)).not.toContain("datetime");
		});

		test("migration should fix existing broken records", async () => {
			// Insert a broken record manually (simulating legacy data)
			await db.query(
				`INSERT INTO events (type, project_key, timestamp, data) VALUES (?, ?, ?, ?)`,
				["test_event", "/test", "datetime('now')", "{}"],
			);

			// Verify it's broken
			const before = await db.query<{ timestamp: string }>(
				`SELECT timestamp FROM events WHERE type = 'test_event'`,
			);
			expect(before.rows[0]?.timestamp).toBe("datetime('now')");

			// Run migration (to be implemented)
			await fixBrokenTimestamps(db);

			// After migration, timestamp should be numeric
			const after = await db.query<{ timestamp: string | number }>(
				`SELECT timestamp FROM events WHERE type = 'test_event'`,
			);

			const fixed = after.rows[0]?.timestamp;
			expect(typeof fixed).toBe("number");
			expect(fixed).toBeGreaterThan(0);
		});
	});

	describe("GREEN: Validation prevents regression", () => {
		test("timestamp column should be INTEGER type", async () => {
			const result = await db.query<{ sql: string }>(
				`SELECT sql FROM sqlite_master WHERE type='table' AND name='events'`,
			);

			const schema = result.rows[0]?.sql || "";

			// Timestamp column should be declared as INTEGER NOT NULL
			expect(schema).toContain("timestamp INTEGER NOT NULL");
		});

		test("createEvent helper always uses Date.now()", async () => {
			const event = createEvent("agent_registered", {
				project_key: "/test",
				agent_name: "TestAgent",
				program: "opencode",
				model: "claude-4",
			});

			// timestamp should be numeric and recent
			expect(typeof event.timestamp).toBe("number");
			expect(event.timestamp).toBeGreaterThan(Date.now() - 1000);
			expect(event.timestamp).toBeLessThan(Date.now() + 1000);
		});
	});
});

/**
 * Migration function to fix broken timestamps
 *
 * Replaces "datetime('now')" string literals with current timestamp.
 * This is a best-effort fix - we don't know the actual event time,
 * so we use a reasonable approximation (now).
 */
async function fixBrokenTimestamps(db: DatabaseAdapter): Promise<number> {
	// Find all broken records
	const broken = await db.query<{ id: number }>(
		`SELECT id FROM events WHERE CAST(timestamp AS TEXT) LIKE '%datetime%'`,
	);

	if (broken.rows.length === 0) {
		return 0;
	}

	// Update them with current timestamp
	await db.query(
		`UPDATE events 
     SET timestamp = ? 
     WHERE CAST(timestamp AS TEXT) LIKE '%datetime%'`,
		[Date.now()],
	);

	return broken.rows.length;
}
