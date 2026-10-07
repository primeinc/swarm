/**
 * @fileoverview Tests for tree-renderer.ts
 *
 * TDD approach: Write tests first, then implement.
 * Test pure functions for ASCII tree rendering.
 *
 * Inspired by Chainlink's tree visualization.
 * Credit: https://github.com/dollspace-gay/chainlink
 */

import { describe, expect, test } from "bun:test";
import {
  renderTreeNode,
  buildTreeStructure,
  formatCellLine,
  getStatusIndicator,
  getPriorityLabel,
  type TreeNode,
} from "./tree-renderer.js";

describe("getStatusIndicator", () => {
  test("returns ○ for open", () => {
    expect(getStatusIndicator("open")).toBe("○");
  });

  test("returns ◐ for in_progress", () => {
    expect(getStatusIndicator("in_progress")).toBe("◐");
  });

  test("returns ● for closed", () => {
    expect(getStatusIndicator("closed")).toBe("●");
  });

  test("returns ⊘ for blocked", () => {
    expect(getStatusIndicator("blocked")).toBe("⊘");
  });
});

describe("getPriorityLabel", () => {
  test("returns P0 for priority 0", () => {
    expect(getPriorityLabel(0)).toBe("P0");
  });

  test("returns P1 for priority 1", () => {
    expect(getPriorityLabel(1)).toBe("P1");
  });

  test("returns P2 for priority 2", () => {
    expect(getPriorityLabel(2)).toBe("P2");
  });

  test("returns P3 for priority 3", () => {
    expect(getPriorityLabel(3)).toBe("P3");
  });

  test("returns empty for negative priority", () => {
    expect(getPriorityLabel(-1)).toBe("");
  });

  test("returns empty for priority > 3", () => {
    expect(getPriorityLabel(4)).toBe("");
  });
});

describe("formatCellLine", () => {
  test("formats cell with all attributes", () => {
    const result = formatCellLine({
      title: "Test Task",
      type: "task",
      status: "open",
      priority: 1,
      blocked: false,
    });
    
    expect(result).toContain("Test Task");
    expect(result).toContain("[task]");
    expect(result).toContain("○"); // open
    expect(result).toContain("P1");
  });

  test("formats epic type", () => {
    const result = formatCellLine({
      title: "Epic Title",
      type: "epic",
      status: "in_progress",
      priority: 0,
      blocked: false,
    });
    
    expect(result).toContain("[epic]");
    expect(result).toContain("◐"); // in_progress
    expect(result).toContain("P0");
  });

  test("formats blocked cell", () => {
    const result = formatCellLine({
      title: "Blocked Task",
      type: "task",
      status: "blocked",
      priority: 2,
      blocked: true,
    });
    
    expect(result).toContain("⊘"); // blocked indicator
  });

  test("omits priority label when priority not in range", () => {
    const result = formatCellLine({
      title: "Task",
      type: "task",
      status: "open",
      priority: 5,
      blocked: false,
    });
    
    expect(result).not.toContain("P5");
  });
});

describe("buildTreeStructure", () => {
  test("builds flat structure when no parent_id", () => {
    const cells = [
      { id: "cell-1", title: "Task 1", status: "open" as const, priority: 1, type: "task" as const, parent_id: null },
      { id: "cell-2", title: "Task 2", status: "open" as const, priority: 2, type: "task" as const, parent_id: null },
    ];
    
    const tree = buildTreeStructure(cells);
    
    expect(tree).toHaveLength(2);
    expect(tree[0].cell.id).toBe("cell-1");
    expect(tree[1].cell.id).toBe("cell-2");
    expect(tree[0].children).toEqual([]);
    expect(tree[1].children).toEqual([]);
  });

  test("nests children under parent", () => {
    const cells = [
      { id: "epic-1", title: "Epic", status: "open" as const, priority: 0, type: "epic" as const, parent_id: null },
      { id: "task-1", title: "Task 1", status: "open" as const, priority: 1, type: "task" as const, parent_id: "epic-1" },
      { id: "task-2", title: "Task 2", status: "open" as const, priority: 2, type: "task" as const, parent_id: "epic-1" },
    ];
    
    const tree = buildTreeStructure(cells);
    
    expect(tree).toHaveLength(1); // Only epic at root
    expect(tree[0].cell.id).toBe("epic-1");
    expect(tree[0].children).toHaveLength(2);
    expect(tree[0].children[0].cell.id).toBe("task-1");
    expect(tree[0].children[1].cell.id).toBe("task-2");
  });

  test("handles multi-level nesting", () => {
    const cells = [
      { id: "epic-1", title: "Epic", status: "open" as const, priority: 0, type: "epic" as const, parent_id: null },
      { id: "task-1", title: "Task 1", status: "open" as const, priority: 1, type: "task" as const, parent_id: "epic-1" },
      { id: "subtask-1", title: "Subtask", status: "open" as const, priority: 2, type: "task" as const, parent_id: "task-1" },
    ];
    
    const tree = buildTreeStructure(cells);
    
    expect(tree[0].children[0].children).toHaveLength(1);
    expect(tree[0].children[0].children[0].cell.id).toBe("subtask-1");
  });

  test("orphans without parent go to root", () => {
    const cells = [
      { id: "task-1", title: "Task", status: "open" as const, priority: 1, type: "task" as const, parent_id: "nonexistent" },
    ];
    
    const tree = buildTreeStructure(cells);
    
    expect(tree).toHaveLength(1);
    expect(tree[0].cell.id).toBe("task-1");
  });
});

