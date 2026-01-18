/**
 * Export Tools - Convert Cell Events to Various Formats
 *
 * GREEN PHASE: Minimal implementation to pass tests
 *
 * Supports:
 * - OTLP (OpenTelemetry Protocol) - for distributed tracing
 * - CSV - for spreadsheet analysis
 * - JSON - for generic data interchange
 */

import type { CellEvent } from "./schemas/cell-events.js";
import { createHash } from "node:crypto";

// ============================================================================
// OTLP Export
// ============================================================================

/**
 * OpenTelemetry OTLP span structure
 */
interface OTLPSpan {
  traceId: string; // 32 hex chars (16 bytes)
  spanId: string; // 16 hex chars (8 bytes)
  name: string; // event.type
  startTimeUnixNano: string; // timestamp in nanoseconds
  attributes: Array<{
    key: string;
    value: {
      stringValue?: string;
      intValue?: number;
      boolValue?: boolean;
    };
  }>;
}

interface OTLPOutput {
  resourceSpans: Array<{
    resource: {
      attributes: Array<{
        key: string;
        value: { stringValue: string };
      }>;
    };
    scopeSpans: Array<{
      scope: {
        name: string;
      };
      spans: OTLPSpan[];
    }>;
  }>;
}

/**
 * Convert string to hex hash of specified length
 */
function toHex(input: string, bytes: number): string {
  const hash = createHash("sha256").update(input).digest("hex");
  return hash.slice(0, bytes * 2); // 2 hex chars per byte
}

/**
 * Convert event payload to OTLP attributes
 */
function eventToAttributes(event: CellEvent): OTLPSpan["attributes"] {
  const attrs: OTLPSpan["attributes"] = [];

  // Map common fields with "cell." prefix
  if ("title" in event && event.title) {
    attrs.push({
      key: "cell.title",
      value: { stringValue: event.title },
    });
  }

  if ("issue_type" in event && event.issue_type) {
    attrs.push({
      key: "cell.type",
      value: { stringValue: event.issue_type },
    });
  }

  if ("priority" in event && typeof event.priority === "number") {
    attrs.push({
      key: "cell.priority",
      value: { intValue: event.priority },
    });
  }

  if ("description" in event && event.description) {
    attrs.push({
      key: "cell.description",
      value: { stringValue: event.description },
    });
  }

  // Add type-specific fields
  if ("from_status" in event && event.from_status) {
    attrs.push({
      key: "cell.from_status",
      value: { stringValue: event.from_status },
    });
  }

  if ("to_status" in event && event.to_status) {
    attrs.push({
      key: "cell.to_status",
      value: { stringValue: event.to_status },
    });
  }

  if ("reason" in event && event.reason) {
    attrs.push({
      key: "cell.reason",
      value: { stringValue: event.reason },
    });
  }

  if ("duration_ms" in event && typeof event.duration_ms === "number") {
    attrs.push({
      key: "cell.duration_ms",
      value: { intValue: event.duration_ms },
    });
  }

  return attrs;
}

/**
 * Export cell events to OpenTelemetry OTLP format
 *
 * Mapping:
 * - epic_id (from metadata) → trace_id (32 hex chars)
 * - cell_id → span_id (16 hex chars)
 * - timestamp → startTimeUnixNano (nanoseconds as string)
 * - event.type → span.name
 * - event payload → span.attributes
 */
export function exportToOTLP(events: CellEvent[]): OTLPOutput {
  const spans: OTLPSpan[] = events.map((event) => {
    // Determine trace_id: epic_id from metadata, fallback to project_key
    const epicId =
      ("metadata" in event &&
        event.metadata &&
        typeof event.metadata === "object" &&
        "epic_id" in event.metadata &&
        typeof event.metadata.epic_id === "string"
        ? event.metadata.epic_id
        : event.project_key);

    const traceId = toHex(epicId, 16); // 16 bytes = 32 hex chars
    const spanId = toHex(event.cell_id, 8); // 8 bytes = 16 hex chars

    // Convert timestamp (ms) to nanoseconds
    const startTimeUnixNano = String(event.timestamp * 1_000_000);

    return {
      traceId,
      spanId,
      name: event.type,
      startTimeUnixNano,
      attributes: eventToAttributes(event),
    };
  });

  return {
    resourceSpans: [
      {
        resource: {
          attributes: [
            {
              key: "service.name",
              value: { stringValue: "swarm" },
            },
          ],
        },
        scopeSpans: [
          {
            scope: {
              name: "swarm",
            },
            spans,
          },
        ],
      },
    ],
  };
}

// ============================================================================
// CSV Export
// ============================================================================

/**
 * Escape CSV field value
 * - Wrap in quotes if contains comma, quote, or newline
 * - Convert JSON escaped quotes (\") to CSV doubled quotes ("")
 * - Double any other interior quotes
 */
function escapeCsvField(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    // First convert JSON-escaped quotes \" to just "
    // Then double all quotes for CSV format
    const unescaped = value.replace(/\\"/g, '"');
    return `"${unescaped.replace(/"/g, '""')}"`;
  }
  return value;
}

/**
 * Export cell events to CSV format
 *
 * Format:
 * - Headers: id,type,timestamp,project_key,cell_id,payload
 * - Payload: JSON serialization of entire event (minus headers)
 */
export function exportToCSV(events: CellEvent[]): string {
  const headers = "id,type,timestamp,project_key,cell_id,payload";
  const rows = [headers];

  for (const event of events) {
    // Don't escape simple fields that don't need it
    const id = "id" in event && event.id ? String(event.id) : "";
    const type = event.type;
    const timestamp = String(event.timestamp);
    const projectKey = event.project_key;
    const cellId = event.cell_id;

    // Serialize entire event as JSON for payload column
    const payloadJson = JSON.stringify(event);
    const payload = escapeCsvField(payloadJson);

    rows.push([id, type, timestamp, projectKey, cellId, payload].join(","));
  }

  return `${rows.join("\n")}\n`;
}

// ============================================================================
// JSON Export
// ============================================================================

/**
 * Export cell events to JSON format
 *
 * Format:
 * - Array of event objects
 * - Pretty-printed with 2-space indentation
 * - Preserves all fields and discriminated union types
 */
export function exportToJSON(events: CellEvent[]): string {
  if (events.length === 0) {
    return "[]";
  }

  return JSON.stringify(events, null, 2);
}
