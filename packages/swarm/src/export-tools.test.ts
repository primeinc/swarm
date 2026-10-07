/**
 * RED PHASE: Export Tools Tests
 *
 * Tests for exporting cell events to:
 * 1. OTLP (OpenTelemetry Protocol) - distributed tracing format
 * 2. CSV - spreadsheet/analysis format
 * 3. JSON - generic interchange format
 *
 * These tests SHOULD FAIL because export-tools.ts doesn't exist yet.
 * Implementation comes in GREEN phase.
 */

import { describe, test, expect } from "bun:test";
import { exportToOTLP, exportToCSV, exportToJSON } from "./export-tools.js";
import type { CellEvent } from "./schemas/cell-events.js";

// ============================================================================
// Test Fixtures - Known Event Data
// ============================================================================

/**
 * Fixture: Cell created event with known timestamp
 */
const fixtureCreated: CellEvent = {
  type: "cell_created",
  project_key: "/test/project",
  timestamp: 1735142400000, // 2024-12-25 12:00:00 UTC
  cell_id: "test-epic-abc123",
  title: "Implement authentication",
  description: "Add OAuth2 flow with JWT tokens",
  issue_type: "feature",
  priority: 2,
  created_by: "BlueOcean",
  metadata: {
    epic_id: "test-epic-parent",
    strategy: "feature-based",
  },
};

/**
 * Fixture: Cell status changed event
 */
const fixtureStatusChanged: CellEvent = {
  type: "cell_status_changed",
  project_key: "/test/project",
  timestamp: 1735142460000, // 1 minute after creation
  cell_id: "test-epic-abc123",
  from_status: "open",
  to_status: "in_progress",
  changed_by: "BlueOcean",
};

/**
 * Fixture: Cell closed event with special characters in reason
 */
const fixtureClosedWithSpecialChars: CellEvent = {
  type: "cell_closed",
  project_key: "/test/project",
  timestamp: 1735146000000, // 1 hour after creation
  cell_id: "test-epic-abc123",
  reason: 'Completed: implemented OAuth2, added "refresh token" logic, tested with mock provider',
  closed_by: "BlueOcean",
  files_touched: ["src/auth/oauth.ts", "src/auth/jwt.ts"],
  duration_ms: 3600000, // 1 hour
};

/**
 * Fixture: Cell with commas and quotes in title (CSV edge case)
 */
const fixtureCsvEdgeCase: CellEvent = {
  type: "cell_created",
  project_key: "/test/project",
  timestamp: 1735142400000,
  cell_id: "test-csv-edge",
  title: 'Fix bug in parser: handle "quoted strings", commas, and newlines',
  issue_type: "bug",
  priority: 1,
};

// ============================================================================
// OTLP Export Tests
// ============================================================================

