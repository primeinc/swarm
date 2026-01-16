/**
 * cells Projections Tests
 *
 * Tests projection updates from events and query functions.
 *
 * ## Test Strategy (TDD)
 * 1. Migration creates tables
 * 2. Events update projections correctly
 * 3. Queries return expected results
 * 4. Blocked cache works correctly
 * 5. Dirty tracking works
 */

import { beforeEach, describe, expect, test } from "bun:test";
import { createTestLibSQLDb } from "../test-libsql.js";
import type { DatabaseAdapter } from "../types/database.js";
import { rebuildcellBlockedCache } from "./dependencies.js";
import {
	clearDirtycell,
	getBlockedCells,
	getBlockers,
	getCell,
	getComments,
	getDependencies,
	getDependents,
	getDirtyCells,
	getInProgressCells,
	getLabels,
	getNextReadyCell,
	isBlocked,
	markcellDirty,
	queryCells,
	updateProjections,
} from "./projections.js";

describe("cells Migrations", () => {
	let db: DatabaseAdapter;

	beforeEach(async () => {
		// Use libSQL test helper - schema already includes all tables
		const { adapter } = await createTestLibSQLDb();
		db = adapter;
	});

	test("migration creates cells table", async () => {
		const result = await db.query(
			`SELECT name FROM sqlite_master WHERE type='table' AND name='cells'`,
		);
		expect(result.rows).toHaveLength(1);
	});

	test("migration creates cell_dependencies table", async () => {
		const result = await db.query(
			`SELECT name FROM sqlite_master WHERE type='table' AND name='cell_dependencies'`,
		);
		expect(result.rows).toHaveLength(1);
	});

	test("migration creates cell_labels table", async () => {
		const result = await db.query(
			`SELECT name FROM sqlite_master WHERE type='table' AND name='cell_labels'`,
		);
		expect(result.rows).toHaveLength(1);
	});

	test("migration creates cell_comments table", async () => {
		const result = await db.query(
			`SELECT name FROM sqlite_master WHERE type='table' AND name='cell_comments'`,
		);
		expect(result.rows).toHaveLength(1);
	});

	test("migration creates blocked_cells_cache table", async () => {
		const result = await db.query(
			`SELECT name FROM sqlite_master WHERE type='table' AND name='blocked_cells_cache'`,
		);
		expect(result.rows).toHaveLength(1);
	});

	test("migration creates dirty_cells table", async () => {
		const result = await db.query(
			`SELECT name FROM sqlite_master WHERE type='table' AND name='dirty_cells'`,
		);
		expect(result.rows).toHaveLength(1);
	});
});

