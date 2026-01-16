/**
 * libSQL Memory Schema Tests
 *
 * TDD: Write failing tests first, then implement schema
 *
 * Test coverage:
 * - Schema creation with F32_BLOB vector column
 * - FTS5 virtual table setup
 * - Index creation (vector and standard)
 * - Schema validation
 */

import { describe, expect, test } from "bun:test";
import { createClient } from "@libsql/client";
import {
	createLibSQLMemorySchema,
	dropLibSQLMemorySchema,
	EMBEDDING_DIM,
	validateLibSQLMemorySchema,
} from "./libsql-schema.js";

describe("libSQL Memory Schema", () => {
	test("creates memories table with F32_BLOB vector column", async () => {
		const db = createClient({ url: ":memory:" });

		await createLibSQLMemorySchema(db);

		// Verify memories table exists with correct columns
		const result = await db.execute(`
      SELECT name, type FROM pragma_table_info('memories')
      ORDER BY name
    `);

		const columns = result.rows.map((r) => ({
			name: r.name as string,
			type: r.type as string,
		}));

		// Check for required columns
		expect(columns).toContainEqual({ name: "id", type: "TEXT" });
		expect(columns).toContainEqual({ name: "content", type: "TEXT" });
		expect(columns).toContainEqual({ name: "metadata", type: "TEXT" }); // JSON stored as TEXT in SQLite
		expect(columns).toContainEqual({ name: "collection", type: "TEXT" });
		expect(columns).toContainEqual({ name: "tags", type: "TEXT" }); // JSON array stored as TEXT
		expect(columns).toContainEqual({ name: "created_at", type: "TEXT" }); // DATETIME stored as TEXT
		expect(columns).toContainEqual({ name: "updated_at", type: "TEXT" }); // DATETIME stored as TEXT
		expect(columns).toContainEqual({ name: "decay_factor", type: "REAL" });
		expect(columns).toContainEqual({
			name: "embedding",
			type: `F32_BLOB(${EMBEDDING_DIM})`,
		});
	});

	test("creates FTS5 virtual table for full-text search", async () => {
		const db = createClient({ url: ":memory:" });

		await createLibSQLMemorySchema(db);

		// Verify FTS5 table exists
		const result = await db.execute(`
      SELECT name FROM sqlite_master 
      WHERE type='table' AND name='memories_fts'
    `);

		expect(result.rows.length).toBe(1);
		expect(result.rows[0].name).toBe("memories_fts");
	});

	test("creates indexes for performance", async () => {
		const db = createClient({ url: ":memory:" });

		await createLibSQLMemorySchema(db);

		// Get all indexes
		const result = await db.execute(`
      SELECT name FROM sqlite_master 
      WHERE type='index' AND tbl_name='memories'
    `);

		const indexNames = result.rows.map((r) => r.name as string);

		// Should have collection index (vector index is implicit with F32_BLOB)
		expect(indexNames).toContain("idx_memories_collection");
	});

	test("schema is idempotent - can run multiple times", async () => {
		const db = createClient({ url: ":memory:" });

		// Run schema creation twice
		await createLibSQLMemorySchema(db);
		await createLibSQLMemorySchema(db);

		// Should not throw, should have same schema
		const result = await db.execute(`
      SELECT COUNT(*) as count FROM pragma_table_info('memories')
    `);

		expect(Number(result.rows[0].count)).toBeGreaterThan(0);
	});

	test("can insert memory with vector embedding", async () => {
		const db = createClient({ url: ":memory:" });

		await createLibSQLMemorySchema(db);

		// Create a test embedding
		const embedding = new Array(EMBEDDING_DIM).fill(0.5);

		// Insert memory with vector
		await db.execute({
			sql: `
        INSERT INTO memories (id, content, metadata, collection, created_at, decay_factor, embedding)
        VALUES (?, ?, ?, ?, ?, ?, vector(?))
      `,
			args: [
				"test-mem-1",
				"Test memory content",
				JSON.stringify({ tags: ["test"] }),
				"default",
				new Date().toISOString(),
				1.0,
				JSON.stringify(embedding),
			],
		});

		// Verify it was stored
		const result = await db.execute(
			"SELECT id, content FROM memories WHERE id = ?",
			["test-mem-1"],
		);
		expect(result.rows.length).toBe(1);
		expect(result.rows[0].content).toBe("Test memory content");
	});

	test("can perform vector similarity search", async () => {
		const db = createClient({ url: ":memory:" });

		await createLibSQLMemorySchema(db);

		// Insert two memories with different embeddings
		const embedding1 = new Array(EMBEDDING_DIM).fill(0.5);
		const embedding2 = new Array(EMBEDDING_DIM).fill(0.8);

		await db.execute({
			sql: `INSERT INTO memories (id, content, embedding) VALUES (?, ?, vector(?))`,
			args: ["mem-1", "First memory", JSON.stringify(embedding1)],
		});

		await db.execute({
			sql: `INSERT INTO memories (id, content, embedding) VALUES (?, ?, vector(?))`,
			args: ["mem-2", "Second memory", JSON.stringify(embedding2)],
		});

		// Search with a query embedding similar to embedding1
		const queryEmbedding = new Array(EMBEDDING_DIM).fill(0.51);
		const result = await db.execute({
			sql: `
        SELECT content, vector_distance_cos(embedding, vector(?)) as distance
        FROM memories
        ORDER BY distance ASC
        LIMIT 1
      `,
			args: [JSON.stringify(queryEmbedding)],
		});

		// Should return the first memory as closest match
		expect(result.rows.length).toBe(1);
		expect(result.rows[0].content).toBe("First memory");
		expect(Number(result.rows[0].distance)).toBeLessThan(0.1); // Very similar
	});

	test("FTS5 search works on memory content", async () => {
		const db = createClient({ url: ":memory:" });

		await createLibSQLMemorySchema(db);

		// Insert memories
		await db.execute({
			sql: "INSERT INTO memories (id, content) VALUES (?, ?)",
			args: ["mem-1", "OAuth authentication with JWT tokens"],
		});

		await db.execute({
			sql: "INSERT INTO memories (id, content) VALUES (?, ?)",
			args: ["mem-2", "React component lifecycle methods"],
		});

		// Search using FTS5
		const result = await db.execute(`
      SELECT m.content
      FROM memories_fts fts
      JOIN memories m ON m.id = fts.id
      WHERE memories_fts MATCH 'oauth'
    `);

		expect(result.rows.length).toBe(1);
		expect(result.rows[0].content).toBe("OAuth authentication with JWT tokens");
	});

	test("metadata is stored as JSON text", async () => {
		const db = createClient({ url: ":memory:" });

		await createLibSQLMemorySchema(db);

		const metadata = { tags: ["auth", "security"], source: "manual" };

		await db.execute({
			sql: "INSERT INTO memories (id, content, metadata) VALUES (?, ?, ?)",
			args: ["mem-1", "Test content", JSON.stringify(metadata)],
		});

		const result = await db.execute(
			"SELECT metadata FROM memories WHERE id = ?",
			["mem-1"],
		);

		// Parse JSON from TEXT field
		const stored = JSON.parse(result.rows[0].metadata as string);
		expect(stored).toEqual(metadata);
	});

	test("decay_factor defaults to 1.0", async () => {
		const db = createClient({ url: ":memory:" });

		await createLibSQLMemorySchema(db);

		await db.execute({
			sql: "INSERT INTO memories (id, content) VALUES (?, ?)",
			args: ["mem-1", "Test content"],
		});

		const result = await db.execute(
			"SELECT decay_factor FROM memories WHERE id = ?",
			["mem-1"],
		);
		expect(Number(result.rows[0].decay_factor)).toBe(1.0);
	});

	test("collection defaults to 'default'", async () => {
		const db = createClient({ url: ":memory:" });

		await createLibSQLMemorySchema(db);

		await db.execute({
			sql: "INSERT INTO memories (id, content) VALUES (?, ?)",
			args: ["mem-1", "Test content"],
		});

		const result = await db.execute(
			"SELECT collection FROM memories WHERE id = ?",
			["mem-1"],
		);
		expect(result.rows[0].collection).toBe("default");
	});

	test("validateLibSQLMemorySchema detects valid schema", async () => {
		const db = createClient({ url: ":memory:" });

		// Should be invalid before creation
		expect(await validateLibSQLMemorySchema(db)).toBe(false);

		// Should be valid after creation
		await createLibSQLMemorySchema(db);
		expect(await validateLibSQLMemorySchema(db)).toBe(true);
	});

	test("dropLibSQLMemorySchema removes all schema objects", async () => {
		const db = createClient({ url: ":memory:" });

		await createLibSQLMemorySchema(db);
		expect(await validateLibSQLMemorySchema(db)).toBe(true);

		await dropLibSQLMemorySchema(db);
		expect(await validateLibSQLMemorySchema(db)).toBe(false);
	});
});
