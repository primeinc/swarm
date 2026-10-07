/**
 * Entity Extraction Tests
 *
 * TDD: RED → GREEN → REFACTOR
 *
 * Test coverage:
 * 1. extractEntitiesAndRelationships returns valid structure
 * 2. storeEntities deduplicates by name+type
 * 3. storeRelationships deduplicates by subject+predicate+object
 * 4. linkMemoryToEntities creates junction records
 * 5. getEntitiesByType filters correctly
 * 6. getRelationshipsForEntity returns both directions
 * 7. Cascade delete removes relationships when entity deleted
 * 8. Graceful handling of LLM errors
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Client } from "@libsql/client";
import { createClient } from "@libsql/client";
import {
	type Entity,
	extractEntitiesAndRelationships,
	getEntitiesByType,
	getRelationshipsForEntity,
	linkMemoryToEntities,
	type Relationship,
	storeEntities,
	storeRelationships,
} from "./entity-extraction.js";
import {
	createLibSQLMemorySchema,
	dropLibSQLMemorySchema,
} from "./libsql-schema.js";

describe("Entity Extraction", () => {
	let db: Client;

	beforeEach(async () => {
		db = createClient({ url: ":memory:" });
		await createLibSQLMemorySchema(db);
	});

	afterEach(async () => {
		await dropLibSQLMemorySchema(db);
	});

	// Skip: requires AI_GATEWAY_API_KEY in environment (integration test)
	// Run manually: AI_GATEWAY_API_KEY=xxx bun test entity-extraction.test.ts
	test.skip("extractEntitiesAndRelationships returns valid structure", async () => {
		const content = "Joel prefers TypeScript for building Next.js applications";
		const config = {
			model: "anthropic/claude-haiku-4-5",
			apiKey: process.env.AI_GATEWAY_API_KEY!,
		};

		const result = await extractEntitiesAndRelationships(content, config);

		// Should have entities array
		expect(result.entities).toBeArray();
		expect(result.entities.length).toBeGreaterThan(0);

		// Should have relationships array
		expect(result.relationships).toBeArray();

		// Each entity should have required fields
		for (const entity of result.entities) {
			expect(entity).toHaveProperty("name");
			expect(entity).toHaveProperty("entityType");
			expect(["person", "project", "technology", "concept"]).toContain(
				entity.entityType,
			);
		}

		// Each relationship should have required fields
		for (const rel of result.relationships) {
			expect(rel).toHaveProperty("subjectName");
			expect(rel).toHaveProperty("predicate");
			expect(rel).toHaveProperty("objectName");
			expect(rel.confidence).toBeGreaterThanOrEqual(0);
			expect(rel.confidence).toBeLessThanOrEqual(1);
		}
	});

	test("storeEntities deduplicates by name+type", async () => {
		const entities: Omit<Entity, "id" | "createdAt" | "updatedAt">[] = [
			{ name: "Joel", entityType: "person" },
			{ name: "Joel", entityType: "person" }, // Duplicate
			{ name: "TypeScript", entityType: "technology" },
		];

		const stored = await storeEntities(entities, db);

		// Should only store 2 unique entities (Joel appears once)
		expect(stored).toHaveLength(2);

		// Verify in database
		const result = await db.execute("SELECT COUNT(*) as count FROM entities");
		expect(Number(result.rows[0].count)).toBe(2);
	});

	test("storeRelationships deduplicates by subject+predicate+object", async () => {
		// First create a memory record (for foreign key constraint)
		await db.execute(`INSERT INTO memories (id, content) VALUES (?, ?)`, [
			"mem-123",
			"test content",
		]);

		// Then store entities to get IDs
		const entities: Omit<Entity, "id" | "createdAt" | "updatedAt">[] = [
			{ name: "Joel", entityType: "person" },
			{ name: "TypeScript", entityType: "technology" },
		];
		const storedEntities = await storeEntities(entities, db);

		const relationships: Omit<Relationship, "id" | "createdAt">[] = [
			{
				subjectId: storedEntities[0].id,
				predicate: "prefers",
				objectId: storedEntities[1].id,
				confidence: 0.9,
			},
			{
				subjectId: storedEntities[0].id,
				predicate: "prefers",
				objectId: storedEntities[1].id,
				confidence: 0.8, // Different confidence, same triple
			},
		];

		const stored = await storeRelationships(relationships, "mem-123", db);

		// Should only store 1 relationship (deduplicated)
		expect(stored).toHaveLength(1);

		// Verify in database
		const result = await db.execute(
			"SELECT COUNT(*) as count FROM relationships",
		);
		expect(Number(result.rows[0].count)).toBe(1);

		// Should keep the first one (higher confidence)
		expect(stored[0].confidence).toBe(0.9);
	});

	test("linkMemoryToEntities creates junction records", async () => {
		// First create a memory record
		const memoryId = "mem-456";
		await db.execute(`INSERT INTO memories (id, content) VALUES (?, ?)`, [
			memoryId,
			"test content",
		]);

		const entities: Omit<Entity, "id" | "createdAt" | "updatedAt">[] = [
			{ name: "Joel", entityType: "person" },
			{ name: "TypeScript", entityType: "technology" },
		];
		const storedEntities = await storeEntities(entities, db);

		const entityIds = storedEntities.map((e) => e.id);

		await linkMemoryToEntities(memoryId, entityIds, db);

		// Verify junction records created
		const result = await db.execute(
			`
      SELECT memory_id, entity_id 
      FROM memory_entities 
      WHERE memory_id = ?
    `,
			[memoryId],
		);

		expect(result.rows).toHaveLength(2);
		const returnedIds = result.rows.map((r) => r.entity_id as string);
		expect(returnedIds.sort()).toEqual(entityIds.sort());
	});

	test("getEntitiesByType filters correctly", async () => {
		const entities: Omit<Entity, "id" | "createdAt" | "updatedAt">[] = [
			{ name: "Joel", entityType: "person" },
			{ name: "Sarah", entityType: "person" },
			{ name: "TypeScript", entityType: "technology" },
			{ name: "React", entityType: "technology" },
			{ name: "egghead.io", entityType: "project" },
		];
		await storeEntities(entities, db);

		const people = await getEntitiesByType("person", db);
		expect(people).toHaveLength(2);
		expect(people.every((e) => e.entityType === "person")).toBe(true);

		const tech = await getEntitiesByType("technology", db);
		expect(tech).toHaveLength(2);
		expect(tech.every((e) => e.entityType === "technology")).toBe(true);

		const projects = await getEntitiesByType("project", db);
		expect(projects).toHaveLength(1);
		expect(projects[0].name).toBe("egghead.io");
	});

	test("getRelationshipsForEntity returns both directions", async () => {
		// First create a memory record
		await db.execute(`INSERT INTO memories (id, content) VALUES (?, ?)`, [
			"mem-789",
			"test content",
		]);

		const entities: Omit<Entity, "id" | "createdAt" | "updatedAt">[] = [
			{ name: "Joel", entityType: "person" },
			{ name: "TypeScript", entityType: "technology" },
			{ name: "Next.js", entityType: "technology" },
		];
		const stored = await storeEntities(entities, db);
		const [joel, typescript, nextjs] = stored;

		// Joel prefers TypeScript
		// Next.js uses TypeScript
		const relationships: Omit<Relationship, "id" | "createdAt">[] = [
			{
				subjectId: joel.id,
				predicate: "prefers",
				objectId: typescript.id,
				confidence: 0.9,
			},
			{
				subjectId: nextjs.id,
				predicate: "uses",
				objectId: typescript.id,
				confidence: 0.95,
			},
		];
		await storeRelationships(relationships, "mem-789", db);

		// TypeScript is object in both relationships
		const tsRelations = await getRelationshipsForEntity(typescript.id, db);
		expect(tsRelations).toHaveLength(2);

		// Joel is subject in one
		const joelRelations = await getRelationshipsForEntity(joel.id, db);
		expect(joelRelations).toHaveLength(1);
		expect(joelRelations[0].predicate).toBe("prefers");

		// Test direction filtering
		const tsAsObject = await getRelationshipsForEntity(
			typescript.id,
			db,
			"object",
		);
		expect(tsAsObject).toHaveLength(2);

		const tsAsSubject = await getRelationshipsForEntity(
			typescript.id,
			db,
			"subject",
		);
		expect(tsAsSubject).toHaveLength(0);
	});

	test("cascade delete removes relationships when entity deleted", async () => {
		// First create a memory record
		await db.execute(`INSERT INTO memories (id, content) VALUES (?, ?)`, [
			"mem-cascade",
			"test content",
		]);

		const entities: Omit<Entity, "id" | "createdAt" | "updatedAt">[] = [
			{ name: "Joel", entityType: "person" },
			{ name: "TypeScript", entityType: "technology" },
		];
		const stored = await storeEntities(entities, db);

		const relationships: Omit<Relationship, "id" | "createdAt">[] = [
			{
				subjectId: stored[0].id,
				predicate: "prefers",
				objectId: stored[1].id,
				confidence: 0.9,
			},
		];
		await storeRelationships(relationships, "mem-cascade", db);

		// Verify relationship exists
		let result = await db.execute(
			"SELECT COUNT(*) as count FROM relationships",
		);
		expect(Number(result.rows[0].count)).toBe(1);

		// Delete entity
		await db.execute("DELETE FROM entities WHERE id = ?", [stored[0].id]);

		// Relationship should be cascade deleted
		result = await db.execute("SELECT COUNT(*) as count FROM relationships");
		expect(Number(result.rows[0].count)).toBe(0);
	});

	test("graceful handling of LLM errors", async () => {
		const content = "Some content";
		const config = {
			model: "anthropic/invalid-model",
			apiKey: "invalid-key",
		};

		// Should not throw, should return empty structure
		const result = await extractEntitiesAndRelationships(content, config);

		expect(result).toEqual({
			entities: [],
			relationships: [],
		});
	});
});
