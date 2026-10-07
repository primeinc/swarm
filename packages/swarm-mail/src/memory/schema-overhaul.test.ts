/**
 * Memory Schema Overhaul Tests
 *
 * TDD: Write failing tests first for new schema tables
 *
 * Test coverage:
 * - memory_links table creation
 * - entities table creation
 * - relationships table creation
 * - memory_entities junction table
 * - ALTER TABLE migrations for temporal fields
 * - Foreign key constraints
 * - Unique constraints
 */

import { describe, expect, test } from "bun:test";
import { createClient } from "@libsql/client";
import {
	createLibSQLMemorySchema,
	dropLibSQLMemorySchema,
} from "./libsql-schema.js";

describe("Memory Schema Overhaul - New Tables", () => {
	test("creates memory_links table with bidirectional link support", async () => {
		const db = createClient({ url: ":memory:" });

		await createLibSQLMemorySchema(db);

		// Verify memory_links table exists with correct columns
		const result = await db.execute(`
      SELECT name, type FROM pragma_table_info('memory_links')
      ORDER BY name
    `);

		const columns = result.rows.map((r) => ({
			name: r.name as string,
			type: r.type as string,
		}));

		// Check for required columns
		expect(columns).toContainEqual({ name: "id", type: "TEXT" });
		expect(columns).toContainEqual({ name: "source_id", type: "TEXT" });
		expect(columns).toContainEqual({ name: "target_id", type: "TEXT" });
		expect(columns).toContainEqual({ name: "link_type", type: "TEXT" });
		expect(columns).toContainEqual({ name: "strength", type: "REAL" });
		expect(columns).toContainEqual({ name: "created_at", type: "TEXT" });
	});

	test("memory_links has foreign key constraints to memories table", async () => {
		const db = createClient({ url: ":memory:" });

		await createLibSQLMemorySchema(db);

		// Get foreign key info
		const fks = await db.execute(`
      SELECT "from", "to", "table", on_delete 
      FROM pragma_foreign_key_list('memory_links')
    `);

		// Should have 2 FKs: source_id and target_id both pointing to memories(id)
		expect(fks.rows.length).toBe(2);

		const fkList = fks.rows.map((r) => ({
			from: r.from as string,
			to: r.to as string,
			table: r.table as string,
			on_delete: r.on_delete as string,
		}));

		expect(fkList).toContainEqual({
			from: "source_id",
			to: "id",
			table: "memories",
			on_delete: "CASCADE",
		});
		expect(fkList).toContainEqual({
			from: "target_id",
			to: "id",
			table: "memories",
			on_delete: "CASCADE",
		});
	});

	test("memory_links CASCADE deletes when source memory is deleted", async () => {
		const db = createClient({ url: ":memory:" });

		await createLibSQLMemorySchema(db);

		// Enable foreign keys
		await db.execute("PRAGMA foreign_keys = ON");

		// Insert two memories
		await db.execute({
			sql: "INSERT INTO memories (id, content) VALUES (?, ?)",
			args: ["mem-1", "Source memory"],
		});
		await db.execute({
			sql: "INSERT INTO memories (id, content) VALUES (?, ?)",
			args: ["mem-2", "Target memory"],
		});

		// Create a link
		await db.execute({
			sql: `INSERT INTO memory_links (id, source_id, target_id, link_type) 
            VALUES (?, ?, ?, ?)`,
			args: ["link-1", "mem-1", "mem-2", "related"],
		});

		// Verify link exists
		let links = await db.execute("SELECT * FROM memory_links WHERE id = ?", [
			"link-1",
		]);
		expect(links.rows.length).toBe(1);

		// Delete source memory
		await db.execute("DELETE FROM memories WHERE id = ?", ["mem-1"]);

		// Link should be cascade deleted
		links = await db.execute("SELECT * FROM memory_links WHERE id = ?", [
			"link-1",
		]);
		expect(links.rows.length).toBe(0);
	});

	test("memory_links unique constraint prevents duplicate links", async () => {
		const db = createClient({ url: ":memory:" });

		await createLibSQLMemorySchema(db);
		await db.execute("PRAGMA foreign_keys = ON");

		// Insert two memories
		await db.execute({
			sql: "INSERT INTO memories (id, content) VALUES (?, ?)",
			args: ["mem-1", "Source"],
		});
		await db.execute({
			sql: "INSERT INTO memories (id, content) VALUES (?, ?)",
			args: ["mem-2", "Target"],
		});

		// Create first link
		await db.execute({
			sql: `INSERT INTO memory_links (id, source_id, target_id, link_type) 
            VALUES (?, ?, ?, ?)`,
			args: ["link-1", "mem-1", "mem-2", "related"],
		});

		// Attempt to create duplicate link (same source, target, link_type)
		await expect(async () => {
			await db.execute({
				sql: `INSERT INTO memory_links (id, source_id, target_id, link_type) 
              VALUES (?, ?, ?, ?)`,
				args: ["link-2", "mem-1", "mem-2", "related"],
			});
		}).toThrow();
	});

	test("memory_links has indexes on source_id and target_id", async () => {
		const db = createClient({ url: ":memory:" });

		await createLibSQLMemorySchema(db);

		const indexes = await db.execute(`
      SELECT name FROM sqlite_master 
      WHERE type='index' AND tbl_name='memory_links'
    `);

		const indexNames = indexes.rows.map((r) => r.name as string);
		expect(indexNames).toContain("idx_memory_links_source");
		expect(indexNames).toContain("idx_memory_links_target");
	});

	test("creates entities table with entity type support", async () => {
		const db = createClient({ url: ":memory:" });

		await createLibSQLMemorySchema(db);

		const result = await db.execute(`
      SELECT name, type FROM pragma_table_info('entities')
      ORDER BY name
    `);

		const columns = result.rows.map((r) => ({
			name: r.name as string,
			type: r.type as string,
		}));

		expect(columns).toContainEqual({ name: "id", type: "TEXT" });
		expect(columns).toContainEqual({ name: "name", type: "TEXT" });
		expect(columns).toContainEqual({ name: "entity_type", type: "TEXT" });
		expect(columns).toContainEqual({ name: "canonical_name", type: "TEXT" });
		expect(columns).toContainEqual({ name: "created_at", type: "TEXT" });
		expect(columns).toContainEqual({ name: "updated_at", type: "TEXT" });
	});

	test("entities has unique constraint on (name, entity_type)", async () => {
		const db = createClient({ url: ":memory:" });

		await createLibSQLMemorySchema(db);

		// Insert first entity
		await db.execute({
			sql: `INSERT INTO entities (id, name, entity_type) VALUES (?, ?, ?)`,
			args: ["ent-1", "Joel", "person"],
		});

		// Attempt duplicate
		await expect(async () => {
			await db.execute({
				sql: `INSERT INTO entities (id, name, entity_type) VALUES (?, ?, ?)`,
				args: ["ent-2", "Joel", "person"],
			});
		}).toThrow();

		// Same name, different type should work
		await db.execute({
			sql: `INSERT INTO entities (id, name, entity_type) VALUES (?, ?, ?)`,
			args: ["ent-3", "Joel", "project"],
		});
	});

	test("entities has indexes on entity_type and name", async () => {
		const db = createClient({ url: ":memory:" });

		await createLibSQLMemorySchema(db);

		const indexes = await db.execute(`
      SELECT name FROM sqlite_master 
      WHERE type='index' AND tbl_name='entities'
    `);

		const indexNames = indexes.rows.map((r) => r.name as string);
		expect(indexNames).toContain("idx_entities_type");
		expect(indexNames).toContain("idx_entities_name");
	});

	test("creates relationships table with subject-predicate-object triples", async () => {
		const db = createClient({ url: ":memory:" });

		await createLibSQLMemorySchema(db);

		const result = await db.execute(`
      SELECT name, type FROM pragma_table_info('relationships')
      ORDER BY name
    `);

		const columns = result.rows.map((r) => ({
			name: r.name as string,
			type: r.type as string,
		}));

		expect(columns).toContainEqual({ name: "id", type: "TEXT" });
		expect(columns).toContainEqual({ name: "subject_id", type: "TEXT" });
		expect(columns).toContainEqual({ name: "predicate", type: "TEXT" });
		expect(columns).toContainEqual({ name: "object_id", type: "TEXT" });
		expect(columns).toContainEqual({ name: "memory_id", type: "TEXT" });
		expect(columns).toContainEqual({ name: "confidence", type: "REAL" });
		expect(columns).toContainEqual({ name: "created_at", type: "TEXT" });
	});

	test("relationships has foreign keys to entities and memories", async () => {
		const db = createClient({ url: ":memory:" });

		await createLibSQLMemorySchema(db);

		const fks = await db.execute(`
      SELECT "from", "to", "table", on_delete 
      FROM pragma_foreign_key_list('relationships')
    `);

		expect(fks.rows.length).toBe(3);

		const fkList = fks.rows.map((r) => ({
			from: r.from as string,
			to: r.to as string,
			table: r.table as string,
			on_delete: r.on_delete as string,
		}));

		expect(fkList).toContainEqual({
			from: "subject_id",
			to: "id",
			table: "entities",
			on_delete: "CASCADE",
		});
		expect(fkList).toContainEqual({
			from: "object_id",
			to: "id",
			table: "entities",
			on_delete: "CASCADE",
		});
		expect(fkList).toContainEqual({
			from: "memory_id",
			to: "id",
			table: "memories",
			on_delete: "SET NULL",
		});
	});

	test("relationships has indexes on subject, object, and predicate", async () => {
		const db = createClient({ url: ":memory:" });

		await createLibSQLMemorySchema(db);

		const indexes = await db.execute(`
      SELECT name FROM sqlite_master 
      WHERE type='index' AND tbl_name='relationships'
    `);

		const indexNames = indexes.rows.map((r) => r.name as string);
		expect(indexNames).toContain("idx_relationships_subject");
		expect(indexNames).toContain("idx_relationships_object");
		expect(indexNames).toContain("idx_relationships_predicate");
	});

	test("creates memory_entities junction table", async () => {
		const db = createClient({ url: ":memory:" });

		await createLibSQLMemorySchema(db);

		const result = await db.execute(`
      SELECT name, type FROM pragma_table_info('memory_entities')
      ORDER BY name
    `);

		const columns = result.rows.map((r) => ({
			name: r.name as string,
			type: r.type as string,
		}));

		expect(columns).toContainEqual({ name: "memory_id", type: "TEXT" });
		expect(columns).toContainEqual({ name: "entity_id", type: "TEXT" });
		expect(columns).toContainEqual({ name: "role", type: "TEXT" });
	});

	test("memory_entities has composite primary key", async () => {
		const db = createClient({ url: ":memory:" });

		await createLibSQLMemorySchema(db);
		await db.execute("PRAGMA foreign_keys = ON");

		// Insert memory and entity
		await db.execute({
			sql: "INSERT INTO memories (id, content) VALUES (?, ?)",
			args: ["mem-1", "Test"],
		});
		await db.execute({
			sql: "INSERT INTO entities (id, name, entity_type) VALUES (?, ?, ?)",
			args: ["ent-1", "Joel", "person"],
		});

		// Insert first association
		await db.execute({
			sql: `INSERT INTO memory_entities (memory_id, entity_id, role) VALUES (?, ?, ?)`,
			args: ["mem-1", "ent-1", "subject"],
		});

		// Duplicate should fail
		await expect(async () => {
			await db.execute({
				sql: `INSERT INTO memory_entities (memory_id, entity_id, role) VALUES (?, ?, ?)`,
				args: ["mem-1", "ent-1", "object"], // Same memory_id + entity_id
			});
		}).toThrow();
	});
});

