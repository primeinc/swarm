/**
 * Memory Schema Overhaul Migration Tests
 *
 * Tests migration v10 applying on top of v9 base schema
 */

import { describe, expect, test } from "bun:test";
import { createClient } from "@libsql/client";
import {
	memoryMigrationLibSQL,
	memorySchemaOverhaulLibSQL,
} from "./migrations.js";

describe("Memory Schema Overhaul Migration v10", () => {
	test("migration v10 applies successfully after v9", async () => {
		const db = createClient({ url: ":memory:" });

		// Apply v9 base migration first (use executeMultiple for multi-statement SQL)
		await db.executeMultiple(memoryMigrationLibSQL.up);

		// Verify v9 created memories table
		let tables = await db.execute(`
      SELECT name FROM sqlite_master WHERE type='table' AND name='memories'
    `);
		expect(tables.rows.length).toBe(1);

		// Apply v10 migration (use executeMultiple for ALTER TABLE + CREATE TABLE statements)
		await db.executeMultiple(memorySchemaOverhaulLibSQL.up);

		// Verify new tables exist
		tables = await db.execute(`
      SELECT name FROM sqlite_master 
      WHERE type='table' AND name IN ('memory_links', 'entities', 'relationships', 'memory_entities')
    `);
		expect(tables.rows.length).toBe(4);

		// Verify new columns on memories table
		const columns = await db.execute(`
      SELECT name FROM pragma_table_info('memories')
    `);
		const columnNames = columns.rows.map((r) => r.name as string);
		expect(columnNames).toContain("valid_from");
		expect(columnNames).toContain("valid_until");
		expect(columnNames).toContain("superseded_by");
		expect(columnNames).toContain("auto_tags");
		expect(columnNames).toContain("keywords");
	});

	test("migration v10 preserves existing memories data", async () => {
		const db = createClient({ url: ":memory:" });

		// Apply v9
		await db.executeMultiple(memoryMigrationLibSQL.up);

		// Insert test memory
		await db.execute({
			sql: "INSERT INTO memories (id, content) VALUES (?, ?)",
			args: ["mem-1", "Original memory before migration"],
		});

		// Apply v10 migration
		await db.executeMultiple(memorySchemaOverhaulLibSQL.up);

		// Verify data still exists
		const result = await db.execute("SELECT * FROM memories WHERE id = ?", [
			"mem-1",
		]);
		expect(result.rows.length).toBe(1);
		expect(result.rows[0].content).toBe("Original memory before migration");

		// Verify new columns are NULL for existing rows
		expect(result.rows[0].valid_from).toBeNull();
		expect(result.rows[0].valid_until).toBeNull();
		expect(result.rows[0].superseded_by).toBeNull();
		expect(result.rows[0].auto_tags).toBeNull();
		expect(result.rows[0].keywords).toBeNull();
	});

	test("can use new schema features after migration", async () => {
		const db = createClient({ url: ":memory:" });

		// Apply both migrations
		await db.executeMultiple(memoryMigrationLibSQL.up);
		await db.executeMultiple(memorySchemaOverhaulLibSQL.up);
		await db.execute("PRAGMA foreign_keys = ON");

		// Insert memories
		await db.execute({
			sql: "INSERT INTO memories (id, content) VALUES (?, ?)",
			args: ["mem-1", "First memory"],
		});
		await db.execute({
			sql: "INSERT INTO memories (id, content) VALUES (?, ?)",
			args: ["mem-2", "Second memory"],
		});

		// Create memory link
		await db.execute({
			sql: `INSERT INTO memory_links (id, source_id, target_id, link_type) VALUES (?, ?, ?, ?)`,
			args: ["link-1", "mem-1", "mem-2", "related"],
		});

		// Create entity
		await db.execute({
			sql: "INSERT INTO entities (id, name, entity_type) VALUES (?, ?, ?)",
			args: ["ent-1", "Joel", "person"],
		});

		// Link memory to entity
		await db.execute({
			sql: "INSERT INTO memory_entities (memory_id, entity_id, role) VALUES (?, ?, ?)",
			args: ["mem-1", "ent-1", "subject"],
		});

		// Create relationship
		await db.execute({
			sql: "INSERT INTO entities (id, name, entity_type) VALUES (?, ?, ?)",
			args: ["ent-2", "TypeScript", "technology"],
		});
		await db.execute({
			sql: `INSERT INTO relationships (id, subject_id, predicate, object_id, memory_id) 
            VALUES (?, ?, ?, ?, ?)`,
			args: ["rel-1", "ent-1", "prefers", "ent-2", "mem-1"],
		});

		// Verify everything was created
		const links = await db.execute("SELECT * FROM memory_links WHERE id = ?", [
			"link-1",
		]);
		expect(links.rows.length).toBe(1);

		const entities = await db.execute("SELECT * FROM entities");
		expect(entities.rows.length).toBe(2);

		const relationships = await db.execute(
			"SELECT * FROM relationships WHERE id = ?",
			["rel-1"],
		);
		expect(relationships.rows.length).toBe(1);

		const memoryEntities = await db.execute("SELECT * FROM memory_entities");
		expect(memoryEntities.rows.length).toBe(1);
	});

	test("migration v10 down removes new tables", async () => {
		const db = createClient({ url: ":memory:" });

		// Apply migrations up
		await db.executeMultiple(memoryMigrationLibSQL.up);
		await db.executeMultiple(memorySchemaOverhaulLibSQL.up);

		// Verify tables exist
		let tables = await db.execute(`
      SELECT name FROM sqlite_master 
      WHERE type='table' AND name IN ('memory_links', 'entities', 'relationships', 'memory_entities')
    `);
		expect(tables.rows.length).toBe(4);

		// Disable foreign keys for clean drop
		await db.execute("PRAGMA foreign_keys = OFF");

		// Apply migration down
		await db.executeMultiple(memorySchemaOverhaulLibSQL.down);

		// Verify tables removed
		tables = await db.execute(`
      SELECT name FROM sqlite_master 
      WHERE type='table' AND name IN ('memory_links', 'entities', 'relationships', 'memory_entities')
    `);
		expect(tables.rows.length).toBe(0);

		// Verify memories table still exists
		tables = await db.execute(`
      SELECT name FROM sqlite_master WHERE type='table' AND name='memories'
    `);
		expect(tables.rows.length).toBe(1);
	});
});
