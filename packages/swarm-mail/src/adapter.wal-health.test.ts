/**
 * SwarmMailAdapter WAL Health Integration Tests
 *
 * Tests for integrating WAL health monitoring into SwarmMailAdapter.healthCheck()
 *
 * NOTE: LibSQL doesn't implement checkWalHealth/getWalStats (optional methods).
 * These tests verify graceful degradation when WAL monitoring is unavailable.
 * For full WAL monitoring tests, see PGLite-specific test files.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createInMemorySwarmMailLibSQL } from "./libsql.convenience";
import type { SwarmMailAdapter } from "./types";

let swarmMail: SwarmMailAdapter;

beforeAll(async () => {
	swarmMail = await createInMemorySwarmMailLibSQL("adapter-wal-health-test");
});

afterAll(async () => {
	await swarmMail.close();
});

describe("SwarmMailAdapter healthCheck with WAL monitoring", () => {
	test("healthCheck returns basic health object", async () => {
		const health = await swarmMail.healthCheck();

		expect(health).toBeDefined();
		expect(typeof health).toBe("object");

		// Should include basic connectivity check
		expect(health).toHaveProperty("connected");
		expect(health.connected).toBeBoolean();
		expect(health.connected).toBe(true);
	});

	test("healthCheck gracefully handles missing WAL support", async () => {
		// LibSQL doesn't implement checkWalHealth (optional method)
		const health = await swarmMail.healthCheck();

		// Should still return health object with connected status
		expect(health).toBeDefined();
		expect(health.connected).toBe(true);

		// WAL health is undefined for databases without WAL monitoring
		expect(health.walHealth).toBeUndefined();
	});

	test("healthCheck works without WAL threshold parameter", async () => {
		// Even with threshold param, libSQL doesn't have WAL monitoring
		const health = await swarmMail.healthCheck({ walThresholdMb: 50 });

		expect(health).toBeDefined();
		expect(health.connected).toBe(true);
		expect(health.walHealth).toBeUndefined();
	});

	test("getDatabaseStats excludes WAL stats when unsupported", async () => {
		const stats = await swarmMail.getDatabaseStats();

		expect(stats).toBeDefined();
		expect(stats).toHaveProperty("events");
		expect(stats).toHaveProperty("agents");
		expect(stats).toHaveProperty("messages");
		expect(stats).toHaveProperty("reservations");

		// LibSQL doesn't implement getWalStats (optional method)
		expect(stats.wal).toBeUndefined();
	});
});