describe("cells Projections", () => {
	let db: DatabaseAdapter;
	const projectKey = "/test/project";

	beforeEach(async () => {
		// Use libSQL test helper - schema already includes all tables
		const { adapter } = await createTestLibSQLDb();
		db = adapter;
	});

	describe("cell_created event", () => {
		test("creates cell record", async () => {
			const event = {
				type: "cell_created",
				project_key: projectKey,
				cell_id: "bd-123",
				title: "Test cell",
				description: "Test description",
				issue_type: "task",
				priority: 2,
				timestamp: Date.now(),
			};

			await updateProjections(db, event);

			const cell = await getCell(db, projectKey, "bd-123");
			expect(cell).not.toBeNull();
			expect(cell?.title).toBe("Test cell");
			expect(cell?.type).toBe("task");
			expect(cell?.status).toBe("open");
			expect(cell?.priority).toBe(2);
		});

		test("marks cell as dirty", async () => {
			const event = {
				type: "cell_created",
				project_key: projectKey,
				cell_id: "bd-123",
				title: "Test cell",
				issue_type: "task",
				priority: 2,
				timestamp: Date.now(),
			};

			await updateProjections(db, event);

			const dirtycells = await getDirtyCells(db, projectKey);
			expect(dirtycells).toContain("bd-123");
		});
	});

	describe("cell_updated event", () => {
		test("updates cell fields", async () => {
			// Create cell
			await updateProjections(db, {
				type: "cell_created",
				project_key: projectKey,
				cell_id: "bd-123",
				title: "Original Title",
				issue_type: "task",
				priority: 2,
				timestamp: Date.now(),
			});

			// Update title
			await updateProjections(db, {
				type: "cell_updated",
				project_key: projectKey,
				cell_id: "bd-123",
				changes: {
					title: { old: "Original Title", new: "Updated Title" },
				},
				timestamp: Date.now(),
			});

			const cell = await getCell(db, projectKey, "bd-123");
			expect(cell?.title).toBe("Updated Title");
		});
	});

	describe("cell_status_changed event", () => {
		test("updates status", async () => {
			await updateProjections(db, {
				type: "cell_created",
				project_key: projectKey,
				cell_id: "bd-123",
				title: "Test cell",
				issue_type: "task",
				priority: 2,
				timestamp: Date.now(),
			});

			await updateProjections(db, {
				type: "cell_status_changed",
				project_key: projectKey,
				cell_id: "bd-123",
				from_status: "open",
				to_status: "in_progress",
				timestamp: Date.now(),
			});

			const cell = await getCell(db, projectKey, "bd-123");
			expect(cell?.status).toBe("in_progress");
		});
	});

	describe("cell_closed event", () => {
		test("closes cell", async () => {
			await updateProjections(db, {
				type: "cell_created",
				project_key: projectKey,
				cell_id: "bd-123",
				title: "Test cell",
				issue_type: "task",
				priority: 2,
				timestamp: Date.now(),
			});

			const closedAt = Date.now();
			await updateProjections(db, {
				type: "cell_closed",
				project_key: projectKey,
				cell_id: "bd-123",
				reason: "Completed",
				timestamp: closedAt,
			});

			const cell = await getCell(db, projectKey, "bd-123");
			expect(cell?.status).toBe("closed");
			expect(cell?.closed_at).toBe(closedAt);
			expect(cell?.closed_reason).toBe("Completed");
		});
	});

	describe("dependency events", () => {
		test("adds dependency", async () => {
			// Create two cells
			await updateProjections(db, {
				type: "cell_created",
				project_key: projectKey,
				cell_id: "bd-123",
				title: "cell 1",
				issue_type: "task",
				priority: 2,
				timestamp: Date.now(),
			});

			await updateProjections(db, {
				type: "cell_created",
				project_key: projectKey,
				cell_id: "bd-124",
				title: "cell 2",
				issue_type: "task",
				priority: 2,
				timestamp: Date.now(),
			});

			// Add dependency
			await updateProjections(db, {
				type: "cell_dependency_added",
				project_key: projectKey,
				cell_id: "bd-124",
				dependency: { target: "bd-123", type: "blocks" },
				timestamp: Date.now(),
			});

			const deps = await getDependencies(db, projectKey, "bd-124");
			expect(deps).toHaveLength(1);
			expect(deps[0]?.depends_on_id).toBe("bd-123");
			expect(deps[0]?.relationship).toBe("blocks");
		});

		test("rebuilds blocked cache", async () => {
			// Create two cells
			await updateProjections(db, {
				type: "cell_created",
				project_key: projectKey,
				cell_id: "bd-123",
				title: "cell 1",
				issue_type: "task",
				priority: 2,
				timestamp: Date.now(),
			});

			await updateProjections(db, {
				type: "cell_created",
				project_key: projectKey,
				cell_id: "bd-124",
				title: "cell 2",
				issue_type: "task",
				priority: 2,
				timestamp: Date.now(),
			});

			// Add blocking dependency
			await updateProjections(db, {
				type: "cell_dependency_added",
				project_key: projectKey,
				cell_id: "bd-124",
				dependency: { target: "bd-123", type: "blocks" },
				timestamp: Date.now(),
			});

			// Rebuild cache
			await rebuildcellBlockedCache(db, projectKey, "bd-124");

			const blocked = await isBlocked(db, projectKey, "bd-124");
			expect(blocked).toBe(true);

			const blockers = await getBlockers(db, projectKey, "bd-124");
			expect(blockers).toContain("bd-123");
		});
	});

	describe("label events", () => {
		test("adds label", async () => {
			await updateProjections(db, {
				type: "cell_created",
				project_key: projectKey,
				cell_id: "bd-123",
				title: "Test cell",
				issue_type: "task",
				priority: 2,
				timestamp: Date.now(),
			});

			await updateProjections(db, {
				type: "cell_label_added",
				project_key: projectKey,
				cell_id: "bd-123",
				label: "urgent",
				timestamp: Date.now(),
			});

			const labels = await getLabels(db, projectKey, "bd-123");
			expect(labels).toContain("urgent");
		});

		test("removes label", async () => {
			await updateProjections(db, {
				type: "cell_created",
				project_key: projectKey,
				cell_id: "bd-123",
				title: "Test cell",
				issue_type: "task",
				priority: 2,
				timestamp: Date.now(),
			});

			await updateProjections(db, {
				type: "cell_label_added",
				project_key: projectKey,
				cell_id: "bd-123",
				label: "urgent",
				timestamp: Date.now(),
			});

			await updateProjections(db, {
				type: "cell_label_removed",
				project_key: projectKey,
				cell_id: "bd-123",
				label: "urgent",
				timestamp: Date.now(),
			});

			const labels = await getLabels(db, projectKey, "bd-123");
			expect(labels).not.toContain("urgent");
		});
	});

	describe("comment events", () => {
		test("adds comment", async () => {
			await updateProjections(db, {
				type: "cell_created",
				project_key: projectKey,
				cell_id: "bd-123",
				title: "Test cell",
				issue_type: "task",
				priority: 2,
				timestamp: Date.now(),
			});

			await updateProjections(db, {
				type: "cell_comment_added",
				project_key: projectKey,
				cell_id: "bd-123",
				author: "TestAgent",
				body: "Test comment",
				timestamp: Date.now(),
			});

			const comments = await getComments(db, projectKey, "bd-123");
			expect(comments).toHaveLength(1);
			expect(comments[0]?.body).toBe("Test comment");
			expect(comments[0]?.author).toBe("TestAgent");
		});
	});

	describe("query functions", () => {
		test("queryCells filters by status", async () => {
			await updateProjections(db, {
				type: "cell_created",
				project_key: projectKey,
				cell_id: "bd-123",
				title: "Open cell",
				issue_type: "task",
				priority: 2,
				timestamp: Date.now(),
			});

			await updateProjections(db, {
				type: "cell_created",
				project_key: projectKey,
				cell_id: "bd-124",
				title: "In Progress cell",
				issue_type: "task",
				priority: 2,
				timestamp: Date.now(),
			});

			await updateProjections(db, {
				type: "cell_status_changed",
				project_key: projectKey,
				cell_id: "bd-124",
				from_status: "open",
				to_status: "in_progress",
				timestamp: Date.now(),
			});

			const opencells = await queryCells(db, projectKey, { status: "open" });
			expect(opencells).toHaveLength(1);
			expect(opencells[0]?.id).toBe("bd-123");

			const inProgresscells = await getInProgressCells(db, projectKey);
			expect(inProgresscells).toHaveLength(1);
			expect(inProgresscells[0]?.id).toBe("bd-124");
		});

		test("getNextReadyCell returns unblocked high priority cell", async () => {
			// Create high priority cell
			await updateProjections(db, {
				type: "cell_created",
				project_key: projectKey,
				cell_id: "bd-123",
				title: "High Priority",
				issue_type: "task",
				priority: 3,
				timestamp: Date.now(),
			});

			// Create low priority cell
			await updateProjections(db, {
				type: "cell_created",
				project_key: projectKey,
				cell_id: "bd-124",
				title: "Low Priority",
				issue_type: "task",
				priority: 1,
				timestamp: Date.now() + 1,
			});

			const ready = await getNextReadyCell(db, projectKey);
			expect(ready?.id).toBe("bd-123"); // Higher priority
		});

		test("getBlockedCells returns cells with blockers", async () => {
			await updateProjections(db, {
				type: "cell_created",
				project_key: projectKey,
				cell_id: "bd-123",
				title: "Blocker",
				issue_type: "task",
				priority: 2,
				timestamp: Date.now(),
			});

			await updateProjections(db, {
				type: "cell_created",
				project_key: projectKey,
				cell_id: "bd-124",
				title: "Blocked",
				issue_type: "task",
				priority: 2,
				timestamp: Date.now(),
			});

			await updateProjections(db, {
				type: "cell_dependency_added",
				project_key: projectKey,
				cell_id: "bd-124",
				dependency: { target: "bd-123", type: "blocks" },
				timestamp: Date.now(),
			});

			await rebuildcellBlockedCache(db, projectKey, "bd-124");

			const blocked = await getBlockedCells(db, projectKey);
			expect(blocked).toHaveLength(1);
			expect(blocked[0]?.cell.id).toBe("bd-124");
			expect(blocked[0]?.blockers).toContain("bd-123");
		});
	});

	describe("dirty tracking", () => {
		test("marks cell as dirty", async () => {
			await updateProjections(db, {
				type: "cell_created",
				project_key: projectKey,
				cell_id: "bd-123",
				title: "Test cell",
				issue_type: "task",
				priority: 2,
				timestamp: Date.now(),
			});

			await markcellDirty(db, projectKey, "bd-123");

			const dirty = await getDirtyCells(db, projectKey);
			expect(dirty).toContain("bd-123");
		});

		test("clears dirty flag", async () => {
			await updateProjections(db, {
				type: "cell_created",
				project_key: projectKey,
				cell_id: "bd-123",
				title: "Test cell",
				issue_type: "task",
				priority: 2,
				timestamp: Date.now(),
			});

			await markcellDirty(db, projectKey, "bd-123");
			await clearDirtycell(db, projectKey, "bd-123");

			const dirty = await getDirtyCells(db, projectKey);
			expect(dirty).not.toContain("bd-123");
		});
	});
});
