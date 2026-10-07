/**
 * Tests for Swarm Signature Detection
 *
 * These tests verify the deterministic projection of swarm state from session events.
 */

import { describe, test, expect } from "bun:test";
import {
  projectSwarmState,
  hasSwarmSignature,
  isSwarmActive,
  getSwarmSummary,
  type ToolCallEvent,
  type SwarmProjection,
} from "./swarm-signature";

// =============================================================================
// Test Fixtures
// =============================================================================

const createEvent = (
  tool: string,
  input: Record<string, unknown>,
  output: string,
  timestamp = Date.now()
): ToolCallEvent => ({
  tool,
  input,
  output,
  timestamp,
});

const epicCreatedOutput = JSON.stringify({
  epic: { id: "epic-123", title: "Add auth" },
  subtasks: [
    { id: "epic-123.1", title: "Create schema" },
    { id: "epic-123.2", title: "Add service" },
  ],
});

const swarmMailInitOutput = JSON.stringify({
  agent_name: "BlueLake",
  project_key: "/path/to/project",
});

// =============================================================================
// hasSwarmSignature Tests
// =============================================================================

describe("hasSwarmSignature", () => {
  test("returns false for empty events", () => {
    expect(hasSwarmSignature([])).toBe(false);
  });

  test("returns false for only hive_create_epic", () => {
    const events: ToolCallEvent[] = [
      createEvent("hive_create_epic", { epic_title: "Test" }, epicCreatedOutput),
    ];
    expect(hasSwarmSignature(events)).toBe(false);
  });

  test("returns false for only swarm_spawn_subtask", () => {
    const events: ToolCallEvent[] = [
      createEvent(
        "swarm_spawn_subtask",
        { cell_id: "epic-123.1", epic_id: "epic-123" },
        "{}"
      ),
    ];
    expect(hasSwarmSignature(events)).toBe(false);
  });

  test("returns true for epic + spawn", () => {
    const events: ToolCallEvent[] = [
      createEvent("hive_create_epic", { epic_title: "Test" }, epicCreatedOutput),
      createEvent(
        "swarm_spawn_subtask",
        { cell_id: "epic-123.1", epic_id: "epic-123" },
        "{}"
      ),
    ];
    expect(hasSwarmSignature(events)).toBe(true);
  });

  test("returns true regardless of order", () => {
    const events: ToolCallEvent[] = [
      createEvent(
        "swarm_spawn_subtask",
        { cell_id: "epic-123.1", epic_id: "epic-123" },
        "{}"
      ),
      createEvent("hive_create_epic", { epic_title: "Test" }, epicCreatedOutput),
    ];
    expect(hasSwarmSignature(events)).toBe(true);
  });

  test("ignores non-swarm events", () => {
    const events: ToolCallEvent[] = [
      createEvent("hive_query", {}, "[]"),
      createEvent("hive_create_epic", { epic_title: "Test" }, epicCreatedOutput),
      createEvent("read", { path: "/foo" }, "content"),
      createEvent(
        "swarm_spawn_subtask",
        { cell_id: "epic-123.1", epic_id: "epic-123" },
        "{}"
      ),
      createEvent("edit", { path: "/foo" }, "ok"),
    ];
    expect(hasSwarmSignature(events)).toBe(true);
  });
});

// =============================================================================
// projectSwarmState Tests
// =============================================================================

