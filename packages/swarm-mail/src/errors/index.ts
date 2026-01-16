/**
 * Structured error classes with rich context for swarm observability.
 *
 * All errors include:
 * - Agent name (if available)
 * - Cell/cell ID and epic ID (for correlation)
 * - Timestamp and sequence number
 * - Recent events from event log (last 5)
 * - Actionable suggestions for resolution
 *
 * @example
 * ```typescript
 * import { ReservationError } from './errors';
 *
 * throw new ReservationError("File already reserved", {
 *   agent: "WiseStone",
 *   cell_id: "bd-123",
 *   current_holder: {
 *     agent: "OtherAgent",
 *     expires_at: Date.now() + 3600000,
 *     reason: "Working on bd-456"
 *   },
 *   suggestions: ["Wait for expiry", "Request access via swarm mail"]
 * });
 *
 * // Error can be serialized for logging
 * const json = error.toJSON();
 * console.log(JSON.stringify(json, null, 2));
 * ```
 */

export type { ErrorContext } from "./base-error";
export { BaseSwarmError } from "./base-error";
export { CheckpointError } from "./checkpoint-error";
export { DecompositionError } from "./decomposition-error";
export { ReservationError } from "./reservation-error";
export { ValidationError } from "./validation-error";