describe("exportToOTLP", () => {
  test("produces valid OpenTelemetry JSON structure", () => {
    const events = [fixtureCreated, fixtureStatusChanged, fixtureClosedWithSpecialChars];
    const otlp = exportToOTLP(events);

    // Should have top-level OTLP structure
    expect(otlp).toHaveProperty("resourceSpans");
    expect(Array.isArray(otlp.resourceSpans)).toBe(true);
    expect(otlp.resourceSpans.length).toBeGreaterThan(0);

    // First resource span should have scope and spans
    const resourceSpan = otlp.resourceSpans[0];
    expect(resourceSpan).toHaveProperty("resource");
    expect(resourceSpan).toHaveProperty("scopeSpans");
    expect(Array.isArray(resourceSpan.scopeSpans)).toBe(true);

    // Scope should identify swarm
    const scopeSpan = resourceSpan.scopeSpans[0];
    expect(scopeSpan.scope.name).toBe("swarm");
  });

  test("maps epic_id to trace_id (hex string)", () => {
    const events = [fixtureCreated];
    const otlp = exportToOTLP(events);

    const spans = otlp.resourceSpans[0].scopeSpans[0].spans;
    expect(spans.length).toBeGreaterThan(0);

    const span = spans[0];
    expect(span).toHaveProperty("traceId");
    expect(typeof span.traceId).toBe("string");

    // trace_id should be hex string derived from epic_id
    // Epic ID from metadata: "test-epic-parent"
    expect(span.traceId).toMatch(/^[0-9a-f]+$/);
    expect(span.traceId.length).toBe(32); // OTLP trace_id is 16 bytes = 32 hex chars
  });

  test("maps cell_id to span_id (hex string)", () => {
    const events = [fixtureCreated];
    const otlp = exportToOTLP(events);

    const spans = otlp.resourceSpans[0].scopeSpans[0].spans;
    const span = spans[0];

    expect(span).toHaveProperty("spanId");
    expect(typeof span.spanId).toBe("string");

    // span_id should be hex string derived from cell_id
    // Cell ID: "test-epic-abc123"
    expect(span.spanId).toMatch(/^[0-9a-f]+$/);
    expect(span.spanId.length).toBe(16); // OTLP span_id is 8 bytes = 16 hex chars
  });

  test("maps timestamp to startTimeUnixNano", () => {
    const events = [fixtureCreated];
    const otlp = exportToOTLP(events);

    const spans = otlp.resourceSpans[0].scopeSpans[0].spans;
    const span = spans[0];

    expect(span).toHaveProperty("startTimeUnixNano");

    // Should be string representation of nanoseconds
    // fixtureCreated.timestamp = 1735142400000 ms
    // In nanoseconds: 1735142400000 * 1_000_000
    const expectedNano = "1735142400000000000";
    expect(span.startTimeUnixNano).toBe(expectedNano);
  });

  test("maps event type to span name", () => {
    const events = [fixtureCreated, fixtureStatusChanged, fixtureClosedWithSpecialChars];
    const otlp = exportToOTLP(events);

    const spans = otlp.resourceSpans[0].scopeSpans[0].spans;

    // Should have 3 spans, one per event
    expect(spans.length).toBe(3);

    // Event types become span names
    expect(spans[0].name).toBe("cell_created");
    expect(spans[1].name).toBe("cell_status_changed");
    expect(spans[2].name).toBe("cell_closed");
  });

  test("includes event payload as span attributes", () => {
    const events = [fixtureCreated];
    const otlp = exportToOTLP(events);

    const spans = otlp.resourceSpans[0].scopeSpans[0].spans;
    const span = spans[0];

    expect(span).toHaveProperty("attributes");
    expect(Array.isArray(span.attributes)).toBe(true);

    // Should include key event fields as attributes
    const attrs = span.attributes;

    // Find specific attributes by key
    const titleAttr = attrs.find((a: { key: string }) => a.key === "cell.title");
    expect(titleAttr).toBeDefined();
    expect(titleAttr.value.stringValue).toBe("Implement authentication");

    const priorityAttr = attrs.find((a: { key: string }) => a.key === "cell.priority");
    expect(priorityAttr).toBeDefined();
    expect(priorityAttr.value.intValue).toBe(2);

    const typeAttr = attrs.find((a: { key: string }) => a.key === "cell.type");
    expect(typeAttr).toBeDefined();
    expect(typeAttr.value.stringValue).toBe("feature");
  });

  test("handles events with missing epic_id in metadata", () => {
    // Event without epic_id - should derive trace_id from project_key
    const eventWithoutEpic: CellEvent = {
      type: "cell_created",
      project_key: "/test/project",
      timestamp: 1735142400000,
      cell_id: "standalone-cell",
      title: "Standalone task",
      issue_type: "task",
      priority: 1,
    };

    const otlp = exportToOTLP([eventWithoutEpic]);
    const spans = otlp.resourceSpans[0].scopeSpans[0].spans;
    const span = spans[0];

    // Should still have valid trace_id (derived from project_key)
    expect(span.traceId).toMatch(/^[0-9a-f]{32}$/);
    expect(span.spanId).toMatch(/^[0-9a-f]{16}$/);
  });

  test("preserves event ordering in spans array", () => {
    const events = [fixtureCreated, fixtureStatusChanged, fixtureClosedWithSpecialChars];
    const otlp = exportToOTLP(events);

    const spans = otlp.resourceSpans[0].scopeSpans[0].spans;

    // Spans should be in same order as input events
    expect(spans[0].name).toBe("cell_created");
    expect(spans[1].name).toBe("cell_status_changed");
    expect(spans[2].name).toBe("cell_closed");

    // Timestamps should be monotonically increasing
    const t0 = BigInt(spans[0].startTimeUnixNano);
    const t1 = BigInt(spans[1].startTimeUnixNano);
    const t2 = BigInt(spans[2].startTimeUnixNano);

    expect(t1).toBeGreaterThan(t0);
    expect(t2).toBeGreaterThan(t1);
  });
});