describe("projectSwarmState", () => {
  test("returns empty state for no events", () => {
    const projection = projectSwarmState([]);
    expect(projection.isSwarm).toBe(false);
    expect(projection.epic).toBeUndefined();
    expect(projection.subtasks.size).toBe(0);
  });

  test("extracts epic from hive_create_epic", () => {
    const events: ToolCallEvent[] = [
      createEvent(
        "hive_create_epic",
        { epic_title: "Add authentication" },
        epicCreatedOutput,
        1000
      ),
    ];

    const projection = projectSwarmState(events);
    expect(projection.epic).toBeDefined();
    expect(projection.epic?.id).toBe("epic-123");
    expect(projection.epic?.title).toBe("Add authentication");
    expect(projection.epic?.status).toBe("open");
    expect(projection.epic?.createdAt).toBe(1000);
  });

  test("extracts subtasks from hive_create_epic output", () => {
    const events: ToolCallEvent[] = [
      createEvent("hive_create_epic", { epic_title: "Test" }, epicCreatedOutput),
    ];

    const projection = projectSwarmState(events);
    expect(projection.subtasks.size).toBe(2);
    expect(projection.subtasks.has("epic-123.1")).toBe(true);
    expect(projection.subtasks.has("epic-123.2")).toBe(true);
  });

  test("updates subtask status on swarm_spawn_subtask", () => {
    const events: ToolCallEvent[] = [
      createEvent("hive_create_epic", { epic_title: "Test" }, epicCreatedOutput),
      createEvent(
        "swarm_spawn_subtask",
        {
          cell_id: "epic-123.1",
          epic_id: "epic-123",
          subtask_title: "Create schema",
          files: ["src/schema.ts"],
        },
        "{}",
        2000
      ),
    ];

    const projection = projectSwarmState(events);
    const subtask = projection.subtasks.get("epic-123.1");
    expect(subtask?.status).toBe("spawned");
    expect(subtask?.title).toBe("Create schema");
    expect(subtask?.files).toEqual(["src/schema.ts"]);
    expect(subtask?.spawnedAt).toBe(2000);
  });

  test("updates subtask status on hive_start", () => {
    const events: ToolCallEvent[] = [
      createEvent("hive_create_epic", { epic_title: "Test" }, epicCreatedOutput),
      createEvent(
        "swarm_spawn_subtask",
        { cell_id: "epic-123.1", subtask_title: "Task 1" },
        "{}"
      ),
      createEvent("hive_start", { id: "epic-123.1" }, "{}"),
    ];

    const projection = projectSwarmState(events);
    expect(projection.subtasks.get("epic-123.1")?.status).toBe("in_progress");
    expect(projection.counts.inProgress).toBe(1);
  });

  test("updates subtask status on swarm_complete", () => {
    const events: ToolCallEvent[] = [
      createEvent("hive_create_epic", { epic_title: "Test" }, epicCreatedOutput),
      createEvent(
        "swarm_spawn_subtask",
        { cell_id: "epic-123.1", subtask_title: "Task 1" },
        "{}"
      ),
      createEvent("swarm_complete", { cell_id: "epic-123.1" }, "{}", 3000),
    ];

    const projection = projectSwarmState(events);
    const subtask = projection.subtasks.get("epic-123.1");
    expect(subtask?.status).toBe("completed");
    expect(subtask?.completedAt).toBe(3000);
    expect(projection.counts.completed).toBe(1);
  });

  test("updates subtask status on hive_close", () => {
    const events: ToolCallEvent[] = [
      createEvent("hive_create_epic", { epic_title: "Test" }, epicCreatedOutput),
      createEvent(
        "swarm_spawn_subtask",
        { cell_id: "epic-123.1", subtask_title: "Task 1" },
        "{}"
      ),
      createEvent("swarm_complete", { cell_id: "epic-123.1" }, "{}"),
      createEvent("hive_close", { id: "epic-123.1" }, "{}"),
    ];

    const projection = projectSwarmState(events);
    expect(projection.subtasks.get("epic-123.1")?.status).toBe("closed");
    expect(projection.counts.closed).toBe(1);
    expect(projection.counts.completed).toBe(0); // decremented when closed
  });

  test("extracts coordinator info from swarmmail_init", () => {
    const events: ToolCallEvent[] = [
      createEvent("swarmmail_init", {}, swarmMailInitOutput),
      createEvent("hive_create_epic", { epic_title: "Test" }, epicCreatedOutput),
      createEvent(
        "swarm_spawn_subtask",
        { cell_id: "epic-123.1" },
        "{}"
      ),
    ];

    const projection = projectSwarmState(events);
    expect(projection.coordinatorName).toBe("BlueLake");
    expect(projection.projectPath).toBe("/path/to/project");
  });

  test("isSwarm is true only with epic + spawn", () => {
    // Only epic
    const epicOnly = projectSwarmState([
      createEvent("hive_create_epic", { epic_title: "Test" }, epicCreatedOutput),
    ]);
    expect(epicOnly.isSwarm).toBe(false);

    // Only spawn (no epic)
    const spawnOnly = projectSwarmState([
      createEvent(
        "swarm_spawn_subtask",
        { cell_id: "epic-123.1", epic_id: "epic-123" },
        "{}"
      ),
    ]);
    expect(spawnOnly.isSwarm).toBe(false);

    // Both
    const both = projectSwarmState([
      createEvent("hive_create_epic", { epic_title: "Test" }, epicCreatedOutput),
      createEvent(
        "swarm_spawn_subtask",
        { cell_id: "epic-123.1" },
        "{}"
      ),
    ]);
    expect(both.isSwarm).toBe(true);
  });

  test("tracks counts correctly through full lifecycle", () => {
    const events: ToolCallEvent[] = [
      createEvent("hive_create_epic", { epic_title: "Test" }, epicCreatedOutput),
      createEvent(
        "swarm_spawn_subtask",
        { cell_id: "epic-123.1", subtask_title: "Task 1" },
        "{}"
      ),
      createEvent(
        "swarm_spawn_subtask",
        { cell_id: "epic-123.2", subtask_title: "Task 2" },
        "{}"
      ),
      createEvent("hive_start", { id: "epic-123.1" }, "{}"),
      createEvent("swarm_complete", { cell_id: "epic-123.1" }, "{}"),
      createEvent("hive_close", { id: "epic-123.1" }, "{}"),
    ];

    const projection = projectSwarmState(events);
    expect(projection.counts.total).toBe(2);
    expect(projection.counts.spawned).toBe(1); // epic-123.2 still spawned
    expect(projection.counts.closed).toBe(1); // epic-123.1 closed
  });

  test("handles epic status transitions", () => {
    const events: ToolCallEvent[] = [
      createEvent("hive_create_epic", { epic_title: "Test" }, epicCreatedOutput),
      createEvent("hive_start", { id: "epic-123" }, "{}"),
    ];

    let projection = projectSwarmState(events);
    expect(projection.epic?.status).toBe("in_progress");

    // Add close event
    events.push(createEvent("hive_close", { id: "epic-123" }, "{}"));
    projection = projectSwarmState(events);
    expect(projection.epic?.status).toBe("closed");
  });
});

