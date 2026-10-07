/**
 * Integration tests for swarm validation hook wiring
 *
 * Tests that validation runs automatically after swarm_completed events
 * and that validation events flow through the event stream.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { createInMemorySwarmMail } from "swarm-mail";
import type { SwarmMailAdapter } from "swarm-mail";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { clearHiveAdapterCache } from "./hive";

describe("Swarm Validation Integration", () => {
  let swarmMail: SwarmMailAdapter;
  let testProjectKey: string;

  beforeEach(async () => {
    clearHiveAdapterCache();
    swarmMail = await createInMemorySwarmMail("swarm-validation-test");
    // Create a real temporary directory for the test
    testProjectKey = mkdtempSync(join(tmpdir(), "swarm-validation-test-"));
  });

  afterEach(async () => {
    await swarmMail.close();
    clearHiveAdapterCache();
    // Clean up temp directory
    try {
      rmSync(testProjectKey, { recursive: true, force: true });
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  test("validation runs after swarm_completed event is emitted", async () => {
    // Create an epic using HiveAdapter
    const { getHiveAdapter, hive_close, setHiveWorkingDirectory } = await import("./hive");
    const { readEvents } = await import("swarm-mail");
    
    // Set the working directory for hive operations
    setHiveWorkingDirectory(testProjectKey);
    
    const adapter = await getHiveAdapter(testProjectKey);
    
    // Create an epic cell
    const epic = await adapter.createCell(testProjectKey, {
      title: "Test Epic",
      type: "epic",
      priority: 2,
    });
    
    // Create some subtasks
    await adapter.createCell(testProjectKey, {
      title: "Subtask 1",
      type: "task",
      priority: 2,
      parent_id: epic.id,
    });
    
    await adapter.createCell(testProjectKey, {
      title: "Subtask 2",
      type: "task",
      priority: 2,
      parent_id: epic.id,
    });
    
    // Close the epic using the hive_close tool (this triggers swarm_completed event and validation)
    // Note: Tool needs a context object, pass minimal one
    const mockCtx = { sessionID: "test-session" } as any;
    await hive_close.execute({ id: epic.id, reason: "Test complete" }, mockCtx);

    // Wait for async validation to run (fire-and-forget)
    // Validation hook runs in background, give it time to emit events
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Check that validation events were emitted
    const events = await readEvents(
      {
        projectKey: testProjectKey,
        types: ["validation_started", "validation_completed"],
      },
      testProjectKey
    );

    // Should have validation_started and validation_completed
    const validationStarted = events.find((e: any) => e.type === "validation_started");
    const validationCompleted = events.find((e: any) => e.type === "validation_completed");

    expect(validationStarted).toBeDefined();
    expect(validationCompleted).toBeDefined();

    // Validation should reference the epic
    expect((validationStarted as any).epic_id).toBe(epic.id);
    expect((validationCompleted as any).epic_id).toBe(epic.id);
  });

  test("validation is fire-and-forget (doesn't block)", async () => {
    const { getHiveAdapter, hive_close, setHiveWorkingDirectory } = await import("./hive");
    
    setHiveWorkingDirectory(testProjectKey);
    const adapter = await getHiveAdapter(testProjectKey);
    
    // Create an epic cell
    const epic = await adapter.createCell(testProjectKey, {
      title: "Test Epic Fast",
      type: "epic",
      priority: 2,
    });

    // This should not throw or block even if validation fails
    const mockCtx = { sessionID: "test-session" } as any;
    const start = Date.now();
    await hive_close.execute({ id: epic.id, reason: "Done fast" }, mockCtx);
    const elapsed = Date.now() - start;

    // Should complete quickly (not waiting for validation since it's fire-and-forget)
    expect(elapsed).toBeLessThan(2000); // Increased timeout for CI
  });

  test("validation failure is logged but doesn't block swarm completion", async () => {
    const { getHiveAdapter, hive_close, setHiveWorkingDirectory } = await import("./hive");
    
    setHiveWorkingDirectory(testProjectKey);
    const adapter = await getHiveAdapter(testProjectKey);
    
    // Create an epic cell
    const epic = await adapter.createCell(testProjectKey, {
      title: "Test Epic Failed",
      type: "epic",
      priority: 2,
    });
    
    // Create a blocked subtask (simulates failure)
    const subtask = await adapter.createCell(testProjectKey, {
      title: "Failed Subtask",
      type: "task",
      priority: 2,
      parent_id: epic.id,
    });
    
    // Mark subtask as blocked
    await adapter.changeCellStatus(testProjectKey, subtask.id, "blocked");

    // Should complete successfully even if validation detects issues
    const mockCtx = { sessionID: "test-session" } as any;
    const result = await hive_close.execute({ id: epic.id, reason: "Complete despite failures" }, mockCtx);
    // hive_close tool returns a string message, not the cell
    expect(result).toContain("Closed");
  });
});