describe("renderTreeNode", () => {
  test("renders single node without children", () => {
    const node: TreeNode = {
      cell: {
        id: "cell-1",
        title: "Task",
        status: "open",
        priority: 1,
        type: "task",
        parent_id: null,
      },
      children: [],
    };
    
    const lines = renderTreeNode(node, "", true);
    
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("Task");
    expect(lines[0]).toContain("[task]");
    expect(lines[0]).toContain("○");
    expect(lines[0]).toContain("P1");
  });

  test("renders parent with single child", () => {
    const node: TreeNode = {
      cell: {
        id: "epic-1",
        title: "Epic",
        status: "open",
        priority: 0,
        type: "epic",
        parent_id: null,
      },
      children: [
        {
          cell: {
            id: "task-1",
            title: "Task",
            status: "open",
            priority: 1,
            type: "task",
            parent_id: "epic-1",
          },
          children: [],
        },
      ],
    };
    
    const lines = renderTreeNode(node, "", true);
    
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("Epic");
    expect(lines[1]).toContain("└──"); // Last child connector
    expect(lines[1]).toContain("Task");
  });

  test("renders parent with multiple children", () => {
    const node: TreeNode = {
      cell: {
        id: "epic-1",
        title: "Epic",
        status: "open",
        priority: 0,
        type: "epic",
        parent_id: null,
      },
      children: [
        {
          cell: {
            id: "task-1",
            title: "Task 1",
            status: "open",
            priority: 1,
            type: "task",
            parent_id: "epic-1",
          },
          children: [],
        },
        {
          cell: {
            id: "task-2",
            title: "Task 2",
            status: "open",
            priority: 2,
            type: "task",
            parent_id: "epic-1",
          },
          children: [],
        },
      ],
    };
    
    const lines = renderTreeNode(node, "", true);
    
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain("Epic");
    expect(lines[1]).toContain("├──"); // Non-last child connector
    expect(lines[1]).toContain("Task 1");
    expect(lines[2]).toContain("└──"); // Last child connector
    expect(lines[2]).toContain("Task 2");
  });

  test("handles deep nesting with correct prefixes", () => {
    const node: TreeNode = {
      cell: {
        id: "epic-1",
        title: "Epic",
        status: "open",
        priority: 0,
        type: "epic",
        parent_id: null,
      },
      children: [
        {
          cell: {
            id: "task-1",
            title: "Task",
            status: "open",
            priority: 1,
            type: "task",
            parent_id: "epic-1",
          },
          children: [
            {
              cell: {
                id: "subtask-1",
                title: "Subtask",
                status: "open",
                priority: 2,
                type: "task",
                parent_id: "task-1",
              },
              children: [],
            },
          ],
        },
      ],
    };
    
    const lines = renderTreeNode(node, "", true);
    
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain("Epic");
    expect(lines[1]).toContain("└──");
    expect(lines[1]).toContain("Task");
    expect(lines[2]).toContain("    └──"); // Indented for nesting
    expect(lines[2]).toContain("Subtask");
  });
});
