import { afterEach, describe, expect, test } from "bun:test";
import { DbClientFactory } from "./client-factory.js";
import { createDrizzleClient } from "./drizzle.js";

describe("Drizzle Client", () => {
	afterEach(async () => {
		await DbClientFactory.closeAll();
	});

	test("creates a Drizzle client from libSQL client", async () => {
		const managed = await DbClientFactory.getOrCreate(":memory:");
		const db = createDrizzleClient(managed.client);

		expect(db).toBeDefined();
		expect(typeof db.select).toBe("function");
		expect(typeof db.insert).toBe("function");
	});

	test("can execute basic query", async () => {
		const managed = await DbClientFactory.getOrCreate(":memory:");
		const libsqlClient = managed.client;
		// Create Drizzle client to verify it's created successfully
		createDrizzleClient(libsqlClient);

		// Create a simple table
		await libsqlClient.execute(
			"CREATE TABLE test (id INTEGER PRIMARY KEY, name TEXT)",
		);
		await libsqlClient.execute(
			"INSERT INTO test (id, name) VALUES (1, 'test')",
		);

		// Query using raw SQL to verify connection works
		const result = await libsqlClient.execute("SELECT * FROM test");

		expect(result.rows).toHaveLength(1);
		expect(result.rows[0].name).toBe("test");
	});
});
