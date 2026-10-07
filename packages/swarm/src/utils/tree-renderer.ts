/**
 * @fileoverview Tree visualization utilities for cell hierarchies
 *
 * Inspired by Chainlink's tree command.
 * Credit: https://github.com/dollspace-gay/chainlink
 *
 * Renders cell/epic hierarchies with ASCII box-drawing characters:
 * - ○ open
 * - ◐ in_progress
 * - ● closed
 * - ⊘ blocked
 *
 * Priority indicators: P0 (critical), P1 (high), P2 (medium), P3 (low)
 */

import type { Cell } from "swarm-mail";

export interface TreeNode {
  cell: Cell;
  children: TreeNode[];
}

export interface CellDisplay {
  title: string;
  type: string;
  status: string;
  priority: number;
  blocked: boolean;
}

/**
 * Get status indicator character
 */
export function getStatusIndicator(status: string): string {
  switch (status) {
    case "open":
      return "○";
    case "in_progress":
      return "◐";
    case "closed":
      return "●";
    case "blocked":
      return "⊘";
    default:
      return "○";
  }
}

/**
 * Get priority label (P0-P3)
 */
export function getPriorityLabel(priority: number): string {
  if (priority < 0 || priority > 3) {
    return "";
  }
  return `P${priority}`;
}

/**
 * Format a single cell line with status, priority, and type
 */
export function formatCellLine(cell: CellDisplay): string {
  const parts = [
    cell.title,
    `[${cell.type}]`,
    getStatusIndicator(cell.status),
  ];

  const priorityLabel = getPriorityLabel(cell.priority);
  if (priorityLabel) {
    parts.push(priorityLabel);
  }

  return parts.join(" ");
}

/**
 * Build tree structure from flat cell list
 *
 * Algorithm:
 * 1. Create map of id -> TreeNode
 * 2. For each cell, find parent and attach as child
 * 3. Return nodes without parents as roots
 */
export function buildTreeStructure(cells: Cell[]): TreeNode[] {
  // Create map of all nodes
  const nodeMap = new Map<string, TreeNode>();
  for (const cell of cells) {
    nodeMap.set(cell.id, { cell, children: [] });
  }

  // Build parent-child relationships
  const roots: TreeNode[] = [];
  for (const node of nodeMap.values()) {
    const parentId = node.cell.parent_id;
    if (parentId && nodeMap.has(parentId)) {
      const parent = nodeMap.get(parentId)!;
      parent.children.push(node);
    } else {
      // No parent or parent not found = root
      roots.push(node);
    }
  }

  return roots;
}

/**
 * Render a tree node with box-drawing characters
 *
 * @param node - The node to render
 * @param prefix - Prefix string for indentation
 * @param isLast - Whether this is the last child of its parent
 * @returns Array of output lines
 */
export function renderTreeNode(
  node: TreeNode,
  prefix: string,
  isLast: boolean,
): string[] {
  const lines: string[] = [];

  // Format this node's line
  const line = formatCellLine({
    title: node.cell.title,
    type: node.cell.type,
    status: node.cell.status,
    priority: node.cell.priority,
    blocked: node.cell.status === "blocked",
  });

  lines.push(line);

  // Render children
  for (let i = 0; i < node.children.length; i++) {
    const child = node.children[i];
    const isLastChild = i === node.children.length - 1;
    const connector = isLastChild ? "└──" : "├──";
    const childPrefix = isLastChild ? "    " : "│   ";

    const childLines = renderTreeNode(child, prefix + childPrefix, isLastChild);

    // Add connector to first line of child
    childLines[0] = prefix + connector + " " + childLines[0];

    // Add prefix to remaining lines
    for (let j = 1; j < childLines.length; j++) {
      childLines[j] = prefix + childPrefix + childLines[j];
    }

    lines.push(...childLines);
  }

  return lines;
}

/**
 * Render full tree from multiple root nodes
 */
export function renderTree(roots: TreeNode[]): string {
  const allLines: string[] = [];

  for (let i = 0; i < roots.length; i++) {
    const root = roots[i];
    const lines = renderTreeNode(root, "", true);
    allLines.push(...lines);

    // Add blank line between root nodes (except after last)
    if (i < roots.length - 1) {
      allLines.push("");
    }
  }

  return allLines.join("\n");
}
