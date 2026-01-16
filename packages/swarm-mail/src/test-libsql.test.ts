import { describe, expect, test } from "bun:test";
import { createClient } from "@libsql/client";
import { convertPlaceholders } from "./libsql.js";
import {
	createTestDatabaseAdapter,
	createTestLibSQLDb,
} from "./test-libsql.js";

describe("createTestLibSQLDb", () => {
	test("creates database with all tables", async () => {
		const { client } = await createTestLibSQLDb();

		// Verify some key tables exist
		const tables = await client.execute(`
      SELECT name FROM sqlite_master 
      WHERE type='table' 
      ORDER BY name
    `);

		const tableNames = tables.rows.map((r) => r.name as string);

		// Check streams tables
		expect(tableNames).toContain("events");
		expect(tableNames).toContain("agents");
		expect(tableNames).toContain("messages");
		expect(tableNames).toContain("reservations");

		// Check hive tables
		expect(tableNames).toContain("cells");
		expect(tableNames).toContain("cell_dependencies");

		// Check memory tables
		expect(tableNames).toContain("memories");

		// Check learning tables
		expect(tableNames).toContain("eval_records");
		expect(tableNames).toContain("swarm_contexts");
	});

	test("can insert and query via client", async () => {
		const { client } = await createTestLibSQLDb();

		await client.execute({
			sql: "INSERT INTO agents (project_key, name, registered_at, last_active_at) VALUES (?, ?, ?, ?)",
			args: ["test", "TestAgent", Date.now(), Date.now()],
		});

		const result = await client.execute(
			"SELECT * FROM agents WHERE name = 'TestAgent'",
		);
		expect(result.rows.length).toBe(1);
		expect(result.rows[0].name).toBe("TestAgent");
	});

	test("returns adapter with PostgreSQL param conversion", async () => {
		const { adapter } = await createTestLibSQLDb();

		// Insert using adapter (no params, just verifying exec works)
		const now = Date.now();
		await adapter.exec(`
      INSERT INTO agents (project_key, name, registered_at, last_active_at) 
      VALUES ('test', 'ConvertAgent', ${now}, ${now})
    `);

		// Query with PostgreSQL $1 syntax - adapter should auto-convert to ?
		const result = await adapter.query("SELECT * FROM agents WHERE name = $1", [
			"ConvertAgent",
		]);

		expect(result.rows).toHaveLength(1);
		expect(result.rows[0].name).toBe("ConvertAgent");

		await adapter.close();
	});
});

describe("convertPlaceholders", () => {
	test("converts PostgreSQL $N to SQLite ?", () => {
		const result = convertPlaceholders(
			"SELECT * FROM cells WHERE id = $1 AND status = $2",
			["bd-123", "open"],
		);

		expect(result.sql).toBe("SELECT * FROM cells WHERE id = ? AND status = ?");
		expect(result.params).toEqual(["bd-123", "open"]);
	});

	test("expands params for reused placeholders", () => {
		const result = convertPlaceholders("INSERT INTO test VALUES ($1, $2, $1)", [
			"a",
			"b",
		]);

		expect(result.sql).toBe("INSERT INTO test VALUES (?, ?, ?)");
		expect(result.params).toEqual(["a", "b", "a"]);
	});

	test("passes through SQLite ? placeholders unchanged", () => {
		const result = convertPlaceholders("SELECT * FROM test WHERE id = ?", [
			"123",
		]);

		expect(result.sql).toBe("SELECT * FROM test WHERE id = ?");
		expect(result.params).toEqual(["123"]);
	});

	// ANY() → IN() conversion tests (PostgreSQL → SQLite compatibility)
	test("converts ANY($N) with array to IN (?, ?, ...)", () => {
		const result = convertPlaceholders(
			"SELECT * FROM events WHERE type = ANY($1)",
			[["agent_registered", "message_sent", "file_reserved"]],
		);

		expect(result.sql).toBe("SELECT * FROM events WHERE type IN (?, ?, ?)");
		expect(result.params).toEqual([
			"agent_registered",
			"message_sent",
			"file_reserved",
		]);
	});

	test("converts = ANY($N) to IN (?, ?, ...)", () => {
		const result = convertPlaceholders(
			"UPDATE reservations SET released_at = $1 WHERE id = ANY($2)",
			[Date.now(), [1, 2, 3]],
		);

		expect(result.sql).toBe(
			"UPDATE reservations SET released_at = ? WHERE id IN (?, ?, ?)",
		);
		expect(result.params).toEqual([result.params![0], 1, 2, 3]);
	});

	test("handles multiple ANY() in same query", () => {
		const result = convertPlaceholders(
			"DELETE FROM reservations WHERE project_key = $1 AND agent_name = $2 AND path_pattern = ANY($3)",
			["proj-1", "TestAgent", ["src/**", "lib/**"]],
		);

		expect(result.sql).toBe(
			"DELETE FROM reservations WHERE project_key = ? AND agent_name = ? AND path_pattern IN (?, ?)",
		);
		expect(result.params).toEqual(["proj-1", "TestAgent", "src/**", "lib/**"]);
	});

	test("handles empty array in ANY() gracefully", () => {
		const result = convertPlaceholders(
			"SELECT * FROM events WHERE type = ANY($1)",
			[[]],
		);

		// Empty array should produce a subquery that returns no rows (always false)
		expect(result.sql).toBe(
			"SELECT * FROM events WHERE type IN (SELECT 1 WHERE 0)",
		);
		expect(result.params).toEqual([]);
	});

	test("handles single-element array in ANY()", () => {
		const result = convertPlaceholders(
			"SELECT * FROM events WHERE type = ANY($1)",
			[["agent_registered"]],
		);

		expect(result.sql).toBe("SELECT * FROM events WHERE type IN (?)");
		expect(result.params).toEqual(["agent_registered"]);
	});
});

describe("createTestDatabaseAdapter", () => {
	test("auto-converts $N params in queries", async () => {
		const client = createClient({ url: ":memory:" });
		await client.execute("CREATE TABLE test (id TEXT, status TEXT)");
		await client.execute("INSERT INTO test VALUES ('bd-123', 'open')");

		const adapter = createTestDatabaseAdapter(client);

		// PostgreSQL syntax - should convert automatically
		const result = await adapter.query("SELECT * FROM test WHERE id = $1", [
			"bd-123",
		]);

		expect(result.rows).toHaveLength(1);
		expect(result.rows[0].id).toBe("bd-123");
		expect(result.rows[0].status).toBe("open");

		await adapter.close();
	});
});