// ============================================================================
// CSV Export Tests
// ============================================================================

describe("exportToCSV", () => {
  test("includes CSV headers", () => {
    const events = [fixtureCreated];
    const csv = exportToCSV(events);

    const lines = csv.split("\n");

    // First line should be headers
    expect(lines[0]).toBe("id,type,timestamp,project_key,cell_id,payload");
  });

  test("escapes commas in payload fields", () => {
    const events = [fixtureCsvEdgeCase];
    const csv = exportToCSV(events);

    const lines = csv.split("\n");

    // Title has commas: 'Fix bug in parser: handle "quoted strings", commas, and newlines'
    // CSV should quote the entire payload field
    const dataLine = lines[1];

    // Should contain quoted payload with escaped inner quotes
    expect(dataLine).toContain('"');

    // Should NOT have unquoted commas in payload (would break CSV parsing)
    // The payload field itself should be wrapped in quotes if it contains commas
    const fields = dataLine.match(/("(?:[^"]|"")*"|[^,]*)/g);
    expect(fields).toBeDefined();

    // Last non-empty field (payload) should be quoted
    const nonEmptyFields = fields!.filter((f) => f !== "");
    const payloadField = nonEmptyFields[nonEmptyFields.length - 1];
    expect(payloadField.startsWith('"')).toBe(true);
  });

  test("escapes double quotes in payload", () => {
    const events = [fixtureCsvEdgeCase];
    const csv = exportToCSV(events);

    const lines = csv.split("\n");
    const dataLine = lines[1];

    // Original title: 'Fix bug in parser: handle "quoted strings", commas, and newlines'
    // In CSV, inner quotes should be escaped as ""
    expect(dataLine).toContain('""quoted strings""');
  });

  test("one event per line (no embedded newlines)", () => {
    const events = [fixtureCreated, fixtureStatusChanged, fixtureClosedWithSpecialChars];
    const csv = exportToCSV(events);

    const lines = csv.split("\n").filter((line) => line.trim() !== "");

    // Header + 3 data lines
    expect(lines.length).toBe(4);

    // Each line should have same number of commas (field separators)
    const headerCommas = (lines[0].match(/,/g) || []).length;

    for (let i = 1; i < lines.length; i++) {
      // Count commas in line (should match header comma count)
      // This validates no embedded commas broke the structure
      const lineCommas = (lines[i].match(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/g) || []).length;
      expect(lineCommas).toBe(headerCommas);
    }
  });

  test("serializes payload as JSON string", () => {
    const events = [fixtureCreated];
    const csv = exportToCSV(events);

    const lines = csv.split("\n");
    const dataLine = lines[1];

    // Payload should be JSON representation of event (minus headers)
    // Should include fields like title, description, priority, etc.
    expect(dataLine).toContain("Implement authentication");
    expect(dataLine).toContain("OAuth2");
  });

  test("handles empty events array", () => {
    const csv = exportToCSV([]);

    // Should still have headers, no data lines
    const lines = csv.split("\n").filter((line) => line.trim() !== "");
    expect(lines.length).toBe(1);
    expect(lines[0]).toBe("id,type,timestamp,project_key,cell_id,payload");
  });

  test("includes all event fields in payload", () => {
    const events = [fixtureClosedWithSpecialChars];
    const csv = exportToCSV(events);

    const lines = csv.split("\n");
    const dataLine = lines[1];

    // Should include all event-specific fields
    expect(dataLine).toContain("files_touched");
    expect(dataLine).toContain("duration_ms");
    expect(dataLine).toContain("3600000"); // Duration value
  });
});

// ============================================================================
// JSON Export Tests
// ============================================================================