describe("Memory Schema Overhaul - Temporal Fields", () => {
	test("memories table has valid_from column", async () => {
		const db = createClient({ url: ":memory:" });

		await createLibSQLMemorySchema(db);

		const result = await db.execute(`
      SELECT name, type FROM pragma_table_info('memories')
      WHERE name = 'valid_from'
    `);

		expect(result.rows.length).toBe(1);
		expect(result.rows[0].type).toBe("TEXT");
	});

	test("memories table has valid_until column", async () => {
		const db = createClient({ url: ":memory:" });

		await createLibSQLMemorySchema(db);

		const result = await db.execute(`
      SELECT name, type FROM pragma_table_info('memories')
      WHERE name = 'valid_until'
    `);

		expect(result.rows.length).toBe(1);
		expect(result.rows[0].type).toBe("TEXT");
	});

	test("memories table has superseded_by column", async () => {
		const db = createClient({ url: ":memory:" });

		await createLibSQLMemorySchema(db);

		const result = await db.execute(`
      SELECT name, type FROM pragma_table_info('memories')
      WHERE name = 'superseded_by'
    `);

		expect(result.rows.length).toBe(1);
		expect(result.rows[0].type).toBe("TEXT");
	});

	test("superseded_by has foreign key to memories(id)", async () => {
		const db = createClient({ url: ":memory:" });

		await createLibSQLMemorySchema(db);

		const fks = await db.execute(`
      SELECT "from", "to", "table" 
      FROM pragma_foreign_key_list('memories')
      WHERE "from" = 'superseded_by'
    `);

		expect(fks.rows.length).toBe(1);
		expect(fks.rows[0].to).toBe("id");
		expect(fks.rows[0].table).toBe("memories");
	});

	test("memories table has auto_tags column", async () => {
		const db = createClient({ url: ":memory:" });

		await createLibSQLMemorySchema(db);

		const result = await db.execute(`
      SELECT name, type FROM pragma_table_info('memories')
      WHERE name = 'auto_tags'
    `);

		expect(result.rows.length).toBe(1);
		expect(result.rows[0].type).toBe("TEXT"); // JSON array as TEXT
	});

	test("memories table has keywords column", async () => {
		const db = createClient({ url: ":memory:" });

		await createLibSQLMemorySchema(db);

		const result = await db.execute(`
      SELECT name, type FROM pragma_table_info('memories')
      WHERE name = 'keywords'
    `);

		expect(result.rows.length).toBe(1);
		expect(result.rows[0].type).toBe("TEXT");
	});

	test("can insert memory with temporal validity window", async () => {
		const db = createClient({ url: ":memory:" });

		await createLibSQLMemorySchema(db);

		const validFrom = new Date("2025-01-01").toISOString();
		const validUntil = new Date("2025-12-31").toISOString();

		await db.execute({
			sql: `INSERT INTO memories (id, content, valid_from, valid_until) 
            VALUES (?, ?, ?, ?)`,
			args: ["mem-1", "Time-bounded memory", validFrom, validUntil],
		});

		const result = await db.execute("SELECT * FROM memories WHERE id = ?", [
			"mem-1",
		]);
		expect(result.rows[0].valid_from).toBe(validFrom);
		expect(result.rows[0].valid_until).toBe(validUntil);
	});

	test("can create memory supersession chain", async () => {
		const db = createClient({ url: ":memory:" });

		await createLibSQLMemorySchema(db);
		await db.execute("PRAGMA foreign_keys = ON");

		// Insert original memory
		await db.execute({
			sql: "INSERT INTO memories (id, content) VALUES (?, ?)",
			args: ["mem-1", "Original"],
		});

		// Insert superseding memory
		await db.execute({
			sql: "INSERT INTO memories (id, content) VALUES (?, ?)",
			args: ["mem-2", "Updated version"],
		});

		// Link them
		await db.execute({
			sql: "UPDATE memories SET superseded_by = ? WHERE id = ?",
			args: ["mem-2", "mem-1"],
		});

		const result = await db.execute(
			"SELECT superseded_by FROM memories WHERE id = ?",
			["mem-1"],
		);
		expect(result.rows[0].superseded_by).toBe("mem-2");
	});
});

describe("Memory Schema Overhaul - Cleanup", () => {
	test("dropLibSQLMemorySchema removes all new tables", async () => {
		const db = createClient({ url: ":memory:" });

		await createLibSQLMemorySchema(db);

		// Verify new tables exist
		let tables = await db.execute(`
      SELECT name FROM sqlite_master 
      WHERE type='table' AND name IN ('memory_links', 'entities', 'relationships', 'memory_entities')
    `);
		expect(tables.rows.length).toBe(4);

		await dropLibSQLMemorySchema(db);

		// Verify they're gone
		tables = await db.execute(`
      SELECT name FROM sqlite_master 
      WHERE type='table' AND name IN ('memory_links', 'entities', 'relationships', 'memory_entities')
    `);
		expect(tables.rows.length).toBe(0);
	});
});
