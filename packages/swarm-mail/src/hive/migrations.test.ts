/**
 * Hive Migrations Tests
 *
 * Tests for schema migrations including:
 * - Fresh database initialization
 * - Upgrade from cells → cells rename
 * - Recovery from corrupted/partial migrations
 *
 * @module hive/migrations.test
 */

import { beforeEach, describe, expect, test } from "bun:test";
import type { Client } from "@libsql/client";
import { createClient } from "@libsql/client";
import { convertPlaceholders } from "../libsql.js";
import type { DatabaseAdapter } from "../types/database.js";
import {
	cellsMigration,
	cellsViewMigrationLibSQL,
	hiveMigrationsLibSQL,
} from "./migrations.js";

function wrapLibSQL(client: Client): DatabaseAdapter {
	return {
		query: async <T>(sql: string, params?: unknown[]) => {
			const converted = convertPlaceholders(sql, params);
			const result = await client.execute({
				sql: converted.sql,
				args: converted.params,
			});
			return { rows: result.rows as T[] };
		},
		exec: async (sql: string) => {
			const converted = convertPlaceholders(sql);
			// LibSQL's execute() doesn't support multiple statements
			// Use executeMultiple() which handles BEGIN...END blocks correctly
			await client.executeMultiple(converted.sql);
		},
		close: () => client.close(),
	};
}

describe("Hive Migrations", () => {
	let client: Client;
	let db: DatabaseAdapter;

	beforeEach(async () => {
		client = createClient({ url: ":memory:" });
		db = wrapLibSQL(client);

		// Create base schema (events table, schema_version) - minimal setup for migrations
		await client.execute(`
      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sequence INTEGER,
        type TEXT NOT NULL,
        project_key TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        data TEXT NOT NULL DEFAULT '{}',
        created_at TEXT
      )
    `);
		await client.execute(`
      CREATE TABLE IF NOT EXISTS schema_version (
        version INTEGER PRIMARY KEY,
        applied_at INTEGER NOT NULL,
        description TEXT
      )
    `);
	});

	describe("cellsMigration (v6)", () => {
		test("creates cells table with correct schema", async () => {
			await db.exec(cellsMigration.up);

			// Verify table exists (SQLite uses sqlite_master instead of information_schema)
			const result = await db.query<{ name: string }>(`
        SELECT name FROM sqlite_master WHERE type='table' AND name='cells'
      `);
			expect(result.rows.length).toBe(1);
			expect(result.rows[0].name).toBe("cells");
		});

		test("creates all supporting tables", async () => {
			await db.exec(cellsMigration.up);

			const tables = [
				"cells",
				"cell_dependencies",
				"cell_labels",
				"cell_comments",
				"blocked_cells_cache",
				"dirty_cells",
			];

			for (const table of tables) {
				const result = await db.query<{ name: string }>(`
          SELECT name FROM sqlite_master WHERE type='table' AND name = '${table}'
        `);
				expect(result.rows.length).toBe(1);
			}
		});
	});

	describe("cellsViewMigration (v7)", () => {
		test("creates cells view pointing to cells table", async () => {
			// First apply v6
			await db.exec(cellsMigration.up);

			// Then apply v7
			await db.exec(cellsViewMigrationLibSQL.up);

			// Verify view exists (SQLite uses sqlite_master for views too)
			const result = await db.query<{ name: string }>(`
        SELECT name FROM sqlite_master WHERE type='view' AND name='cells'
      `);
			expect(result.rows.length).toBe(1);
			expect(result.rows[0].name).toBe("cells");
		});

		test("cells view allows SELECT queries", async () => {
			await db.exec(cellsMigration.up);
			await db.exec(cellsViewMigrationLibSQL.up);

			// Insert into cells
			await db.query(
				`
        INSERT INTO cells (id, project_key, type, status, title, priority, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `,
				[
					"bd-test",
					"/test",
					"task",
					"open",
					"Test task",
					2,
					Date.now(),
					Date.now(),
				],
			);

			// Query via cells view
			const result = await db.query<{ id: string; title: string }>(
				`
        SELECT id, title FROM cells WHERE project_key = $1
      `,
				["/test"],
			);

			expect(result.rows).toHaveLength(1);
			expect(result.rows[0].id).toBe("bd-test");
			expect(result.rows[0].title).toBe("Test task");
		});

		test("cells view allows INSERT via INSTEAD OF trigger", async () => {
			await db.exec(cellsMigration.up);
			await db.exec(cellsViewMigrationLibSQL.up);

			// Insert via cells view
			await db.query(
				`
        INSERT INTO cells (id, project_key, type, status, title, priority, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `,
				[
					"bd-via-view",
					"/test",
					"bug",
					"open",
					"Via view",
					1,
					Date.now(),
					Date.now(),
				],
			);

			// Verify it's in cells table
			const result = await db.query<{ id: string }>(
				`
        SELECT id FROM cells WHERE id = $1
      `,
				["bd-via-view"],
			);

			expect(result.rows).toHaveLength(1);
		});
	});

	describe("upgrade path", () => {
		test("existing v6 database can upgrade to v7", async () => {
			// Simulate existing v6 database with data
			await db.exec(cellsMigration.up);
			await db.query(
				`
        INSERT INTO schema_version (version, applied_at, description)
        VALUES ($1, $2, $3)
      `,
				[6, Date.now(), cellsMigration.description],
			);

			await db.query(
				`
        INSERT INTO cells (id, project_key, type, status, title, priority, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `,
				[
					"bd-existing",
					"/test",
					"task",
					"open",
					"Existing task",
					2,
					Date.now(),
					Date.now(),
				],
			);

			// Apply v7 migration
			await db.exec(cellsViewMigrationLibSQL.up);
			await db.query(
				`
        INSERT INTO schema_version (version, applied_at, description)
        VALUES ($1, $2, $3)
      `,
				[7, Date.now(), cellsViewMigrationLibSQL.description],
			);

			// Verify existing data accessible via cells view
			const result = await db.query<{ id: string }>(
				`
        SELECT id FROM cells WHERE id = $1
      `,
				["bd-existing"],
			);

			expect(result.rows).toHaveLength(1);
		});

		test("fresh database gets both v6 and v7", async () => {
			// Apply all migrations
			for (const migration of hiveMigrationsLibSQL) {
				await db.exec(migration.up);
				await db.query(
					`
          INSERT INTO schema_version (version, applied_at, description)
          VALUES ($1, $2, $3)
        `,
					[migration.version, Date.now(), migration.description],
				);
			}

			// Verify both cells table and cells view exist
			const cellsExists = await db.query<{ name: string }>(`
        SELECT name FROM sqlite_master WHERE type='table' AND name='cells'
      `);
			const cellsExists = await db.query<{ name: string }>(`
        SELECT name FROM sqlite_master WHERE type='view' AND name='cells'
      `);

			expect(cellsExists.rows.length).toBe(1);
			expect(cellsExists.rows.length).toBe(1);
		});
	});

	describe("recovery scenarios", () => {
		test("handles missing cells view gracefully", async () => {
			// Database has v6 but somehow missing v7
			await db.exec(cellsMigration.up);

			// Query cells should fail
			await expect(db.query(`SELECT * FROM cells LIMIT 1`)).rejects.toThrow();

			// After applying v7, it should work
			await db.exec(cellsViewMigrationLibSQL.up);

			const result = await db.query(`SELECT * FROM cells LIMIT 1`);
			expect(result.rows).toHaveLength(0); // Empty but works
		});
	});
});