// =============================================================================
// isSwarmActive Tests
// =============================================================================

describe("isSwarmActive", () => {
  test("returns false for non-swarm", () => {
    const projection = projectSwarmState([]);
    expect(isSwarmActive(projection)).toBe(false);
  });

  test("returns true when subtasks are spawned", () => {
    const projection = projectSwarmState([
      createEvent("hive_create_epic", { epic_title: "Test" }, epicCreatedOutput),
      createEvent(
        "swarm_spawn_subtask",
        { cell_id: "epic-123.1" },
        "{}"
      ),
    ]);
    expect(isSwarmActive(projection)).toBe(true);
  });

  test("returns true when subtasks are in_progress", () => {
    const projection = projectSwarmState([
      createEvent("hive_create_epic", { epic_title: "Test" }, epicCreatedOutput),
      createEvent(
        "swarm_spawn_subtask",
        { cell_id: "epic-123.1" },
        "{}"
      ),
      createEvent("hive_start", { id: "epic-123.1" }, "{}"),
    ]);
    expect(isSwarmActive(projection)).toBe(true);
  });

  test("returns true when subtasks are completed but not closed", () => {
    const projection = projectSwarmState([
      createEvent("hive_create_epic", { epic_title: "Test" }, epicCreatedOutput),
      createEvent(
        "swarm_spawn_subtask",
        { cell_id: "epic-123.1" },
        "{}"
      ),
      createEvent("swarm_complete", { cell_id: "epic-123.1" }, "{}"),
    ]);
    expect(isSwarmActive(projection)).toBe(true);
  });

  test("returns false when all subtasks are closed", () => {
    const projection = projectSwarmState([
      createEvent("hive_create_epic", { epic_title: "Test" }, epicCreatedOutput),
      createEvent(
        "swarm_spawn_subtask",
        { cell_id: "epic-123.1" },
        "{}"
      ),
      createEvent("swarm_complete", { cell_id: "epic-123.1" }, "{}"),
      createEvent("hive_close", { id: "epic-123.1" }, "{}"),
      createEvent("hive_close", { id: "epic-123.2" }, "{}"), // Close the other subtask too
    ]);
    expect(isSwarmActive(projection)).toBe(false);
  });
});

