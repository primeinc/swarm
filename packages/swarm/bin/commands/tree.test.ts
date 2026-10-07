/**
 * @fileoverview Tests for tree command
 *
 * Integration tests for CLI command that renders cell hierarchies.
 */

import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { createInMemorySwarmMailLibSQL, createHiveAdapter } from "swarm-mail";
import type { SwarmMailAdapter } from "swarm-mail";

describe("tree command integration", () => {
  let swarmMail: SwarmMailAdapter;
  const projectPath = "/tmp/test-tree-project";

  beforeAll(async () => {
    swarmMail = await createInMemorySwarmMailLibSQL("test-tree");
    const db = await swarmMail.getDatabase();
    const adapter = createHiveAdapter(db, projectPath);
    await adapter.runMigrations();

    // Create test data: epic with children
    const epic = await adapter.createCell(projectPath, {
      title: "Test Epic",
      type: "epic",
      priority: 0,
    });

    await adapter.createCell(projectPath, {
      title: "Task 1",
      type: "task",
      priority: 1,
      parent_id: epic.id,
    });

    await adapter.createCell(projectPath, {
      title: "Task 2",
      type: "task",
      priority: 2,
      parent_id: epic.id,
    });

    // Create standalone task
    await adapter.createCell(projectPath, {
      title: "Standalone Task",
      type: "task",
      priority: 1,
    });
  });

  afterAll(async () => {
    await swarmMail.close();
  });

  test("queries cells and builds tree structure", async () => {
    const db = await swarmMail.getDatabase();
    const adapter = createHiveAdapter(db, projectPath);

    const cells = await adapter.queryCells(projectPath, {
      limit: 100,
    });

    expect(cells.length).toBeGreaterThan(0);

    // Verify we have epic and children
    const epic = cells.find((c) => c.type === "epic");
    expect(epic).toBeDefined();

    const children = cells.filter((c) => c.parent_id === epic?.id);
    expect(children.length).toBe(2);
  });
});
