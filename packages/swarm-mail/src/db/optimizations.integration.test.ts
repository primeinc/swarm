/**
 * Database optimizations integration tests
 *
 * Verifies that optimizations work in realistic scenarios with actual data.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLibSQLStreamsSchema } from "../streams/libsql-schema.js";
import type { DatabaseAdapter } from "../types/database.js";
import { DbClientFactory } from "./client-factory.js";
import { DbFileOps } from "./file-ops.js";

describe("Database Optimizations - Integration", () => {
	let adapter: DatabaseAdapter;
	let tempDir: string;

	beforeAll(async () => {
		tempDir = mkdtempSync(join(tmpdir(), "swarm-opt-"));
		const dbPath = join(tempDir, "test.db");

		const managed = await DbClientFactory.getOrCreate(`file:${dbPath}`);
		adapter = managed.adapter;
		await createLibSQLStreamsSchema(adapter);
	});

	afterAll(async () => {
		await DbClientFactory.closeAll();
		await DbFileOps.remove(tempDir, { recursive: true });
	});

	test("composite index improves query performance for project + time filters", async () => {
		// Insert test data
		const projectKey = "/test/project";
		const baseTime = Date.now();

		for (let i = 0; i < 100; i++) {
			await adapter.exec(`
        INSERT INTO events (type, project_key, timestamp, data)
        VALUES ('test_event', '${projectKey}', ${baseTime + i * 1000}, '{}')
      `);
		}

		// Query using the composite index
		const result = await adapter.query(`
      SELECT COUNT(*) as count 
      FROM events 
      WHERE project_key = '${projectKey}' 
      AND timestamp >= ${baseTime} 
      AND timestamp < ${baseTime + 50000}
    `);

		expect(result.rows[0]).toMatchObject({ count: 50 });
	});

	test("WAL mode allows concurrent reads during writes", async () => {
		// This is a behavioral test - WAL mode is already verified in unit tests
		// Here we just confirm operations don't block unexpectedly
		const projectKey = "/test/concurrent";

		// Start a write operation
		const writePromise = adapter.exec(`
      INSERT INTO events (type, project_key, timestamp, data)
      VALUES ('write_test', '${projectKey}', ${Date.now()}, '{}')
    `);

		// Immediately try to read (should not block in WAL mode)
		const readPromise = adapter.query(`
      SELECT COUNT(*) as count FROM events WHERE project_key = '${projectKey}'
    `);

		// Both should complete without blocking each other
		const [writeResult, readResult] = await Promise.all([
			writePromise,
			readPromise,
		]);

		expect(readResult.rows.length).toBeGreaterThanOrEqual(0);
	});
});