// =============================================================================
// getSwarmSummary Tests
// =============================================================================

describe("getSwarmSummary", () => {
  test("returns 'No swarm detected' for non-swarm", () => {
    const projection = projectSwarmState([]);
    expect(getSwarmSummary(projection)).toBe("No swarm detected");
  });

  test("includes epic info and counts", () => {
    const projection = projectSwarmState([
      createEvent(
        "hive_create_epic",
        { epic_title: "Add auth" },
        epicCreatedOutput
      ),
      createEvent(
        "swarm_spawn_subtask",
        { cell_id: "epic-123.1", subtask_title: "Task 1" },
        "{}"
      ),
    ]);

    const summary = getSwarmSummary(projection);
    expect(summary).toContain("Epic: epic-123");
    expect(summary).toContain("Add auth");
    expect(summary).toContain("spawned");
    expect(summary).toContain("ACTIVE");
  });

  test("shows COMPLETE when all closed", () => {
    const projection = projectSwarmState([
      createEvent("hive_create_epic", { epic_title: "Test" }, epicCreatedOutput),
      createEvent(
        "swarm_spawn_subtask",
        { cell_id: "epic-123.1" },
        "{}"
      ),
      createEvent("hive_close", { id: "epic-123.1" }, "{}"),
      createEvent("hive_close", { id: "epic-123.2" }, "{}"),
    ]);

    const summary = getSwarmSummary(projection);
    expect(summary).toContain("COMPLETE");
  });
});

// =============================================================================
// Edge Cases
// =============================================================================

describe("edge cases", () => {
  test("handles malformed JSON in outputs gracefully", () => {
    const events: ToolCallEvent[] = [
      createEvent("hive_create_epic", { epic_title: "Test" }, "not json"),
      createEvent("swarmmail_init", {}, "also not json"),
    ];

    // Should not throw
    const projection = projectSwarmState(events);
    expect(projection.epic).toBeUndefined();
    expect(projection.coordinatorName).toBeUndefined();
  });

  test("handles missing fields gracefully", () => {
    const events: ToolCallEvent[] = [
      createEvent("hive_create_epic", {}, JSON.stringify({ epic: { id: "x" } })),
      createEvent("swarm_spawn_subtask", {}, "{}"),
    ];

    const projection = projectSwarmState(events);
    expect(projection.epic?.title).toBe("Unknown Epic");
  });

  test("handles duplicate events idempotently", () => {
    const events: ToolCallEvent[] = [
      createEvent("hive_create_epic", { epic_title: "Test" }, epicCreatedOutput),
      createEvent(
        "swarm_spawn_subtask",
        { cell_id: "epic-123.1" },
        "{}"
      ),
      // Duplicate spawn
      createEvent(
        "swarm_spawn_subtask",
        { cell_id: "epic-123.1" },
        "{}"
      ),
    ];

    const projection = projectSwarmState(events);
    expect(projection.subtasks.size).toBe(2); // Still only 2 subtasks
    expect(projection.counts.spawned).toBe(1); // Only one spawned (epic-123.1)
  });

  test("handles out-of-order events", () => {
    // Spawn before epic creation (shouldn't happen but handle gracefully)
    const events: ToolCallEvent[] = [
      createEvent(
        "swarm_spawn_subtask",
        { cell_id: "epic-123.1", epic_id: "epic-123", subtask_title: "Task 1" },
        "{}"
      ),
      createEvent("hive_create_epic", { epic_title: "Test" }, epicCreatedOutput),
    ];

    const projection = projectSwarmState(events);
    expect(projection.isSwarm).toBe(true);
    expect(projection.subtasks.get("epic-123.1")?.status).toBe("spawned");
  });
});
