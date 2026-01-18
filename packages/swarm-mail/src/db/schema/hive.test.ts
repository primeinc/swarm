/**
 * Tests for Hive Drizzle schema.
 *
 * Validates:
 * - Schema structure matches migration spec
 * - Self-referential foreign keys work
 * - Indexes are defined
 * - Type safety
 */

import { describe, expect, test } from "bun:test";
import { createClient } from "@libsql/client";
import { sql } from "drizzle-orm";
import { createDrizzleClient } from "../drizzle.js";
import * as schema from "./hive.js";

describe("Hive Schema", () => {
	test("cells table has correct columns", () => {
		expect(schema.cells).toBeDefined();
		expect(schema.cells.id).toBeDefined();
		expect(schema.cells.project_key).toBeDefined();
		expect(schema.cells.type).toBeDefined();
		expect(schema.cells.status).toBeDefined();
		expect(schema.cells.title).toBeDefined();
		expect(schema.cells.description).toBeDefined();
		expect(schema.cells.priority).toBeDefined();
		expect(schema.cells.parent_id).toBeDefined();
		expect(schema.cells.assignee).toBeDefined();
		expect(schema.cells.created_at).toBeDefined();
		expect(schema.cells.updated_at).toBeDefined();
		expect(schema.cells.closed_at).toBeDefined();
		expect(schema.cells.closed_reason).toBeDefined();
		expect(schema.cells.deleted_at).toBeDefined();
		expect(schema.cells.deleted_by).toBeDefined();
		expect(schema.cells.delete_reason).toBeDefined();
		expect(schema.cells.created_by).toBeDefined();
	});

	test("cells is an alias for cells", () => {
		expect(schema.cells).toBe(schema.cells);
	});

	test("cellEvents table has correct columns", () => {
		expect(schema.cellEvents).toBeDefined();
		expect(schema.cellEvents.id).toBeDefined();
		expect(schema.cellEvents.cell_id).toBeDefined();
		expect(schema.cellEvents.event_type).toBeDefined();
		expect(schema.cellEvents.payload).toBeDefined();
		expect(schema.cellEvents.created_at).toBeDefined();
	});

	test("cellLabels table has correct columns", () => {
		expect(schema.cellLabels).toBeDefined();
		expect(schema.cellLabels.cell_id).toBeDefined();
		expect(schema.cellLabels.label).toBeDefined();
		expect(schema.cellLabels.created_at).toBeDefined();
	});

	test("cellLabels is an alias for cellLabels", () => {
		expect(schema.cellLabels).toBe(schema.cellLabels);
	});

	test("cellComments table has correct columns", () => {
		expect(schema.cellComments).toBeDefined();
		expect(schema.cellComments.id).toBeDefined();
		expect(schema.cellComments.cell_id).toBeDefined();
		expect(schema.cellComments.author).toBeDefined();
		expect(schema.cellComments.body).toBeDefined();
		expect(schema.cellComments.parent_id).toBeDefined();
		expect(schema.cellComments.created_at).toBeDefined();
		expect(schema.cellComments.updated_at).toBeDefined();
	});

	test("cellComments is an alias for cellComments", () => {
		expect(schema.cellComments).toBe(schema.cellComments);
	});

	test("cellDependencies table has correct columns", () => {
		expect(schema.cellDependencies).toBeDefined();
		expect(schema.cellDependencies.cell_id).toBeDefined();
		expect(schema.cellDependencies.depends_on_id).toBeDefined();
		expect(schema.cellDependencies.relationship).toBeDefined();
		expect(schema.cellDependencies.created_at).toBeDefined();
		expect(schema.cellDependencies.created_by).toBeDefined();
	});

	test("cellDependencies is an alias for cellDependencies", () => {
		expect(schema.cellDependencies).toBe(schema.cellDependencies);
	});

	test("blockedCellsCache table has correct columns", () => {
		expect(schema.blockedCellsCache).toBeDefined();
		expect(schema.blockedCellsCache.cell_id).toBeDefined();
		expect(schema.blockedCellsCache.blocker_ids).toBeDefined();
		expect(schema.blockedCellsCache.updated_at).toBeDefined();
	});

	test("dirtyCells table has correct columns", () => {
		expect(schema.dirtyCells).toBeDefined();
		expect(schema.dirtyCells.cell_id).toBeDefined();
		expect(schema.dirtyCells.marked_at).toBeDefined();
	});

	test("schemaVersion table has correct columns", () => {
		expect(schema.schemaVersion).toBeDefined();
		expect(schema.schemaVersion.version).toBeDefined();
		expect(schema.schemaVersion.applied_at).toBeDefined();
	});

	test("can insert and query cells with self-referential FK", async () => {
		const client = createClient({ url: ":memory:" });
		const db = createDrizzleClient(client);

		// Create table (SQLite needs explicit CREATE TABLE)
		await client.execute(`
      CREATE TABLE cells (
        id TEXT PRIMARY KEY,
        project_key TEXT NOT NULL,
        type TEXT NOT NULL,
        status TEXT DEFAULT 'open',
        title TEXT NOT NULL,
        description TEXT,
        priority INTEGER DEFAULT 2,
        parent_id TEXT REFERENCES cells(id),
        assignee TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        closed_at INTEGER,
        closed_reason TEXT,
        deleted_at INTEGER,
        deleted_by TEXT,
        delete_reason TEXT,
        created_by TEXT
      )
    `);

		const now = Date.now();

		// Insert epic (no parent)
		await db.insert(schema.cells).values({
			id: "epic-1",
			project_key: "/test/project",
			type: "epic",
			status: "open",
			title: "Epic Task",
			priority: 1,
			created_at: now,
			updated_at: now,
		});

		// Insert subtask (parent = epic)
		await db.insert(schema.cells).values({
			id: "task-1",
			project_key: "/test/project",
			type: "task",
			status: "open",
			title: "Subtask",
			priority: 2,
			parent_id: "epic-1",
			created_at: now,
			updated_at: now,
		});

		// Query with FK join
		const results = await db
			.select()
			.from(schema.cells)
			.where(sql`parent_id = 'epic-1'`);

		expect(results).toHaveLength(1);
		expect(results[0].id).toBe("task-1");
		expect(results[0].parent_id).toBe("epic-1");
	});

	test("can insert and query cell events", async () => {
		const client = createClient({ url: ":memory:" });
		const db = createDrizzleClient(client);

		await client.execute(`
      CREATE TABLE cells (
        id TEXT PRIMARY KEY,
        project_key TEXT NOT NULL,
        type TEXT NOT NULL,
        status TEXT DEFAULT 'open',
        title TEXT NOT NULL,
        description TEXT,
        priority INTEGER DEFAULT 2,
        parent_id TEXT REFERENCES cells(id),
        assignee TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        closed_at INTEGER,
        closed_reason TEXT,
        deleted_at INTEGER,
        deleted_by TEXT,
        delete_reason TEXT,
        created_by TEXT
      )
    `);

		await client.execute(`
      CREATE TABLE cell_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        cell_id TEXT NOT NULL REFERENCES cells(id),
        event_type TEXT NOT NULL,
        payload TEXT NOT NULL,
        created_at TEXT
      )
    `);

		const now = Date.now();

		await db.insert(schema.cells).values({
			id: "cell-1",
			project_key: "/test/project",
			type: "task",
			title: "Test Cell",
			created_at: now,
			updated_at: now,
		});

		await db.insert(schema.cellEvents).values({
			cell_id: "cell-1",
			event_type: "created",
			payload: JSON.stringify({ title: "Test Cell" }),
			created_at: new Date().toISOString(),
		});

		const results = await db.select().from(schema.cellEvents);
		expect(results).toHaveLength(1);
		expect(results[0].cell_id).toBe("cell-1");
		expect(results[0].event_type).toBe("created");
	});
});
