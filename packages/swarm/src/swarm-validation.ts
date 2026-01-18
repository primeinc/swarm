/**
 * Swarm Validation Hook Infrastructure
 *
 * Provides validation event types and hooks for post-swarm validation.
 * Integrates with swarm-mail event sourcing to emit validation events.
 *
 * @module swarm-validation
 */
import { z } from "zod";

/**
 * Agent event type for validation events
 *
 * This is a minimal type that matches the swarm-mail AgentEvent interface
 * for the validation events we emit.
 */
type AgentEvent =
  | {
      type: "validation_started";
      project_key: string;
      timestamp: number;
      epic_id: string;
      swarm_id: string;
      started_at: number;
    }
  | {
      type: "validation_issue";
      project_key: string;
      timestamp: string | number;
      epic_id: string;
      severity: "error" | "warning" | "info";
      category:
        | "schema_mismatch"
        | "missing_event"
        | "undefined_value"
        | "dashboard_render"
        | "websocket_delivery";
      message: string;
      location?: {
        event_type?: string;
        field?: string;
        component?: string;
      };
    }
  | {
      type: "validation_completed";
      project_key: string;
      timestamp: number;
      epic_id: string;
      swarm_id: string;
      passed: boolean;
      issue_count: number;
      duration_ms: number;
    };

// ============================================================================
// Validation Issue Schema
// ============================================================================

/**
 * Severity levels for validation issues
 */
export const ValidationIssueSeverity = z.enum(["error", "warning", "info"]);

/**
 * Categories of validation issues
 */
export const ValidationIssueCategory = z.enum([
  "schema_mismatch",
  "missing_event",
  "undefined_value",
  "dashboard_render",
  "websocket_delivery",
]);

/**
 * Validation issue with location context
 */
export const ValidationIssueSchema = z.object({
  severity: ValidationIssueSeverity,
  category: ValidationIssueCategory,
  message: z.string(),
  location: z
    .object({
      event_type: z.string().optional(),
      field: z.string().optional(),
      component: z.string().optional(),
    })
    .optional(),
});

export type ValidationIssue = z.infer<typeof ValidationIssueSchema>;

// ============================================================================
// Validation Context
// ============================================================================

/**
 * Context for validation execution
 */
export interface ValidationContext {
  /** Project key (path) */
  project_key: string;
  /** Epic ID being validated */
  epic_id: string;
  /** Swarm ID being validated */
  swarm_id: string;
  /** Validation start time */
  started_at: Date;
  /** Event emitter function */
  emit: (event: AgentEvent) => Promise<void>;
}

// ============================================================================
// Validation Hook
// ============================================================================

/**
 * Run post-swarm validation
 *
 * Emits validation_started, runs validators, emits validation_issue for each issue,
 * and emits validation_completed with summary.
 *
 * @param ctx - Validation context
 * @param events - Events to validate
 * @returns Validation result with passed flag and issues
 */
export async function runPostSwarmValidation(
  ctx: ValidationContext,
  events: unknown[],
): Promise<{ passed: boolean; issues: ValidationIssue[] }> {
  const startTime = Date.now();
  const issues: ValidationIssue[] = [];

  // Emit validation_started
  await ctx.emit({
    type: "validation_started",
    project_key: ctx.project_key,
    timestamp: startTime,
    epic_id: ctx.epic_id,
    swarm_id: ctx.swarm_id,
    started_at: ctx.started_at.getTime(),
  });

  // TODO: Run validators (to be implemented in next tasks)
  // For now, this is just the infrastructure

  // Emit validation_completed
  const duration_ms = Date.now() - startTime;
  await ctx.emit({
    type: "validation_completed",
    project_key: ctx.project_key,
    timestamp: Date.now(),
    epic_id: ctx.epic_id,
    swarm_id: ctx.swarm_id,
    passed: issues.length === 0,
    issue_count: issues.length,
    duration_ms,
  });

  return { passed: issues.length === 0, issues };
}

/**
 * Report a validation issue
 *
 * Emits a validation_issue event with the provided issue details.
 *
 * @param ctx - Validation context
 * @param issue - Validation issue to report
 */
export async function reportIssue(
  ctx: ValidationContext,
  issue: ValidationIssue,
): Promise<void> {
  await ctx.emit({
    type: "validation_issue",
    project_key: ctx.project_key,
    timestamp: new Date().toISOString() as any, // Will be converted to number by event store
    epic_id: ctx.epic_id,
    severity: issue.severity,
    category: issue.category,
    message: issue.message,
    location: issue.location,
  });
}
