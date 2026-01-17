/**
 * Memory Tool Tests
 *
 * Tests for semantic-memory_* tool handlers that use embedded MemoryStore.
 */

import { describe, test, expect, beforeAll, afterAll, beforeEach, afterEach } from "bun:test";
import {
	createMemoryAdapter,
	type MemoryAdapter,
	resetMigrationCheck,
} from "./memory";
import { createInMemorySwarmMail } from "swarm-mail";
import type { SwarmMailAdapter } from "swarm-mail";

describe("memory adapter", () => {
	let swarmMail: SwarmMailAdapter;
	let adapter: MemoryAdapter;

	beforeAll(async () => {
		// Create in-memory SwarmMail
		// Note: createInMemorySwarmMail now creates memory schema automatically
		swarmMail = await createInMemorySwarmMail("test-memory");
		const db = await swarmMail.getDatabase();
		
		// Insert a dummy memory to prevent auto-migration from running
		await db.query(`
			INSERT INTO memories (id, content, collection, created_at)
			VALUES ($1, $2, $3, datetime('now'))
		`, ['mem_init', 'Test setup marker', 'default']);
		
		adapter = await createMemoryAdapter(db);
	});

	afterAll(async () => {
		await swarmMail.close();
	});

	describe("store", () => {
		test("stores memory with auto-generated ID", async () => {
			const result = await adapter.store({
				information: "OAuth refresh tokens need 5min buffer",
				tags: "auth,tokens",
				metadata: JSON.stringify({ project: "test" }),
			});

			expect(result.id).toBeDefined();
			expect(result.id).toMatch(/^mem-/); // Real swarm-mail adapter uses 'mem-' prefix
			expect(result.message).toContain("Stored memory");
		});

		test("stores memory with explicit collection", async () => {
			const result = await adapter.store({
				information: "Test memory",
				collection: "project-alpha",
			});

			expect(result.id).toMatch(/^mem-/); // Real swarm-mail adapter uses 'mem-' prefix
			expect(result.message).toContain("collection: project-alpha");
		});
	});

	describe("find", () => {
		test("returns results sorted by relevance score", async () => {
			// Store some test memories
			await adapter.store({ information: "Test memory about cats" });
			await adapter.store({ information: "Test memory about dogs" });
			
			// Query for cats - should return relevant results first
			const results = await adapter.find({
				query: "cats felines",
				limit: 5,
			});

			// Should find at least the cat memory
			expect(results.count).toBeGreaterThan(0);
			// Results should be in descending score order
			for (let i = 1; i < results.results.length; i++) {
				expect(results.results[i - 1].score).toBeGreaterThanOrEqual(results.results[i].score);
			}
		});

		test("finds stored memories by semantic similarity", async () => {
			// Store a memory
			await adapter.store({
				information: "Next.js 16 Cache Components need Suspense boundaries",
				tags: "nextjs,caching",
			});

			// Search for it
			const results = await adapter.find({
				query: "nextjs cache suspense",
				limit: 5,
			});

			// Should find at least one result
			expect(results.count).toBeGreaterThan(0);
		});
	});

	describe("stats", () => {
		test("returns memory and embedding counts", async () => {
			const stats = await adapter.stats();

			expect(typeof stats.memories).toBe("number");
			expect(typeof stats.embeddings).toBe("number");
			expect(stats.memories).toBeGreaterThanOrEqual(0);
			expect(stats.embeddings).toBeGreaterThanOrEqual(0);
		});
	});

	describe("checkHealth", () => {
		test("returns health status", async () => {
			const health = await adapter.checkHealth();

			expect(typeof health.ollama).toBe("boolean");
			// message is only present when ollama is false
			if (!health.ollama) {
				expect(typeof health.message).toBe("string");
			}
		});
	});
});

describe("auto-migration on createMemoryAdapter", () => {
	let swarmMail: SwarmMailAdapter;

	beforeEach(() => {
		// Reset migration check flag before each test
		resetMigrationCheck();
	});

	afterEach(async () => {
		if (swarmMail) {
			await swarmMail.close();
		}
	});

	test("skips auto-migration when target already has data", async () => {
		// Create in-memory SwarmMail
		// Note: createInMemorySwarmMail now creates memory schema automatically
		swarmMail = await createInMemorySwarmMail("test-migration");
		const db = await swarmMail.getDatabase();

		// Insert a marker memory to simulate existing data
		await db.query(`
			INSERT INTO memories (id, content, collection, created_at)
			VALUES ($1, $2, $3, datetime('now'))
		`, ['mem_existing', 'Existing memory', 'default']);

		// Create adapter - should skip migration because target has data
		const adapter = await createMemoryAdapter(db);

		// Verify adapter works
		const stats = await adapter.stats();
		expect(stats.memories).toBeGreaterThanOrEqual(1);
	});
});
