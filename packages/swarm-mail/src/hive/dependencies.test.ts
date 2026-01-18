/**
 * Dependencies Tests - Dependency graph operations
 *
 * Tests dependency management including:
 * - Adding/removing dependencies
 * - Cycle detection
 * - Dependency tree traversal (forward and reverse)
 * - Blocked cell detection
 *
 * Reference: steveyegge/cells/internal/storage/sqlite/dependencies_test.go
 */

import { beforeEach, describe, expect, test } from "bun:test";
import { createTestLibSQLDb } from "../test-libsql.js";
import type { DatabaseAdapter } from "../types/database.js";
import type { HiveAdapter } from "../types/hive-adapter.js";
import { createHiveAdapter } from "./adapter.js";

describe("Dependencies", () => {
	let db: DatabaseAdapter;
	let cells: HiveAdapter;
	const projectKey = "/test/project";

	beforeEach(async () => {
		// Use libSQL test helper - schema already includes all tables
		const { adapter } = await createTestLibSQLDb();
		db = adapter;

		// Create cells adapter (no migrations needed - schema already set up)
		cells = createHiveAdapter(db, projectKey);
	});

	describe("addDependency", () => {
		test("adds a blocks dependency", async () => {
			const cell1 = await cells.createCell(projectKey, {
				title: "Task 1",
				type: "task",
				priority: 2,
			});
			const cell2 = await cells.createCell(projectKey, {
				title: "Task 2",
				type: "task",
				priority: 2,
			});

			const dep = await cells.addDependency(
				projectKey,
				cell1.id,
				cell2.id,
				"blocks",
			);

			expect(dep.cell_id).toBe(cell1.id);
			expect(dep.depends_on_id).toBe(cell2.id);
			expect(dep.relationship).toBe("blocks");
		});

		test("prevents self-dependency", async () => {
			const cell = await cells.createCell(projectKey, {
				title: "Task",
				type: "task",
				priority: 2,
			});

			await expect(
				cells.addDependency(projectKey, cell.id, cell.id, "blocks"),
			).rejects.toThrow(/cannot depend on itself/i);
		});

		test("prevents direct cycle", async () => {
			const cell1 = await cells.createCell(projectKey, {
				title: "Task 1",
				type: "task",
				priority: 2,
			});
			const cell2 = await cells.createCell(projectKey, {
				title: "Task 2",
				type: "task",
				priority: 2,
			});

			// Add A -> B
			await cells.addDependency(projectKey, cell1.id, cell2.id, "blocks");

			// Try to add B -> A (cycle)
			await expect(
				cells.addDependency(projectKey, cell2.id, cell1.id, "blocks"),
			).rejects.toThrow(/cycle/i);
		});

		test("prevents transitive cycle", async () => {
			const cell1 = await cells.createCell(projectKey, {
				title: "Task 1",
				type: "task",
				priority: 2,
			});
			const cell2 = await cells.createCell(projectKey, {
				title: "Task 2",
				type: "task",
				priority: 2,
			});
			const cell3 = await cells.createCell(projectKey, {
				title: "Task 3",
				type: "task",
				priority: 2,
			});

			// Add A -> B -> C
			await cells.addDependency(projectKey, cell1.id, cell2.id, "blocks");
			await cells.addDependency(projectKey, cell2.id, cell3.id, "blocks");

			// Try to add C -> A (cycle)
			await expect(
				cells.addDependency(projectKey, cell3.id, cell1.id, "blocks"),
			).rejects.toThrow(/cycle/i);
		});

		test("allows related dependencies (non-blocking)", async () => {
			const cell1 = await cells.createCell(projectKey, {
				title: "Task 1",
				type: "task",
				priority: 2,
			});
			const cell2 = await cells.createCell(projectKey, {
				title: "Task 2",
				type: "task",
				priority: 2,
			});

			const dep = await cells.addDependency(
				projectKey,
				cell1.id,
				cell2.id,
				"related",
			);

			expect(dep.relationship).toBe("related");
		});

		test("allows multiple dependency types between same cells", async () => {
			const cell1 = await cells.createCell(projectKey, {
				title: "Task 1",
				type: "task",
				priority: 2,
			});
			const cell2 = await cells.createCell(projectKey, {
				title: "Task 2",
				type: "task",
				priority: 2,
			});

			await cells.addDependency(projectKey, cell1.id, cell2.id, "blocks");
			await cells.addDependency(projectKey, cell1.id, cell2.id, "related");

			const deps = await cells.getDependencies(projectKey, cell1.id);
			expect(deps).toHaveLength(2);
		});
	});

	describe("removeDependency", () => {
		test("removes a dependency", async () => {
			const cell1 = await cells.createCell(projectKey, {
				title: "Task 1",
				type: "task",
				priority: 2,
			});
			const cell2 = await cells.createCell(projectKey, {
				title: "Task 2",
				type: "task",
				priority: 2,
			});

			await cells.addDependency(projectKey, cell1.id, cell2.id, "blocks");
			await cells.removeDependency(projectKey, cell1.id, cell2.id, "blocks");

			const deps = await cells.getDependencies(projectKey, cell1.id);
			expect(deps).toHaveLength(0);
		});

		test("removes specific relationship type only", async () => {
			const cell1 = await cells.createCell(projectKey, {
				title: "Task 1",
				type: "task",
				priority: 2,
			});
			const cell2 = await cells.createCell(projectKey, {
				title: "Task 2",
				type: "task",
				priority: 2,
			});

			await cells.addDependency(projectKey, cell1.id, cell2.id, "blocks");
			await cells.addDependency(projectKey, cell1.id, cell2.id, "related");

			await cells.removeDependency(projectKey, cell1.id, cell2.id, "blocks");

			const deps = await cells.getDependencies(projectKey, cell1.id);
			expect(deps).toHaveLength(1);
			expect(deps[0].relationship).toBe("related");
		});
	});

	describe("getDependencies", () => {
		test("returns dependencies for a cell", async () => {
			const cell1 = await cells.createCell(projectKey, {
				title: "Task 1",
				type: "task",
				priority: 2,
			});
			const cell2 = await cells.createCell(projectKey, {
				title: "Task 2",
				type: "task",
				priority: 2,
			});
			const cell3 = await cells.createCell(projectKey, {
				title: "Task 3",
				type: "task",
				priority: 2,
			});

			await cells.addDependency(projectKey, cell1.id, cell2.id, "blocks");
			await cells.addDependency(projectKey, cell1.id, cell3.id, "related");

			const deps = await cells.getDependencies(projectKey, cell1.id);
			expect(deps).toHaveLength(2);
			expect(deps.map((d) => d.depends_on_id).sort()).toEqual(
				[cell2.id, cell3.id].sort(),
			);
		});

		test("returns empty array when no dependencies", async () => {
			const cell = await cells.createCell(projectKey, {
				title: "Task",
				type: "task",
				priority: 2,
			});

			const deps = await cells.getDependencies(projectKey, cell.id);
			expect(deps).toHaveLength(0);
		});
	});

	describe("getDependents", () => {
		test("returns cells that depend on this cell", async () => {
			const cell1 = await cells.createCell(projectKey, {
				title: "Task 1",
				type: "task",
				priority: 2,
			});
			const cell2 = await cells.createCell(projectKey, {
				title: "Task 2",
				type: "task",
				priority: 2,
			});
			const cell3 = await cells.createCell(projectKey, {
				title: "Task 3",
				type: "task",
				priority: 2,
			});

			// cell2 and cell3 both depend on cell1
			await cells.addDependency(projectKey, cell2.id, cell1.id, "blocks");
			await cells.addDependency(projectKey, cell3.id, cell1.id, "blocks");

			const dependents = await cells.getDependents(projectKey, cell1.id);
			expect(dependents).toHaveLength(2);
			expect(dependents.map((d) => d.cell_id).sort()).toEqual(
				[cell2.id, cell3.id].sort(),
			);
		});
	});

	describe("isBlocked", () => {
		test("returns false when no blocking dependencies", async () => {
			const cell = await cells.createCell(projectKey, {
				title: "Task",
				type: "task",
				priority: 2,
			});

			const blocked = await cells.isBlocked(projectKey, cell.id);
			expect(blocked).toBe(false);
		});

		test("returns true when cell has open blocking dependency", async () => {
			const blocker = await cells.createCell(projectKey, {
				title: "Blocker",
				type: "task",
				priority: 2,
			});
			const blocked = await cells.createCell(projectKey, {
				title: "Blocked",
				type: "task",
				priority: 2,
			});

			await cells.addDependency(projectKey, blocked.id, blocker.id, "blocks");

			const isBlocked = await cells.isBlocked(projectKey, blocked.id);
			expect(isBlocked).toBe(true);
		});

		test("returns false when blocking dependency is closed", async () => {
			const blocker = await cells.createCell(projectKey, {
				title: "Blocker",
				type: "task",
				priority: 2,
			});
			const blocked = await cells.createCell(projectKey, {
				title: "Blocked",
				type: "task",
				priority: 2,
			});

			await cells.addDependency(projectKey, blocked.id, blocker.id, "blocks");
			await cells.closeCell(projectKey, blocker.id, "Done");

			// Need to rebuild blocked cache after status change
			await cells.rebuildBlockedCache(projectKey);

			const isBlocked = await cells.isBlocked(projectKey, blocked.id);
			expect(isBlocked).toBe(false);
		});

		test("returns false for non-blocking dependency types", async () => {
			const cell1 = await cells.createCell(projectKey, {
				title: "Task 1",
				type: "task",
				priority: 2,
			});
			const cell2 = await cells.createCell(projectKey, {
				title: "Task 2",
				type: "task",
				priority: 2,
			});

			await cells.addDependency(projectKey, cell2.id, cell1.id, "related");

			const isBlocked = await cells.isBlocked(projectKey, cell2.id);
			expect(isBlocked).toBe(false);
		});
	});

	describe("getBlockers", () => {
		test("returns blocker IDs for a cell", async () => {
			const blocker1 = await cells.createCell(projectKey, {
				title: "Blocker 1",
				type: "task",
				priority: 2,
			});
			const blocker2 = await cells.createCell(projectKey, {
				title: "Blocker 2",
				type: "task",
				priority: 2,
			});
			const blocked = await cells.createCell(projectKey, {
				title: "Blocked",
				type: "task",
				priority: 2,
			});

			await cells.addDependency(projectKey, blocked.id, blocker1.id, "blocks");
			await cells.addDependency(projectKey, blocked.id, blocker2.id, "blocks");

			const blockers = await cells.getBlockers(projectKey, blocked.id);
			expect(blockers.sort()).toEqual([blocker1.id, blocker2.id].sort());
		});

		test("includes transitive blockers", async () => {
			const blocker1 = await cells.createCell(projectKey, {
				title: "Blocker 1",
				type: "task",
				priority: 2,
			});
			const blocker2 = await cells.createCell(projectKey, {
				title: "Blocker 2",
				type: "task",
				priority: 2,
			});
			const blocked = await cells.createCell(projectKey, {
				title: "Blocked",
				type: "task",
				priority: 2,
			});

			// blocker2 blocks blocker1, blocker1 blocks blocked
			await cells.addDependency(projectKey, blocker1.id, blocker2.id, "blocks");
			await cells.addDependency(projectKey, blocked.id, blocker1.id, "blocks");

			const blockers = await cells.getBlockers(projectKey, blocked.id);
			// Should include both direct (blocker1) and transitive (blocker2)
			expect(blockers.sort()).toEqual([blocker1.id, blocker2.id].sort());
		});
	});

	describe("rebuildBlockedCache", () => {
		test("rebuilds blocked cache for all cells", async () => {
			const blocker = await cells.createCell(projectKey, {
				title: "Blocker",
				type: "task",
				priority: 2,
			});
			const blocked1 = await cells.createCell(projectKey, {
				title: "Blocked 1",
				type: "task",
				priority: 2,
			});
			const blocked2 = await cells.createCell(projectKey, {
				title: "Blocked 2",
				type: "task",
				priority: 2,
			});

			await cells.addDependency(projectKey, blocked1.id, blocker.id, "blocks");
			await cells.addDependency(projectKey, blocked2.id, blocker.id, "blocks");

			// Close blocker
			await cells.closeCell(projectKey, blocker.id, "Done");

			// Rebuild cache
			await cells.rebuildBlockedCache(projectKey);

			// Both should now be unblocked
			expect(await cells.isBlocked(projectKey, blocked1.id)).toBe(false);
			expect(await cells.isBlocked(projectKey, blocked2.id)).toBe(false);
		});
	});
});
