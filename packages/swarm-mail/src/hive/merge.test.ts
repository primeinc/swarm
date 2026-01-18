/**
 * Tests for 3-Way Merge Driver
 *
 * Covers:
 * - Basic 3-way merge scenarios
 * - Tombstone semantics (soft-delete wins, expired allows resurrection)
 * - Field-level merge rules
 * - Conflict resolution
 *
 * @module hive/merge.test
 */

import { describe, expect, it } from "bun:test";
import type { CellExport } from "./jsonl.js";
import {
	CLOCK_SKEW_GRACE_MS,
	DEFAULT_TOMBSTONE_TTL_MS,
	isExpiredTombstone,
	isTombstone,
	merge3Way,
	mergeJsonl,
	STATUS_TOMBSTONE,
} from "./merge.js";

// ============================================================================
// Test Helpers
// ============================================================================

function makeCell(overrides: Partial<CellExport> = {}): CellExport {
	return {
		id: "cell-test",
		title: "Test cell",
		status: "open",
		priority: 2,
		issue_type: "task",
		created_at: "2024-01-01T00:00:00Z",
		updated_at: "2024-01-01T00:00:00Z",
		dependencies: [],
		labels: [],
		comments: [],
		...overrides,
	};
}

function makeTombstone(overrides: Partial<CellExport> = {}): CellExport {
	return makeCell({
		status: "tombstone",
		closed_at: new Date().toISOString(),
		...overrides,
	});
}

// ============================================================================
// Tombstone Helpers
// ============================================================================

describe("isTombstone", () => {
	it("returns true for tombstone status", () => {
		const cell = makeCell({ status: "tombstone" });
		expect(isTombstone(cell)).toBe(true);
	});

	it("returns false for open status", () => {
		const cell = makeCell({ status: "open" });
		expect(isTombstone(cell)).toBe(false);
	});

	it("returns false for closed status", () => {
		const cell = makeCell({ status: "closed" });
		expect(isTombstone(cell)).toBe(false);
	});
});

describe("isExpiredTombstone", () => {
	it("returns false for non-tombstone", () => {
		const cell = makeCell({ status: "open" });
		expect(isExpiredTombstone(cell)).toBe(false);
	});

	it("returns false for tombstone without closed_at", () => {
		const cell = makeCell({ status: "tombstone", closed_at: undefined });
		expect(isExpiredTombstone(cell)).toBe(false);
	});

	it("returns false for recent tombstone", () => {
		const cell = makeTombstone({
			closed_at: new Date().toISOString(),
		});
		expect(isExpiredTombstone(cell)).toBe(false);
	});

	it("returns true for expired tombstone (past TTL + grace)", () => {
		const expiredDate = new Date(
			Date.now() - DEFAULT_TOMBSTONE_TTL_MS - CLOCK_SKEW_GRACE_MS - 1000,
		);
		const cell = makeTombstone({
			closed_at: expiredDate.toISOString(),
		});
		expect(isExpiredTombstone(cell)).toBe(true);
	});

	it("respects custom TTL", () => {
		const customTtl = 1000; // 1 second
		const expiredDate = new Date(
			Date.now() - customTtl - CLOCK_SKEW_GRACE_MS - 1000,
		);
		const cell = makeTombstone({
			closed_at: expiredDate.toISOString(),
		});
		expect(isExpiredTombstone(cell, customTtl)).toBe(true);
	});

	it("returns false for invalid timestamp", () => {
		const cell = makeTombstone({
			closed_at: "invalid-date",
		});
		expect(isExpiredTombstone(cell)).toBe(false);
	});
});

// ============================================================================
// Basic 3-Way Merge
// ============================================================================

describe("merge3Way - basic scenarios", () => {
	it("returns empty for empty inputs", () => {
		const { merged, conflicts } = merge3Way([], [], []);
		expect(merged).toEqual([]);
		expect(conflicts).toEqual([]);
	});

	it("preserves unchanged cell", () => {
		const cell = makeCell({ id: "cell-1" });
		const { merged, conflicts } = merge3Way([cell], [cell], [cell]);

		expect(merged).toHaveLength(1);
		expect(merged[0].id).toBe("cell-1");
		expect(conflicts).toEqual([]);
	});

	it("adds cell from left only", () => {
		const cell = makeCell({ id: "cell-new" });
		const { merged, conflicts } = merge3Way([], [cell], []);

		expect(merged).toHaveLength(1);
		expect(merged[0].id).toBe("cell-new");
		expect(conflicts).toEqual([]);
	});

	it("adds cell from right only", () => {
		const cell = makeCell({ id: "cell-new" });
		const { merged, conflicts } = merge3Way([], [], [cell]);

		expect(merged).toHaveLength(1);
		expect(merged[0].id).toBe("cell-new");
		expect(conflicts).toEqual([]);
	});

	it("merges cells added in both (same content)", () => {
		const cell = makeCell({ id: "cell-new" });
		const { merged, conflicts } = merge3Way([], [cell], [cell]);

		expect(merged).toHaveLength(1);
		expect(merged[0].id).toBe("cell-new");
		expect(conflicts).toEqual([]);
	});

	it("deletes cell removed from right", () => {
		const cell = makeCell({ id: "cell-1" });
		const { merged, conflicts } = merge3Way([cell], [cell], []);

		// Deletion wins
		expect(merged).toHaveLength(0);
		expect(conflicts).toEqual([]);
	});

	it("deletes cell removed from left", () => {
		const cell = makeCell({ id: "cell-1" });
		const { merged, conflicts } = merge3Way([cell], [], [cell]);

		// Deletion wins
		expect(merged).toHaveLength(0);
		expect(conflicts).toEqual([]);
	});
});

