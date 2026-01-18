/**
 * Memory Linking Tests - TDD for Zettelkasten-style bidirectional links
 *
 * Tests memory linking operations with vector similarity:
 * - Finding related memories via vector search
 * - Creating bidirectional links with types
 * - Getting links in both directions
 * - Auto-linking on memory creation
 * - Link strength updates (reinforcement/decay)
 * - Cascade delete behavior
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Client } from "@libsql/client";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import type { SwarmDb } from "../db/client.js";
import * as schema from "../db/schema/index.js";
import { createLibSQLMemorySchema } from "./libsql-schema.js";
import {
	autoLinkMemory,
	createLink,
	findRelatedMemories,
	getLinks,
	updateLinkStrength,
} from "./memory-linking.js";
import { createMemoryStore } from "./store.js";

describe("Memory Linking", () => {
	let client: Client;
	let db: SwarmDb;

	beforeAll(async () => {
		client = createClient({ url: ":memory:" });
		db = drizzle(client, { schema });
		await createLibSQLMemorySchema(client);
	});

	afterAll(async () => {
		client.close();
	});

	test("findRelatedMemories returns similar memories above threshold", async () => {
		const store = createMemoryStore(db);

		// Store test memories with distinct embeddings
		const memory1 = {
			id: "mem1",
			content: "React hooks and useEffect",
			metadata: {},
			collection: "default",
			createdAt: new Date(),
		};
		const embedding1 = new Array(1024).fill(0);
		embedding1[0] = 1.0; // Distinct vector
		await store.store(memory1, embedding1);

		const memory2 = {
			id: "mem2",
			content: "React hooks and useState",
			metadata: {},
			collection: "default",
			createdAt: new Date(),
		};
		const embedding2 = new Array(1024).fill(0);
		embedding2[0] = 0.9; // Very similar to memory1
		embedding2[1] = 0.1;
		await store.store(memory2, embedding2);

		const memory3 = {
			id: "mem3",
			content: "Python decorators and metaclasses",
			metadata: {},
			collection: "default",
			createdAt: new Date(),
		};
		const embedding3 = new Array(1024).fill(0);
		embedding3[100] = 1.0; // Completely different vector
		await store.store(memory3, embedding3);

		// Find related memories to mem1
		const related = await findRelatedMemories("mem1", db, embedding1, {
			similarityThreshold: 0.5,
			maxLinks: 5,
		});

		// Should find mem2 (similar) but not mem3 (dissimilar)
		expect(related.length).toBeGreaterThan(0);
		const relatedIds = related.map((r) => r.memoryId);
		expect(relatedIds).toContain("mem2");
		expect(relatedIds).not.toContain("mem3");
		expect(relatedIds).not.toContain("mem1"); // Shouldn't include self

		// Check similarity scores
		const mem2Result = related.find((r) => r.memoryId === "mem2");
		expect(mem2Result).toBeDefined();
		expect(mem2Result!.similarity).toBeGreaterThan(0.5);
	});

	test("createLink creates bidirectional link with unique constraint", async () => {
		const link1 = await createLink("mem1", "mem2", "related", db, 0.8);

		expect(link1.sourceId).toBe("mem1");
		expect(link1.targetId).toBe("mem2");
		expect(link1.linkType).toBe("related");
		expect(link1.strength).toBe(0.8);

		// Creating duplicate link should fail (UNIQUE constraint)
		await expect(createLink("mem1", "mem2", "related", db)).rejects.toThrow();
	});

	test("getLinks returns links in both directions", async () => {
		// Create a new pair for this test
		const mem4 = {
			id: "mem4",
			content: "Test memory 4",
			metadata: {},
			collection: "default",
			createdAt: new Date(),
		};
		const mem5 = {
			id: "mem5",
			content: "Test memory 5",
			metadata: {},
			collection: "default",
			createdAt: new Date(),
		};
		const embedding = new Array(1024).fill(0);
		embedding[0] = 1.0;

		const store = createMemoryStore(db);
		await store.store(mem4, embedding);
		await store.store(mem5, embedding);

		// Create link from mem4 to mem5
		await createLink("mem4", "mem5", "elaborates", db);

		// Get links from mem4 perspective
		const linksFrom4 = await getLinks("mem4", db);
		expect(linksFrom4.length).toBe(1);
		expect(linksFrom4[0].sourceId).toBe("mem4");
		expect(linksFrom4[0].targetId).toBe("mem5");
		expect(linksFrom4[0].linkType).toBe("elaborates");

		// Get links from mem5 perspective (should see reverse direction)
		const linksFrom5 = await getLinks("mem5", db);
		expect(linksFrom5.length).toBe(1);
		expect(linksFrom5[0].sourceId).toBe("mem4");
		expect(linksFrom5[0].targetId).toBe("mem5");

		// Filter by link type
		const relatedLinks = await getLinks("mem4", db, "related");
		expect(relatedLinks.length).toBe(0); // Should be empty

		const elaboratesLinks = await getLinks("mem4", db, "elaborates");
		expect(elaboratesLinks.length).toBe(1);
	});

	test("autoLinkMemory creates links for semantically similar memories", async () => {
		const store = createMemoryStore(db);

		// Create base memory
		const mem6 = {
			id: "mem6",
			content: "TypeScript generics and type inference",
			metadata: {},
			collection: "default",
			createdAt: new Date(),
		};
		const embedding6 = new Array(1024).fill(0);
		embedding6[50] = 1.0;
		await store.store(mem6, embedding6);

		// Create similar memory
		const mem7 = {
			id: "mem7",
			content: "TypeScript utility types and generics",
			metadata: {},
			collection: "default",
			createdAt: new Date(),
		};
		const embedding7 = new Array(1024).fill(0);
		embedding7[50] = 0.9;
		embedding7[51] = 0.1;
		await store.store(mem7, embedding7);

		// Auto-link mem7 (should find mem6)
		const links = await autoLinkMemory("mem7", embedding7, db, {
			similarityThreshold: 0.5,
			maxLinks: 5,
		});

		expect(links.length).toBeGreaterThan(0);
		const linkedIds = links.map((l) => l.targetId);
		expect(linkedIds).toContain("mem6");

		// Verify link was created
		const storedLinks = await getLinks("mem7", db);
		expect(storedLinks.length).toBeGreaterThan(0);
	});

	test("updateLinkStrength reinforces and decays correctly", async () => {
		// Create test link
		const mem8 = {
			id: "mem8",
			content: "Test memory 8",
			metadata: {},
			collection: "default",
			createdAt: new Date(),
		};
		const mem9 = {
			id: "mem9",
			content: "Test memory 9",
			metadata: {},
			collection: "default",
			createdAt: new Date(),
		};
		const embedding = new Array(1024).fill(0);
		embedding[0] = 1.0;

		const store = createMemoryStore(db);
		await store.store(mem8, embedding);
		await store.store(mem9, embedding);

		const link = await createLink("mem8", "mem9", "related", db, 0.5);

		// Reinforce (increase strength)
		await updateLinkStrength(link.id, 0.2, db);
		const reinforced = await getLinks("mem8", db);
		expect(reinforced[0].strength).toBe(0.7);

		// Decay (decrease strength)
		await updateLinkStrength(link.id, -0.3, db);
		const decayed = await getLinks("mem8", db);
		expect(decayed[0].strength).toBeCloseTo(0.4, 5);

		// Strength should be clamped to [0, 1]
		await updateLinkStrength(link.id, 2.0, db);
		const maxed = await getLinks("mem8", db);
		expect(maxed[0].strength).toBeLessThanOrEqual(1.0);
	});

	test("cascade delete removes links when memory deleted", async () => {
		const store = createMemoryStore(db);

		// Create memories and link
		const mem10 = {
			id: "mem10",
			content: "Test memory 10",
			metadata: {},
			collection: "default",
			createdAt: new Date(),
		};
		const mem11 = {
			id: "mem11",
			content: "Test memory 11",
			metadata: {},
			collection: "default",
			createdAt: new Date(),
		};
		const embedding = new Array(1024).fill(0);
		embedding[0] = 1.0;

		await store.store(mem10, embedding);
		await store.store(mem11, embedding);
		await createLink("mem10", "mem11", "related", db);

		// Verify link exists
		const linksBefore = await getLinks("mem10", db);
		expect(linksBefore.length).toBe(1);

		// Delete source memory
		await store.delete("mem10");

		// Links should be cascade deleted
		const linksAfter = await getLinks("mem11", db);
		expect(linksAfter.length).toBe(0);
	});

	test("findRelatedMemories respects maxLinks parameter", async () => {
		const store = createMemoryStore(db);

		// Create base memory
		const base = {
			id: "base",
			content: "Base memory",
			metadata: {},
			collection: "default",
			createdAt: new Date(),
		};
		const baseEmbedding = new Array(1024).fill(0);
		baseEmbedding[0] = 1.0;
		await store.store(base, baseEmbedding);

		// Create multiple similar memories
		for (let i = 0; i < 10; i++) {
			const mem = {
				id: `similar-${i}`,
				content: `Similar memory ${i}`,
				metadata: {},
				collection: "default",
				createdAt: new Date(),
			};
			const embedding = new Array(1024).fill(0);
			embedding[0] = 0.9 - i * 0.01; // Gradually decrease similarity
			await store.store(mem, embedding);
		}

		// Find related with maxLinks=3
		const related = await findRelatedMemories("base", db, baseEmbedding, {
			similarityThreshold: 0.5,
			maxLinks: 3,
		});

		expect(related.length).toBeLessThanOrEqual(3);
	});

	test("different link types can exist between same memories", async () => {
		const store = createMemoryStore(db);

		const mem12 = {
			id: "mem12",
			content: "Test memory 12",
			metadata: {},
			collection: "default",
			createdAt: new Date(),
		};
		const mem13 = {
			id: "mem13",
			content: "Test memory 13",
			metadata: {},
			collection: "default",
			createdAt: new Date(),
		};
		const embedding = new Array(1024).fill(0);
		embedding[0] = 1.0;

		await store.store(mem12, embedding);
		await store.store(mem13, embedding);

		// Create multiple link types between same memories
		await createLink("mem12", "mem13", "related", db);
		await createLink("mem12", "mem13", "elaborates", db);

		const allLinks = await getLinks("mem12", db);
		expect(allLinks.length).toBe(2);

		const linkTypes = allLinks.map((l) => l.linkType);
		expect(linkTypes).toContain("related");
		expect(linkTypes).toContain("elaborates");
	});
});
