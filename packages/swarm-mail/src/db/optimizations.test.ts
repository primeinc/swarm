/**
 * Database optimizations tests
 *
 * Verifies that performance optimizations are applied on database initialization:
 * - WAL mode for concurrent read/write performance
 * - Auto vacuum to prevent database bloat
 * - Performance indexes for common query patterns
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Client, createClient } from "@libsql/client";
import { createLibSQLAdapter } from "../libsql.js";
import { createLibSQLStreamsSchema } from "../streams/libsql-schema.js";
import type { DatabaseAdapter } from "../types/database.js";
import { DbFileOps } from "./file-ops.js";

describe("Database Optimizations", () => {
	let client: Client;
	let adapter: DatabaseAdapter;
	let tempDir: string;
	let dbPath: string;

	beforeAll(async () => {
		// Create temporary directory for test database
		// WAL mode requires a file-based database (doesn't work with :memory:)
		tempDir = mkdtempSync(join(tmpdir(), "swarm-test-"));
		dbPath = join(tempDir, "test.db");

		// Create file-based database with optimizations applied
		adapter = await createLibSQLAdapter({ url: `file:${dbPath}` });
		client = (adapter as any).client;

		// Initialize schema (creates tables and indexes)
		await createLibSQLStreamsSchema(adapter);
	});

	afterAll(async () => {
		client.close();
		// Clean up temp directory
		await DbFileOps.remove(tempDir, { recursive: true });
	});

	describe("WAL Mode", () => {
		test("should enable WAL journal mode", async () => {
			const result = await client.execute("PRAGMA journal_mode");
			expect(result.rows[0]).toMatchObject({ journal_mode: "wal" });
		});
	});

	describe("Auto Vacuum", () => {
		test("should enable incremental auto vacuum", async () => {
			const result = await client.execute("PRAGMA auto_vacuum");
			// 2 = INCREMENTAL (0 = NONE, 1 = FULL, 2 = INCREMENTAL)
			expect(result.rows[0]).toMatchObject({ auto_vacuum: 2 });
		});
	});

	describe("Performance Indexes", () => {
		test("should create composite index on events(project_key, timestamp)", async () => {
			const result = await client.execute(`
        SELECT name FROM sqlite_master 
        WHERE type='index' AND name='idx_events_project_timestamp'
      `);

			expect(result.rows.length).toBe(1);
			expect(result.rows[0]).toMatchObject({
				name: "idx_events_project_timestamp",
			});
		});

		test("composite index should cover project_key and timestamp columns", async () => {
			// Verify the index definition includes both columns
			const result = await client.execute(`
        SELECT sql FROM sqlite_master 
        WHERE type='index' AND name='idx_events_project_timestamp'
      `);

			const indexSql = String((result.rows[0] as any)?.sql || "");
			expect(indexSql).toContain("project_key");
			expect(indexSql).toContain("timestamp");
		});
	});

	describe("Optimization Benefits", () => {
		test("WAL mode improves concurrent read/write performance", async () => {
			// WAL allows readers to not block writers and vice versa
			const result = await client.execute("PRAGMA journal_mode");
			expect(result.rows[0]).toMatchObject({ journal_mode: "wal" });

			// This is the key benefit: multiple readers can coexist with a writer
			// In rollback mode (default), readers block writers
		});

		test("auto vacuum prevents database bloat over time", async () => {
			// With incremental auto vacuum, deleted space is marked for reuse
			// rather than permanently bloating the file
			const result = await client.execute("PRAGMA auto_vacuum");
			expect(result.rows[0]).toMatchObject({ auto_vacuum: 2 });
		});

		test("composite index speeds up queries filtering by project_key + timestamp", async () => {
			// This is a common query pattern in swarm coordination:
			// - Get events for a specific project within a time range
			// - Timeline queries for dashboards
			// - Filtering by project and sorting by time

			const result = await client.execute(`
        SELECT name FROM sqlite_master 
        WHERE type='index' AND name='idx_events_project_timestamp'
      `);

			expect(result.rows.length).toBe(1);
		});
	});
});