// ============================================================================
// Field-Level Merge
// ============================================================================

describe("merge3Way - field merge", () => {
	it("takes left change when only left changed", () => {
		const base = makeCell({ id: "cell-1", title: "Original" });
		const left = makeCell({ id: "cell-1", title: "Left Change" });
		const right = makeCell({ id: "cell-1", title: "Original" });

		const { merged } = merge3Way([base], [left], [right]);

		expect(merged[0].title).toBe("Left Change");
	});

	it("takes right change when only right changed", () => {
		const base = makeCell({ id: "cell-1", title: "Original" });
		const left = makeCell({ id: "cell-1", title: "Original" });
		const right = makeCell({ id: "cell-1", title: "Right Change" });

		const { merged } = merge3Way([base], [left], [right]);

		expect(merged[0].title).toBe("Right Change");
	});

	it("resolves title conflict by updated_at (left wins)", () => {
		const base = makeCell({ id: "cell-1", title: "Original" });
		const left = makeCell({
			id: "cell-1",
			title: "Left Change",
			updated_at: "2024-01-02T00:00:00Z",
		});
		const right = makeCell({
			id: "cell-1",
			title: "Right Change",
			updated_at: "2024-01-01T12:00:00Z",
		});

		const { merged } = merge3Way([base], [left], [right]);

		expect(merged[0].title).toBe("Left Change");
	});

	it("resolves title conflict by updated_at (right wins)", () => {
		const base = makeCell({ id: "cell-1", title: "Original" });
		const left = makeCell({
			id: "cell-1",
			title: "Left Change",
			updated_at: "2024-01-01T12:00:00Z",
		});
		const right = makeCell({
			id: "cell-1",
			title: "Right Change",
			updated_at: "2024-01-02T00:00:00Z",
		});

		const { merged } = merge3Way([base], [left], [right]);

		expect(merged[0].title).toBe("Right Change");
	});

	it("closed status wins over open", () => {
		const base = makeCell({ id: "cell-1", status: "open" });
		const left = makeCell({ id: "cell-1", status: "open" });
		const right = makeCell({ id: "cell-1", status: "closed" });

		const { merged } = merge3Way([base], [left], [right]);

		expect(merged[0].status).toBe("closed");
	});

	it("higher priority wins (lower number)", () => {
		const base = makeCell({ id: "cell-1", priority: 2 });
		const left = makeCell({ id: "cell-1", priority: 1 }); // Higher priority
		const right = makeCell({ id: "cell-1", priority: 3 });

		const { merged } = merge3Way([base], [left], [right]);

		expect(merged[0].priority).toBe(1);
	});

	it("explicit priority wins over 0 (unset)", () => {
		const base = makeCell({ id: "cell-1", priority: 0 });
		const left = makeCell({ id: "cell-1", priority: 0 });
		const right = makeCell({ id: "cell-1", priority: 2 });

		const { merged } = merge3Way([base], [left], [right]);

		expect(merged[0].priority).toBe(2);
	});

	it("merges dependencies (union)", () => {
		const base = makeCell({ id: "cell-1", dependencies: [] });
		const left = makeCell({
			id: "cell-1",
			dependencies: [{ depends_on_id: "cell-a", type: "blocks" }],
		});
		const right = makeCell({
			id: "cell-1",
			dependencies: [{ depends_on_id: "cell-b", type: "related" }],
		});

		const { merged } = merge3Way([base], [left], [right]);

		expect(merged[0].dependencies).toHaveLength(2);
		expect(merged[0].dependencies.map((d) => d.depends_on_id)).toContain(
			"cell-a",
		);
		expect(merged[0].dependencies.map((d) => d.depends_on_id)).toContain(
			"cell-b",
		);
	});

	it("deduplicates dependencies", () => {
		const base = makeCell({ id: "cell-1", dependencies: [] });
		const left = makeCell({
			id: "cell-1",
			dependencies: [{ depends_on_id: "cell-a", type: "blocks" }],
		});
		const right = makeCell({
			id: "cell-1",
			dependencies: [{ depends_on_id: "cell-a", type: "blocks" }],
		});

		const { merged } = merge3Way([base], [left], [right]);

		expect(merged[0].dependencies).toHaveLength(1);
	});

	it("merges labels (union)", () => {
		const base = makeCell({ id: "cell-1", labels: [] });
		const left = makeCell({ id: "cell-1", labels: ["urgent"] });
		const right = makeCell({ id: "cell-1", labels: ["backend"] });

		const { merged } = merge3Way([base], [left], [right]);

		expect(merged[0].labels).toHaveLength(2);
		expect(merged[0].labels).toContain("urgent");
		expect(merged[0].labels).toContain("backend");
	});

	it("merges comments (union)", () => {
		const base = makeCell({ id: "cell-1", comments: [] });
		const left = makeCell({
			id: "cell-1",
			comments: [{ author: "alice", text: "Left comment" }],
		});
		const right = makeCell({
			id: "cell-1",
			comments: [{ author: "bob", text: "Right comment" }],
		});

		const { merged } = merge3Way([base], [left], [right]);

		expect(merged[0].comments).toHaveLength(2);
	});

	it("takes max updated_at", () => {
		const base = makeCell({ id: "cell-1", updated_at: "2024-01-01T00:00:00Z" });
		const left = makeCell({ id: "cell-1", updated_at: "2024-01-02T00:00:00Z" });
		const right = makeCell({
			id: "cell-1",
			updated_at: "2024-01-03T00:00:00Z",
		});

		const { merged } = merge3Way([base], [left], [right]);

		expect(merged[0].updated_at).toBe("2024-01-03T00:00:00Z");
	});
});

