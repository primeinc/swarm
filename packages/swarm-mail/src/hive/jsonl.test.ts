/**
 * Tests for JSONL export/import
 *
 * Covers:
 * - Export full cells to JSONL
 * - Export dirty cells only (incremental)
 * - Import from JSONL (new cells, updates, hash dedup)
 * - Parse/serialize JSONL
 * - Content hash computation
 *
 * @module cells/jsonl.test
 */

import { beforeEach, describe, expect, it } from "bun:test";
import { createTestLibSQLDb } from "../test-libsql.js";
import type { HiveAdapter } from "../types/hive-adapter.js";
import { createHiveAdapter } from "./adapter.js";
import {
	type CellExport,
	computeContentHash,
	exportDirtycells,
	exportToJSONL,
	importFromJSONL,
	parseJSONL,
	serializeToJSONL,
} from "./jsonl.js";

describe("JSONL Export/Import", () => {
	let adapter: HiveAdapter;
	const projectKey = "/test/jsonl";

	beforeEach(async () => {
		const { adapter: db } = await createTestLibSQLDb();
		adapter = createHiveAdapter(db, projectKey);
	});

	describe("serializeToJSONL", () => {
		it("serializes cell to single JSONL line with trailing newline", () => {
			const cell: CellExport = {
				id: "bd-abc123",
				title: "Fix bug",
				description: "Something broke",
				status: "open",
				priority: 2,
				issue_type: "bug",
				created_at: "2024-01-01T00:00:00Z",
				updated_at: "2024-01-01T00:00:00Z",
				dependencies: [],
				labels: [],
				comments: [],
			};

			const line = serializeToJSONL(cell);

			expect(line.endsWith("\n")).toBe(true);
			expect(JSON.parse(line.trim())).toEqual(cell); // trim() to remove trailing \n before parsing
		});

		it("serializes cell with dependencies, labels, comments", () => {
			const cell: CellExport = {
				id: "bd-abc123",
				title: "Feature",
				status: "open",
				priority: 1,
				issue_type: "feature",
				created_at: "2024-01-01T00:00:00Z",
				updated_at: "2024-01-01T00:00:00Z",
				dependencies: [{ depends_on_id: "bd-xyz", type: "blocks" }],
				labels: ["urgent", "backend"],
				comments: [{ author: "alice", text: "Need this ASAP" }],
			};

			const line = serializeToJSONL(cell);
			const parsed = JSON.parse(line) as CellExport;

			expect(parsed.dependencies).toHaveLength(1);
			expect(parsed.labels).toHaveLength(2);
			expect(parsed.comments).toHaveLength(1);
		});
	});

	describe("parseJSONL", () => {
		it("parses empty string to empty array", () => {
			expect(parseJSONL("")).toEqual([]);
		});

		it("parses single line", () => {
			const line = JSON.stringify({
				id: "bd-abc123",
				title: "Task",
				status: "open",
				priority: 2,
				issue_type: "task",
				created_at: "2024-01-01T00:00:00Z",
				updated_at: "2024-01-01T00:00:00Z",
				dependencies: [],
				labels: [],
				comments: [],
			});

			const cells = parseJSONL(line);

			expect(cells).toHaveLength(1);
			expect(cells[0].id).toBe("bd-abc123");
		});

		it("parses multiple lines", () => {
			const jsonl = [
				JSON.stringify({
					id: "bd-1",
					title: "A",
					status: "open",
					priority: 2,
					issue_type: "task",
					created_at: "2024-01-01T00:00:00Z",
					updated_at: "2024-01-01T00:00:00Z",
					dependencies: [],
					labels: [],
					comments: [],
				}),
				JSON.stringify({
					id: "bd-2",
					title: "B",
					status: "open",
					priority: 2,
					issue_type: "task",
					created_at: "2024-01-01T00:00:00Z",
					updated_at: "2024-01-01T00:00:00Z",
					dependencies: [],
					labels: [],
					comments: [],
				}),
			].join("\n");

			const cells = parseJSONL(jsonl);

			expect(cells).toHaveLength(2);
			expect(cells[0].id).toBe("bd-1");
			expect(cells[1].id).toBe("bd-2");
		});

		it("skips empty lines", () => {
			const jsonl = [
				JSON.stringify({
					id: "bd-1",
					title: "A",
					status: "open",
					priority: 2,
					issue_type: "task",
					created_at: "2024-01-01T00:00:00Z",
					updated_at: "2024-01-01T00:00:00Z",
					dependencies: [],
					labels: [],
					comments: [],
				}),
				"",
				JSON.stringify({
					id: "bd-2",
					title: "B",
					status: "open",
					priority: 2,
					issue_type: "task",
					created_at: "2024-01-01T00:00:00Z",
					updated_at: "2024-01-01T00:00:00Z",
					dependencies: [],
					labels: [],
					comments: [],
				}),
			].join("\n");

			const cells = parseJSONL(jsonl);

			expect(cells).toHaveLength(2);
		});

		it("throws on invalid JSON", () => {
			expect(() => parseJSONL("not json")).toThrow();
		});
	});

	describe("computeContentHash", () => {
		it("computes stable hash for same content", () => {
			const cell: CellExport = {
				id: "bd-abc123",
				title: "Fix bug",
				status: "open",
				priority: 2,
				issue_type: "bug",
				created_at: "2024-01-01T00:00:00Z",
				updated_at: "2024-01-01T00:00:00Z",
				dependencies: [],
				labels: [],
				comments: [],
			};

			const hash1 = computeContentHash(cell);
			const hash2 = computeContentHash(cell);

			expect(hash1).toBe(hash2);
			expect(hash1).toHaveLength(64); // SHA-256 hex
		});

		it("different hash for different content", () => {
			const cell1: CellExport = {
				id: "bd-abc123",
				title: "Fix bug",
				status: "open",
				priority: 2,
				issue_type: "bug",
				created_at: "2024-01-01T00:00:00Z",
				updated_at: "2024-01-01T00:00:00Z",
				dependencies: [],
				labels: [],
				comments: [],
			};

			const cell2: CellExport = {
				...cell1,
				title: "Fix different bug",
			};

			expect(computeContentHash(cell1)).not.toBe(computeContentHash(cell2));
		});

		it("different hash for different timestamps", () => {
			const cell1: CellExport = {
				id: "bd-abc123",
				title: "Fix bug",
				status: "open",
				priority: 2,
				issue_type: "bug",
				created_at: "2024-01-01T00:00:00Z",
				updated_at: "2024-01-01T00:00:00Z",
				dependencies: [],
				labels: [],
				comments: [],
			};

			const cell2: CellExport = {
				...cell1,
				updated_at: "2024-01-02T00:00:00Z", // Different timestamp
			};

			// Hash should be different because we include timestamps
			expect(computeContentHash(cell1)).not.toBe(computeContentHash(cell2));
		});
	});

	describe("exportToJSONL", () => {
		it("exports empty project to empty string", async () => {
			const jsonl = await exportToJSONL(adapter, projectKey);

			expect(jsonl).toBe("");
		});

		it("exports single cell", async () => {
			await adapter.createCell(projectKey, {
				title: "Task 1",
				type: "task",
				priority: 2,
			});

			const jsonl = await exportToJSONL(adapter, projectKey);

			const cells = parseJSONL(jsonl);
			expect(cells).toHaveLength(1);
			expect(cells[0].title).toBe("Task 1");
		});

		it("exports multiple cells", async () => {
			await adapter.createCell(projectKey, { title: "Task 1", type: "task" });
			await adapter.createCell(projectKey, { title: "Task 2", type: "bug" });

			const jsonl = await exportToJSONL(adapter, projectKey);

			const cells = parseJSONL(jsonl);
			expect(cells).toHaveLength(2);
		});

		it("exports cells with dependencies", async () => {
			const cell1 = await adapter.createCell(projectKey, {
				title: "Blocker",
				type: "task",
			});
			const cell2 = await adapter.createCell(projectKey, {
				title: "Blocked",
				type: "task",
			});
			await adapter.addDependency(projectKey, cell2.id, cell1.id, "blocks");

			const jsonl = await exportToJSONL(adapter, projectKey);

			const cells = parseJSONL(jsonl);
			const blocked = cells.find((b) => b.id === cell2.id);
			expect(blocked?.dependencies).toHaveLength(1);
			expect(blocked?.dependencies[0].depends_on_id).toBe(cell1.id);
		});

		it("exports cells with labels", async () => {
			const cell = await adapter.createCell(projectKey, {
				title: "Task",
				type: "task",
			});
			await adapter.addLabel(projectKey, cell.id, "urgent");
			await adapter.addLabel(projectKey, cell.id, "backend");

			const jsonl = await exportToJSONL(adapter, projectKey);

			const cells = parseJSONL(jsonl);
			expect(cells[0].labels).toContain("urgent");
			expect(cells[0].labels).toContain("backend");
		});

		it("exports cells with comments", async () => {
			const cell = await adapter.createCell(projectKey, {
				title: "Task",
				type: "task",
			});
			await adapter.addComment(projectKey, cell.id, "alice", "First comment");
			await adapter.addComment(projectKey, cell.id, "bob", "Second comment");

			const jsonl = await exportToJSONL(adapter, projectKey);

			const cells = parseJSONL(jsonl);
			expect(cells[0].comments).toHaveLength(2);
			expect(cells[0].comments[0].author).toBe("alice");
		});

		it("excludes deleted cells by default", async () => {
			const cell = await adapter.createCell(projectKey, {
				title: "Task",
				type: "task",
			});
			await adapter.deleteCell(projectKey, cell.id, {
				deleted_by: "test",
				reason: "cleanup",
			});

			const jsonl = await exportToJSONL(adapter, projectKey);

			expect(jsonl).toBe("");
		});

		it("includes deleted cells when requested", async () => {
			const cell = await adapter.createCell(projectKey, {
				title: "Task",
				type: "task",
			});
			await adapter.deleteCell(projectKey, cell.id, {
				deleted_by: "test",
				reason: "cleanup",
			});

			const jsonl = await exportToJSONL(adapter, projectKey, {
				includeDeleted: true,
			});

			const cells = parseJSONL(jsonl);
			expect(cells).toHaveLength(1);
			expect(cells[0].status).toBe("tombstone");
		});

		it("exports specific cells only", async () => {
			const cell1 = await adapter.createCell(projectKey, {
				title: "Task 1",
				type: "task",
			});
			await adapter.createCell(projectKey, { title: "Task 2", type: "task" });

			const jsonl = await exportToJSONL(adapter, projectKey, {
				cellIds: [cell1.id],
			});

			const cells = parseJSONL(jsonl);
			expect(cells).toHaveLength(1);
			expect(cells[0].id).toBe(cell1.id);
		});
	});

	describe("exportDirtycells", () => {
		it("exports only dirty cells", async () => {
			const cell1 = await adapter.createCell(projectKey, {
				title: "Clean",
				type: "task",
			});
			const cell2 = await adapter.createCell(projectKey, {
				title: "Dirty",
				type: "task",
			});

			// Clear dirty flags
			const db = await adapter.getDatabase();
			await db.query("DELETE FROM dirty_cells", []);

			// Mark only cell2 as dirty
			await db.query(
				"INSERT INTO dirty_cells (cell_id, marked_at) VALUES ($1, $2)",
				[cell2.id, Date.now()],
			);

			const result = await exportDirtycells(adapter, projectKey);

			const cells = parseJSONL(result.jsonl);
			expect(cells).toHaveLength(1);
			expect(cells[0].id).toBe(cell2.id);
			expect(result.cellIds).toEqual([cell2.id]);
		});

		it("returns empty for no dirty cells", async () => {
			await adapter.createCell(projectKey, { title: "Task", type: "task" });

			// Clear dirty flags
			const db = await adapter.getDatabase();
			await db.query("DELETE FROM dirty_cells", []);

			const result = await exportDirtycells(adapter, projectKey);

			expect(result.jsonl).toBe("");
			expect(result.cellIds).toEqual([]);
		});
	});

	describe("JSONL newline bug", () => {
		it("exportToJSONL adds trailing newline so wc -l counts correctly", async () => {
			await adapter.createCell(projectKey, { title: "Task 1", type: "task" });
			await adapter.createCell(projectKey, { title: "Task 2", type: "task" });

			const jsonl = await exportToJSONL(adapter, projectKey);

			// Split by newline - should have 2 records + 1 empty string from trailing newline
			const lines = jsonl.split("\n");
			const nonEmptyLines = lines.filter((l) => l.trim() !== "");

			expect(nonEmptyLines).toHaveLength(2); // 2 records
			expect(jsonl.endsWith("\n")).toBe(true); // MUST end with newline for wc -l
		});

		it("wc -l simulation: count newlines equals record count", async () => {
			await adapter.createCell(projectKey, { title: "Task 1", type: "task" });
			await adapter.createCell(projectKey, { title: "Task 2", type: "task" });
			await adapter.createCell(projectKey, { title: "Task 3", type: "task" });

			const jsonl = await exportToJSONL(adapter, projectKey);

			// wc -l counts newline characters
			const newlineCount = (jsonl.match(/\n/g) || []).length;
			const recordCount = parseJSONL(jsonl).length;

			expect(newlineCount).toBe(recordCount); // Each record has exactly one \n
			expect(newlineCount).toBe(3);
		});

		it("serializeToJSONL adds newline to each record", () => {
			const cell: CellExport = {
				id: "bd-test",
				title: "Test",
				status: "open",
				priority: 2,
				issue_type: "task",
				created_at: "2024-01-01T00:00:00Z",
				updated_at: "2024-01-01T00:00:00Z",
				dependencies: [],
				labels: [],
				comments: [],
			};

			const line = serializeToJSONL(cell);

			expect(line.endsWith("\n")).toBe(true);
			expect(line.split("\n").length).toBe(2); // JSON + empty string from \n
		});

		it("parseJSONL handles files with trailing newlines", () => {
			const jsonl = [
				JSON.stringify({
					id: "bd-1",
					title: "A",
					status: "open",
					priority: 2,
					issue_type: "task",
					created_at: "2024-01-01T00:00:00Z",
					updated_at: "2024-01-01T00:00:00Z",
					dependencies: [],
					labels: [],
					comments: [],
				}),
				JSON.stringify({
					id: "bd-2",
					title: "B",
					status: "open",
					priority: 2,
					issue_type: "task",
					created_at: "2024-01-01T00:00:00Z",
					updated_at: "2024-01-01T00:00:00Z",
					dependencies: [],
					labels: [],
					comments: [],
				}),
				"", // Trailing newline creates empty line
			].join("\n");

			const cells = parseJSONL(jsonl);

			expect(cells).toHaveLength(2); // Should still parse 2 records
		});
	});

	describe("Date handling (ISO strings)", () => {
		it("parseJSONL handles ISO date strings correctly", () => {
			const jsonl = JSON.stringify({
				id: "bd-date123",
				title: "Date test",
				status: "open",
				priority: 2,
				issue_type: "task",
				created_at: "2025-12-19T17:14:05.371Z", // ISO string, not epoch
				updated_at: "2025-12-19T17:14:05.371Z",
				dependencies: [],
				labels: [],
				comments: [],
			});

			const cells = parseJSONL(jsonl);

			expect(cells).toHaveLength(1);
			expect(cells[0].created_at).toBe("2025-12-19T17:14:05.371Z");
			expect(cells[0].updated_at).toBe("2025-12-19T17:14:05.371Z");
		});

		it("exportToJSONL produces valid Date objects from ISO strings", async () => {
			const cell = await adapter.createCell(projectKey, {
				title: "Date export test",
				type: "task",
			});

			const jsonl = await exportToJSONL(adapter, projectKey);
			const cells = parseJSONL(jsonl);

			expect(cells).toHaveLength(1);

			// created_at and updated_at should be valid ISO strings
			const createdDate = new Date(cells[0].created_at);
			const updatedDate = new Date(cells[0].updated_at);

			expect(createdDate.toString()).not.toBe("Invalid Date");
			expect(updatedDate.toString()).not.toBe("Invalid Date");
			expect(Number.isNaN(createdDate.getTime())).toBe(false);
			expect(Number.isNaN(updatedDate.getTime())).toBe(false);
		});

		it("handles undefined closed_at without Invalid Date", async () => {
			const cell = await adapter.createCell(projectKey, {
				title: "Open task",
				type: "task",
			});

			const jsonl = await exportToJSONL(adapter, projectKey);
			const cells = parseJSONL(jsonl);

			expect(cells).toHaveLength(1);
			expect(cells[0].closed_at).toBeUndefined();

			// Re-import should not throw Invalid Date error
			const result = await importFromJSONL(adapter, projectKey, jsonl);
			expect(result.created + result.updated + result.skipped).toBe(1);
		});

		it("handles closed_at ISO string correctly", async () => {
			const cell = await adapter.createCell(projectKey, {
				title: "Closed task",
				type: "task",
			});
			await adapter.closeCell(projectKey, cell.id, "Test complete", {
				closed_by: "test",
			});

			const jsonl = await exportToJSONL(adapter, projectKey);
			const cells = parseJSONL(jsonl);

			expect(cells).toHaveLength(1);
			expect(cells[0].closed_at).toBeDefined();

			// closed_at should be valid ISO string
			const closedDate = new Date(cells[0].closed_at!);
			expect(closedDate.toString()).not.toBe("Invalid Date");
			expect(Number.isNaN(closedDate.getTime())).toBe(false);
		});
	});

	describe("importFromJSONL", () => {
		it("imports new cells", async () => {
			const jsonl = serializeToJSONL({
				id: "bd-new123",
				title: "New task",
				status: "open",
				priority: 2,
				issue_type: "task",
				created_at: "2024-01-01T00:00:00Z",
				updated_at: "2024-01-01T00:00:00Z",
				dependencies: [],
				labels: [],
				comments: [],
			});

			const result = await importFromJSONL(adapter, projectKey, jsonl);

			expect(result.created).toBe(1);
			expect(result.updated).toBe(0);
			expect(result.skipped).toBe(0);

			const cell = await adapter.getCell(projectKey, "bd-new123");
			expect(cell).not.toBeNull();
			expect(cell?.title).toBe("New task");
		});

		it("updates existing cells", async () => {
			const cell = await adapter.createCell(projectKey, {
				title: "Original",
				type: "task",
			});

			const jsonl = serializeToJSONL({
				id: cell.id,
				title: "Updated",
				status: "in_progress",
				priority: 1,
				issue_type: "task",
				created_at: new Date(cell.created_at).toISOString(),
				updated_at: new Date().toISOString(),
				dependencies: [],
				labels: [],
				comments: [],
			});

			const result = await importFromJSONL(adapter, projectKey, jsonl);

			expect(result.created).toBe(0);
			expect(result.updated).toBe(1);

			const updated = await adapter.getCell(projectKey, cell.id);
			expect(updated?.title).toBe("Updated");
			expect(updated?.status).toBe("in_progress");
		});

		it("skips cells with same content hash", async () => {
			const cell = await adapter.createCell(projectKey, {
				title: "Task",
				type: "task",
				priority: 2,
			});

			// Export and re-import (same content)
			const jsonl = await exportToJSONL(adapter, projectKey);
			const result = await importFromJSONL(adapter, projectKey, jsonl);

			expect(result.skipped).toBe(1);
			expect(result.created).toBe(0);
			expect(result.updated).toBe(0);
		});

		it("dry run does not modify database", async () => {
			const jsonl = serializeToJSONL({
				id: "bd-dry123",
				title: "Dry run",
				status: "open",
				priority: 2,
				issue_type: "task",
				created_at: "2024-01-01T00:00:00Z",
				updated_at: "2024-01-01T00:00:00Z",
				dependencies: [],
				labels: [],
				comments: [],
			});

			const result = await importFromJSONL(adapter, projectKey, jsonl, {
				dryRun: true,
			});

			expect(result.created).toBe(1);

			const cell = await adapter.getCell(projectKey, "bd-dry123");
			expect(cell).toBeNull();
		});

		it("skipExisting does not update existing cells", async () => {
			const cell = await adapter.createCell(projectKey, {
				title: "Original",
				type: "task",
			});

			const jsonl = serializeToJSONL({
				id: cell.id,
				title: "Should not update",
				status: "open",
				priority: 2,
				issue_type: "task",
				created_at: new Date(cell.created_at).toISOString(),
				updated_at: new Date().toISOString(),
				dependencies: [],
				labels: [],
				comments: [],
			});

			const result = await importFromJSONL(adapter, projectKey, jsonl, {
				skipExisting: true,
			});

			expect(result.skipped).toBe(1);

			const unchanged = await adapter.getCell(projectKey, cell.id);
			expect(unchanged?.title).toBe("Original");
		});

		it("imports dependencies", async () => {
			const jsonl = [
				serializeToJSONL({
					id: "bd-blocker",
					title: "Blocker",
					status: "open",
					priority: 2,
					issue_type: "task",
					created_at: "2024-01-01T00:00:00Z",
					updated_at: "2024-01-01T00:00:00Z",
					dependencies: [],
					labels: [],
					comments: [],
				}),
				serializeToJSONL({
					id: "bd-blocked",
					title: "Blocked",
					status: "open",
					priority: 2,
					issue_type: "task",
					created_at: "2024-01-01T00:00:00Z",
					updated_at: "2024-01-01T00:00:00Z",
					dependencies: [{ depends_on_id: "bd-blocker", type: "blocks" }],
					labels: [],
					comments: [],
				}),
			].join("\n");

			await importFromJSONL(adapter, projectKey, jsonl);

			const deps = await adapter.getDependencies(projectKey, "bd-blocked");
			expect(deps).toHaveLength(1);
			expect(deps[0].depends_on_id).toBe("bd-blocker");
		});

		it("imports labels", async () => {
			const jsonl = serializeToJSONL({
				id: "bd-labeled",
				title: "Task",
				status: "open",
				priority: 2,
				issue_type: "task",
				created_at: "2024-01-01T00:00:00Z",
				updated_at: "2024-01-01T00:00:00Z",
				dependencies: [],
				labels: ["urgent", "backend"],
				comments: [],
			});

			await importFromJSONL(adapter, projectKey, jsonl);

			const labels = await adapter.getLabels(projectKey, "bd-labeled");
			expect(labels).toContain("urgent");
			expect(labels).toContain("backend");
		});

		it("imports comments", async () => {
			const jsonl = serializeToJSONL({
				id: "bd-commented",
				title: "Task",
				status: "open",
				priority: 2,
				issue_type: "task",
				created_at: "2024-01-01T00:00:00Z",
				updated_at: "2024-01-01T00:00:00Z",
				dependencies: [],
				labels: [],
				comments: [
					{ author: "alice", text: "First" },
					{ author: "bob", text: "Second" },
				],
			});

			await importFromJSONL(adapter, projectKey, jsonl);

			const comments = await adapter.getComments(projectKey, "bd-commented");
			expect(comments).toHaveLength(2);
			expect(comments[0].author).toBe("alice");
		});
	});
});
