/**
 * Schema Validator Tests
 *
 * Tests event schema validation against Zod schemas.
 * Ensures events match their declared schemas and catches:
 * - Type mismatches
 * - Missing required fields
 * - Undefined values that break UI
 * - Schema violations
 */

import { describe, test, expect } from "bun:test";
import { validateEvent, validateSwarmEvents } from "./schema-validator";
import { createCellEvent } from "../schemas/cell-events";

describe("validateEvent", () => {
  test("rejects non-object input", () => {
    const result = validateEvent(null);
    expect(result.valid).toBe(false);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0].category).toBe("schema_mismatch");
    expect(result.issues[0].message).toBe("Event is not an object");
  });

  test("rejects event without type field", () => {
    const result = validateEvent({ foo: "bar" });
    expect(result.valid).toBe(false);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0].category).toBe("schema_mismatch");
    expect(result.issues[0].message).toBe("Event missing 'type' field");
  });

  test("validates well-formed cell_created event", () => {
    const event = createCellEvent("cell_created", {
      project_key: "/test/project",
      cell_id: "test-123",
      title: "Test Cell",
      issue_type: "task",
      priority: 2,
    });

    const result = validateEvent(event);
    expect(result.valid).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  test("detects undefined values in top-level fields", () => {
    const event = {
      type: "cell_created",
      project_key: "/test/project",
      cell_id: "test-123",
      title: "Test",
      issue_type: "task",
      priority: 2,
      timestamp: Date.now(),
      description: undefined, // undefined value
    };

    const result = validateEvent(event);
    expect(result.valid).toBe(true); // warnings don't fail validation
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0].severity).toBe("warning");
    expect(result.issues[0].category).toBe("undefined_value");
    expect(result.issues[0].message).toContain("description");
  });

  test("detects undefined values in nested objects", () => {
    const event = {
      type: "cell_updated",
      project_key: "/test/project",
      cell_id: "test-123",
      timestamp: Date.now(),
      changes: {
        title: {
          old: "Old Title",
          new: undefined, // nested undefined
        },
      },
    };

    const result = validateEvent(event);
    // Event is invalid because Zod schema doesn't allow undefined in required fields
    // But we still detect the undefined and report it
    expect(result.issues.length).toBeGreaterThan(0);
    const undefinedIssue = result.issues.find((i) =>
      i.message.includes("changes.title.new"),
    );
    expect(undefinedIssue).toBeDefined();
    expect(undefinedIssue?.category).toBe("undefined_value");
  });

  test("validates cell_closed event with all fields", () => {
    const event = createCellEvent("cell_closed", {
      project_key: "/test/project",
      cell_id: "test-123",
      reason: "Completed successfully",
      closed_by: "TestAgent",
      files_touched: ["src/foo.ts", "src/bar.ts"],
      duration_ms: 120000,
    });

    const result = validateEvent(event);
    expect(result.valid).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  test("validates cell_status_changed event", () => {
    const event = createCellEvent("cell_status_changed", {
      project_key: "/test/project",
      cell_id: "test-123",
      from_status: "open",
      to_status: "in_progress",
      changed_by: "TestAgent",
    });

    const result = validateEvent(event);
    expect(result.valid).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  test("validates cell_dependency_added event", () => {
    const event = createCellEvent("cell_dependency_added", {
      project_key: "/test/project",
      cell_id: "test-123",
      dependency: {
        id: "test-456",
        type: "blocks",
      },
      added_by: "TestAgent",
      reason: "Auth service must complete first",
    });

    const result = validateEvent(event);
    expect(result.valid).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  test("provides location context for undefined values", () => {
    const event = {
      type: "cell_created",
      project_key: "/test/project",
      cell_id: "test-123",
      title: "Test",
      issue_type: "task",
      priority: 2,
      timestamp: Date.now(),
      metadata: {
        epicContext: {
          strategy: undefined, // deeply nested undefined
        },
      },
    };

    const result = validateEvent(event);
    const undefinedIssue = result.issues.find((i) =>
      i.message.includes("metadata.epicContext.strategy"),
    );
    expect(undefinedIssue).toBeDefined();
    expect(undefinedIssue?.location?.event_type).toBe("cell_created");
    expect(undefinedIssue?.location?.field).toBe(
      "metadata.epicContext.strategy",
    );
  });

  test("handles events with arrays (should not traverse arrays)", () => {
    const event = createCellEvent("cell_closed", {
      project_key: "/test/project",
      cell_id: "test-123",
      reason: "Done",
      files_touched: ["src/a.ts", "src/b.ts"],
    });

    const result = validateEvent(event);
    expect(result.valid).toBe(true);
    expect(result.issues).toHaveLength(0);
  });
});

describe("validateSwarmEvents", () => {
  test("validates all events from a swarm run", async () => {
    const events = [
      createCellEvent("cell_created", {
        project_key: "/test/project",
        cell_id: "epic-123",
        title: "Epic Task",
        issue_type: "epic",
        priority: 3,
      }),
      createCellEvent("cell_created", {
        project_key: "/test/project",
        cell_id: "subtask-1",
        title: "Subtask 1",
        issue_type: "task",
        priority: 2,
        parent_id: "epic-123",
      }),
      createCellEvent("cell_status_changed", {
        project_key: "/test/project",
        cell_id: "subtask-1",
        from_status: "open",
        to_status: "in_progress",
      }),
    ];

    const result = await validateSwarmEvents(events);
    expect(result.passed).toBe(true);
    expect(result.issueCount).toBe(0);
  });

  test("detects issues across multiple events", async () => {
    const events = [
      createCellEvent("cell_created", {
        project_key: "/test/project",
        cell_id: "test-1",
        title: "Test",
        issue_type: "task",
        priority: 2,
      }),
      {
        type: "cell_updated",
        project_key: "/test/project",
        cell_id: "test-1",
        timestamp: Date.now(),
        changes: {
          title: {
            old: "Test",
            new: undefined, // issue here
          },
        },
      },
      { type: "invalid_event" }, // missing required fields
    ];

    const result = await validateSwarmEvents(events);
    expect(result.passed).toBe(false);
    expect(result.issueCount).toBeGreaterThan(0);
  });

  test("returns zero issues for empty event list", async () => {
    const result = await validateSwarmEvents([]);
    expect(result.passed).toBe(true);
    expect(result.issueCount).toBe(0);
  });

  test("accumulates warnings and errors separately", async () => {
    const events = [
      {
        type: "cell_created",
        project_key: "/test/project",
        cell_id: "test-1",
        title: "Test",
        issue_type: "task",
        priority: 2,
        timestamp: Date.now(),
        description: undefined, // warning
      },
      { type: "invalid" }, // error (missing type field check)
    ];

    const result = await validateSwarmEvents(events);
    expect(result.issueCount).toBeGreaterThan(0);
  });
});