// ============================================================================
// Tombstone Semantics
// ============================================================================

describe("merge3Way - tombstone semantics", () => {
	it("tombstone wins over live (left tombstone)", () => {
		const base = makeCell({ id: "cell-1" });
		const left = makeTombstone({ id: "cell-1" });
		const right = makeCell({ id: "cell-1", title: "Modified" });

		const { merged } = merge3Way([base], [left], [right]);

		expect(merged).toHaveLength(1);
		expect(merged[0].status).toBe(STATUS_TOMBSTONE);
	});

	it("tombstone wins over live (right tombstone)", () => {
		const base = makeCell({ id: "cell-1" });
		const left = makeCell({ id: "cell-1", title: "Modified" });
		const right = makeTombstone({ id: "cell-1" });

		const { merged } = merge3Way([base], [left], [right]);

		expect(merged).toHaveLength(1);
		expect(merged[0].status).toBe(STATUS_TOMBSTONE);
	});

	it("expired tombstone allows resurrection (left expired)", () => {
		const expiredDate = new Date(
			Date.now() - DEFAULT_TOMBSTONE_TTL_MS - CLOCK_SKEW_GRACE_MS - 1000,
		);
		const base = makeCell({ id: "cell-1" });
		const left = makeTombstone({
			id: "cell-1",
			closed_at: expiredDate.toISOString(),
		});
		const right = makeCell({ id: "cell-1", title: "Resurrected" });

		const { merged } = merge3Way([base], [left], [right]);

		expect(merged).toHaveLength(1);
		expect(merged[0].status).not.toBe(STATUS_TOMBSTONE);
		expect(merged[0].title).toBe("Resurrected");
	});

	it("expired tombstone allows resurrection (right expired)", () => {
		const expiredDate = new Date(
			Date.now() - DEFAULT_TOMBSTONE_TTL_MS - CLOCK_SKEW_GRACE_MS - 1000,
		);
		const base = makeCell({ id: "cell-1" });
		const left = makeCell({ id: "cell-1", title: "Resurrected" });
		const right = makeTombstone({
			id: "cell-1",
			closed_at: expiredDate.toISOString(),
		});

		const { merged } = merge3Way([base], [left], [right]);

		expect(merged).toHaveLength(1);
		expect(merged[0].status).not.toBe(STATUS_TOMBSTONE);
		expect(merged[0].title).toBe("Resurrected");
	});

	it("merges two tombstones (later deleted_at wins)", () => {
		const base = makeCell({ id: "cell-1" });
		const left = makeTombstone({
			id: "cell-1",
			closed_at: "2024-01-01T00:00:00Z",
		});
		const right = makeTombstone({
			id: "cell-1",
			closed_at: "2024-01-02T00:00:00Z",
		});

		const { merged } = merge3Way([base], [left], [right]);

		expect(merged).toHaveLength(1);
		expect(merged[0].status).toBe(STATUS_TOMBSTONE);
		expect(merged[0].closed_at).toBe("2024-01-02T00:00:00Z");
	});

	it("preserves tombstone when other side deleted", () => {
		const base = makeCell({ id: "cell-1" });
		const left = makeTombstone({ id: "cell-1" });
		// Right has no entry (implicit deletion)

		const { merged } = merge3Way([base], [left], []);

		expect(merged).toHaveLength(1);
		expect(merged[0].status).toBe(STATUS_TOMBSTONE);
	});

	it("tombstone added in both (merge tombstones)", () => {
		// Not in base, both sides added as tombstone
		const left = makeTombstone({
			id: "cell-1",
			closed_at: "2024-01-01T00:00:00Z",
		});
		const right = makeTombstone({
			id: "cell-1",
			closed_at: "2024-01-02T00:00:00Z",
		});

		const { merged } = merge3Way([], [left], [right]);

		expect(merged).toHaveLength(1);
		expect(merged[0].status).toBe(STATUS_TOMBSTONE);
		expect(merged[0].closed_at).toBe("2024-01-02T00:00:00Z");
	});
});

