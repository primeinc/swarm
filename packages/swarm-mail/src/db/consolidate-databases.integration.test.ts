/**
 * Database Consolidation Integration Tests
 *
 * End-to-end tests for stray database consolidation workflow.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLibSQLStreamsSchema } from "../streams/libsql-schema.js";
import { DbClientFactory } from "./client-factory.js";
import { consolidateDatabases } from "./consolidate-databases.js";
import { DbFileOps } from "./file-ops.js";

describe("Database Consolidation - Integration", () => {
	let testDir: string;
	let globalDbPath: string;

	beforeEach(async () => {
		testDir = join(tmpdir(), `consolidate-integration-${Date.now()}`);
		mkdirSync(testDir, { recursive: true });
		globalDbPath = join(testDir, "global.db");

		// Create global DB
		const managed = await DbClientFactory.getOrCreate(`file:${globalDbPath}`);
		await createLibSQLStreamsSchema(managed.adapter);
	});

	afterEach(async () => {
		await DbClientFactory.closeAll();
		if (existsSync(testDir)) {
			await DbFileOps.remove(testDir, { recursive: true });
		}
	});

	test("full consolidation workflow", async () => {
		// Create multiple stray DBs with real data
		const rootDb = join(testDir, ".opencode", "swarm.db");
		const hiveDb = join(testDir, ".hive", "swarm-mail.db");
		const pkgDb = join(testDir, "packages", "foo", ".opencode", "swarm.db");

		mkdirSync(join(testDir, ".opencode"), { recursive: true });
		mkdirSync(join(testDir, ".hive"), { recursive: true });
		mkdirSync(join(testDir, "packages", "foo", ".opencode"), {
			recursive: true,
		});

		// Populate root DB
		const managedRoot = await DbClientFactory.getOrCreate(`file:${rootDb}`);
		const rootDbAdapter = managedRoot.adapter;
		await createLibSQLStreamsSchema(rootDbAdapter);
		await rootDbAdapter.exec(`
      INSERT INTO events (type, project_key, timestamp, data)
      VALUES ('root_event', '${testDir}', ${Date.now()}, '{"source": "root"}')
    `);

		// Populate hive DB
		const managedHive = await DbClientFactory.getOrCreate(`file:${hiveDb}`);
		const hiveDbAdapter = managedHive.adapter;
		await createLibSQLStreamsSchema(hiveDbAdapter);
		await hiveDbAdapter.exec(`
      INSERT INTO events (type, project_key, timestamp, data)
      VALUES ('hive_event', '${testDir}', ${Date.now()}, '{"source": "hive"}')
    `);

		// Populate package DB
		const managedPkg = await DbClientFactory.getOrCreate(`file:${pkgDb}`);
		const pkgDbAdapter = managedPkg.adapter;
		await createLibSQLStreamsSchema(pkgDbAdapter);
		await pkgDbAdapter.exec(`
      INSERT INTO events (type, project_key, timestamp, data)
      VALUES ('pkg_event', '${testDir}', ${Date.now()}, '{"source": "pkg"}')
    `);

		// Run consolidation
		const report = await consolidateDatabases(testDir, globalDbPath, {
			yes: true,
		});

		// Verify report
		expect(report.straysFound).toBe(3);
		expect(report.straysMigrated).toBe(3);
		expect(report.totalRowsMigrated).toBeGreaterThan(0); // At least 1 event migrated
		expect(report.errors).toHaveLength(0);

		// Verify all data in global DB
		const managedGlobal = await DbClientFactory.getOrCreate(
			`file:${globalDbPath}`,
		);
		const globalDb = managedGlobal.adapter;
		const result = await globalDb.query<{ count: number }>(
			"SELECT COUNT(*) as count FROM events",
		);
		expect(Number(result.rows[0].count)).toBe(3);

		// Verify strays are gone
		expect(existsSync(rootDb)).toBe(false);
		expect(existsSync(hiveDb)).toBe(false);
		expect(existsSync(pkgDb)).toBe(false);

		// Verify .migrated files exist
		expect(existsSync(`${rootDb}.migrated`)).toBe(true);
		expect(existsSync(`${hiveDb}.migrated`)).toBe(true);
		expect(existsSync(`${pkgDb}.migrated`)).toBe(true);
	});

	test("handles overlapping data correctly", async () => {
		// Create stray DB
		const rootDb = join(testDir, ".opencode", "swarm.db");
		mkdirSync(join(testDir, ".opencode"), { recursive: true });

		const managedStray = await DbClientFactory.getOrCreate(`file:${rootDb}`);
		const rootDbAdapter = managedStray.adapter;
		await createLibSQLStreamsSchema(rootDbAdapter);

		// Insert same agent that will exist in global
		await rootDbAdapter.exec(`
      INSERT INTO agents (project_key, name, registered_at, last_active_at)
      VALUES ('${testDir}', 'duplicate-agent', ${Date.now()}, ${Date.now()})
    `);

		// Pre-populate global with same agent
		const managedGlobal = await DbClientFactory.getOrCreate(
			`file:${globalDbPath}`,
		);
		const globalDbAdapter = managedGlobal.adapter;
		await createLibSQLStreamsSchema(globalDbAdapter);
		await globalDbAdapter.exec(`
      INSERT INTO agents (project_key, name, registered_at, last_active_at)
      VALUES ('${testDir}', 'duplicate-agent', ${Date.now()}, ${Date.now()})
    `);

		// Run consolidation
		const report = await consolidateDatabases(testDir, globalDbPath, {
			yes: true,
		});

		// Verify no duplicate in global DB
		const result = await globalDbAdapter.query<{ count: number }>(
			"SELECT COUNT(*) as count FROM agents",
		);
		expect(Number(result.rows[0].count)).toBe(1); // Still only 1
	});
});