describe("exportToJSON", () => {
  test("produces valid JSON array", () => {
    const events = [fixtureCreated, fixtureStatusChanged];
    const json = exportToJSON(events);

    // Should be parseable JSON
    expect(() => JSON.parse(json)).not.toThrow();

    const parsed = JSON.parse(json);

    // Should be an array
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.length).toBe(2);
  });

  test("preserves all event fields", () => {
    const events = [fixtureCreated];
    const json = exportToJSON(events);
    const parsed = JSON.parse(json);

    const event = parsed[0];

    // All fields from fixture should be present
    expect(event.type).toBe("cell_created");
    expect(event.project_key).toBe("/test/project");
    expect(event.timestamp).toBe(1735142400000);
    expect(event.cell_id).toBe("test-epic-abc123");
    expect(event.title).toBe("Implement authentication");
    expect(event.description).toBe("Add OAuth2 flow with JWT tokens");
    expect(event.issue_type).toBe("feature");
    expect(event.priority).toBe(2);
    expect(event.created_by).toBe("BlueOcean");
    expect(event.metadata).toEqual({
      epic_id: "test-epic-parent",
      strategy: "feature-based",
    });
  });

  test("preserves event type discriminators", () => {
    const events = [fixtureCreated, fixtureStatusChanged, fixtureClosedWithSpecialChars];
    const json = exportToJSON(events);
    const parsed = JSON.parse(json);

    // Each event should maintain its type
    expect(parsed[0].type).toBe("cell_created");
    expect(parsed[1].type).toBe("cell_status_changed");
    expect(parsed[2].type).toBe("cell_closed");

    // Type-specific fields should be preserved
    expect(parsed[1].from_status).toBe("open");
    expect(parsed[1].to_status).toBe("in_progress");

    expect(parsed[2].reason).toContain("OAuth2");
    expect(parsed[2].files_touched).toEqual(["src/auth/oauth.ts", "src/auth/jwt.ts"]);
  });

  test("pretty-prints with 2-space indentation", () => {
    const events = [fixtureCreated];
    const json = exportToJSON(events);

    // Should have newlines (pretty-printed)
    expect(json).toContain("\n");

    // Should use 2-space indentation
    const lines = json.split("\n");

    // Find a nested field line (e.g., "type": "cell_created")
    const typeLine = lines.find((line) => line.includes('"type"'));
    expect(typeLine).toBeDefined();

    // Should start with 2 spaces (array item) + 2 spaces (object property) = 4 spaces
    expect(typeLine).toMatch(/^\s{4}"/);
  });

  test("handles empty events array", () => {
    const json = exportToJSON([]);

    // Should be empty array
    const parsed = JSON.parse(json);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.length).toBe(0);

    // Pretty-printed empty array
    expect(json).toBe("[]");
  });

  test("maintains event ordering", () => {
    const events = [fixtureCreated, fixtureStatusChanged, fixtureClosedWithSpecialChars];
    const json = exportToJSON(events);
    const parsed = JSON.parse(json);

    // Order should match input
    expect(parsed[0].type).toBe("cell_created");
    expect(parsed[1].type).toBe("cell_status_changed");
    expect(parsed[2].type).toBe("cell_closed");

    // Timestamps should be in order
    expect(parsed[0].timestamp).toBe(1735142400000);
    expect(parsed[1].timestamp).toBe(1735142460000);
    expect(parsed[2].timestamp).toBe(1735146000000);
  });

  test("handles special characters in strings", () => {
    const events = [fixtureCsvEdgeCase];
    const json = exportToJSON(events);
    const parsed = JSON.parse(json);

    // Special chars should be preserved via JSON escaping
    const title = parsed[0].title;
    expect(title).toBe('Fix bug in parser: handle "quoted strings", commas, and newlines');

    // JSON should use \" for quotes
    expect(json).toContain('\\"quoted strings\\"');
  });

  test("serializes metadata objects correctly", () => {
    const events = [fixtureCreated];
    const json = exportToJSON(events);
    const parsed = JSON.parse(json);

    const metadata = parsed[0].metadata;

    // Should be an object, not a string
    expect(typeof metadata).toBe("object");
    expect(metadata.epic_id).toBe("test-epic-parent");
    expect(metadata.strategy).toBe("feature-based");
  });
});