// ============================================================================
// JSONL Convenience Wrapper
// ============================================================================

describe("mergeJsonl", () => {
	it("merges JSONL strings", () => {
		const base = JSON.stringify(makeCell({ id: "cell-1", title: "Original" }));
		const left = JSON.stringify(makeCell({ id: "cell-1", title: "Left" }));
		const right = JSON.stringify(makeCell({ id: "cell-1", title: "Original" }));

		const { jsonl, conflicts } = mergeJsonl(base, left, right);

		const merged = JSON.parse(jsonl);
		expect(merged.title).toBe("Left");
		expect(conflicts).toEqual([]);
	});

	it("handles empty inputs", () => {
		const { jsonl, conflicts } = mergeJsonl("", "", "");

		expect(jsonl).toBe("");
		expect(conflicts).toEqual([]);
	});

	it("handles multi-line JSONL", () => {
		const cell1 = makeCell({ id: "cell-1" });
		const cell2 = makeCell({ id: "cell-2" });

		const base = [JSON.stringify(cell1), JSON.stringify(cell2)].join("\n");
		const left = base;
		const right = base;

		const { jsonl, conflicts } = mergeJsonl(base, left, right);

		const lines = jsonl.split("\n").filter((l) => l.trim());
		expect(lines).toHaveLength(2);
		expect(conflicts).toEqual([]);
	});
});

// ============================================================================
// Edge Cases
// ============================================================================

describe("merge3Way - edge cases", () => {
	it("handles multiple cells", () => {
		const base = [makeCell({ id: "cell-1" }), makeCell({ id: "cell-2" })];
		const left = [
			makeCell({ id: "cell-1", title: "Modified 1" }),
			makeCell({ id: "cell-2" }),
			makeCell({ id: "cell-3" }), // Added
		];
		const right = [
			makeCell({ id: "cell-1" }),
			makeCell({ id: "cell-2", title: "Modified 2" }),
		];

		const { merged, conflicts } = merge3Way(base, left, right);

		expect(merged).toHaveLength(3);
		expect(conflicts).toEqual([]);

		const bd1 = merged.find((b) => b.id === "cell-1");
		const bd2 = merged.find((b) => b.id === "cell-2");
		const bd3 = merged.find((b) => b.id === "cell-3");

		expect(bd1?.title).toBe("Modified 1");
		expect(bd2?.title).toBe("Modified 2");
		expect(bd3).toBeDefined();
	});

	it("handles cells with same ID but different created_at", () => {
		// Different created_at means different keys
		const cell1 = makeCell({
			id: "cell-1",
			created_at: "2024-01-01T00:00:00Z",
		});
		const cell2 = makeCell({
			id: "cell-1",
			created_at: "2024-01-02T00:00:00Z",
		});

		const { merged } = merge3Way([], [cell1], [cell2]);

		// Both should be preserved (different keys)
		expect(merged).toHaveLength(2);
	});

	it("handles invalid timestamps gracefully", () => {
		const base = makeCell({ id: "cell-1", updated_at: "invalid" });
		const left = makeCell({ id: "cell-1", updated_at: "also-invalid" });
		const right = makeCell({
			id: "cell-1",
			updated_at: "2024-01-01T00:00:00Z",
		});

		// Should not throw
		const { merged } = merge3Way([base], [left], [right]);
		expect(merged).toHaveLength(1);
	});

	it("debug mode logs without affecting result", () => {
		const cell = makeCell({ id: "cell-1" });

		const { merged, conflicts } = merge3Way([cell], [cell], [cell], {
			debug: true,
		});

		expect(merged).toHaveLength(1);
		expect(conflicts).toEqual([]);
	});
});
