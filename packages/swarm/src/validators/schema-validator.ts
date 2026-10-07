/**
 * Event Schema Validator
 *
 * Validates emitted events against their Zod schemas.
 * Catches:
 * - Type mismatches
 * - Missing required fields
 * - Undefined values that could break UI rendering
 * - Schema violations
 *
 * Used by:
 * - Swarm event emission (validateEvent before emit)
 * - Post-run validation (validateSwarmEvents for all events)
 * - Debug tooling (identify schema drift)
 */

import { CellEventSchema } from "../schemas/cell-events.js";
import type { ZodError } from "zod";

export interface ValidationIssue {
  severity: "error" | "warning";
  category:
    | "schema_mismatch"
    | "undefined_value"
    | "missing_field"
    | "type_error";
  message: string;
  location?: {
    event_type?: string;
    field?: string;
  };
  zodError?: ZodError;
}

export interface SchemaValidationResult {
  valid: boolean;
  issues: ValidationIssue[];
}

/**
 * Validate a single event against its schema
 *
 * Usage:
 * ```typescript
 * const result = validateEvent(event);
 * if (!result.valid) {
 *   console.error("Schema validation failed:", result.issues);
 * }
 * ```
 */
export function validateEvent(event: unknown): SchemaValidationResult {
  const issues: ValidationIssue[] = [];

  // Basic type check
  if (!event || typeof event !== "object") {
    return {
      valid: false,
      issues: [
        {
          severity: "error",
          category: "schema_mismatch",
          message: "Event is not an object",
        },
      ],
    };
  }

  const eventType = (event as any).type;
  if (!eventType) {
    return {
      valid: false,
      issues: [
        {
          severity: "error",
          category: "schema_mismatch",
          message: "Event missing 'type' field",
        },
      ],
    };
  }

  // Validate against CellEventSchema
  const parseResult = CellEventSchema.safeParse(event);
  if (!parseResult.success) {
    issues.push({
      severity: "error",
      category: "schema_mismatch",
      message: `Event validation failed: ${parseResult.error.message}`,
      location: { event_type: eventType },
      zodError: parseResult.error,
    });
  }

  // Check for undefined values that might cause UI issues
  checkForUndefined(event, eventType, issues);

  return {
    valid: issues.filter((i) => i.severity === "error").length === 0,
    issues,
  };
}

/**
 * Recursively check for undefined values
 *
 * Undefined values can break UI rendering and cause serialization issues.
 * We emit warnings for these, not errors (they don't invalidate the event).
 */
function checkForUndefined(
  obj: unknown,
  eventType: string,
  issues: ValidationIssue[],
  path = "",
): void {
  if (obj === undefined) {
    issues.push({
      severity: "warning",
      category: "undefined_value",
      message: `Undefined value at ${path || "root"}`,
      location: { event_type: eventType, field: path },
    });
    return;
  }

  // Only traverse plain objects (not arrays, not nulls)
  if (obj && typeof obj === "object" && !Array.isArray(obj)) {
    for (const [key, value] of Object.entries(obj)) {
      checkForUndefined(value, eventType, issues, path ? `${path}.${key}` : key);
    }
  }
}

/**
 * Validate all events from a swarm run
 *
 * Usage:
 * ```typescript
 * const { passed, issueCount } = await validateSwarmEvents(events);
 * if (!passed) {
 *   console.error(`Found ${issueCount} validation issues`);
 * }
 * ```
 */
export async function validateSwarmEvents(
  events: unknown[],
): Promise<{ passed: boolean; issueCount: number }> {
  let issueCount = 0;

  for (const event of events) {
    const result = validateEvent(event);
    for (const issue of result.issues) {
      issueCount++;
    }
  }

  return { passed: issueCount === 0, issueCount };
}
