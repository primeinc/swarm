/**
 * Context information attached to swarm errors for debugging and observability.
 */
export interface ErrorContext {
	/** Agent name (e.g., "WiseStone") */
	agent?: string;
	/** Cell/cell ID (e.g., "bd-123") */
	cell_id?: string;
	/** Epic ID (e.g., "bd-100") */
	epic_id?: string;
	/** Unix timestamp in milliseconds */
	timestamp: number;
	/** Event sequence number */
	sequence?: number;
	/** Human-readable reason for error */
	reason?: string;
	/** Current holder info for reservation errors */
	current_holder?: {
		agent: string;
		expires_at: number;
		reason: string;
	};
	/** Last 5 events from event log for debugging */
	recent_events?: Array<{ type: string; timestamp: number; data: unknown }>;
	/** Actionable suggestions for resolving the error */
	suggestions: string[];
}

/**
 * Base class for all swarm-related errors with rich context.
 * Provides structured error information for observability and debugging.
 */
export class BaseSwarmError extends Error {
	public readonly context: ErrorContext;

	constructor(message: string, context?: Partial<ErrorContext>) {
		super(message);
		this.name = "BaseSwarmError";

		// Ensure Error.captureStackTrace is available before calling it
		if (Error.captureStackTrace) {
			Error.captureStackTrace(this, this.constructor);
		}

		// Populate context with defaults
		this.context = {
			timestamp: context?.timestamp ?? Date.now(),
			suggestions: context?.suggestions ?? [],
			recent_events: context?.recent_events ?? [],
			...context,
		};
	}

	/**
	 * Serialize error to JSON for logging and transmission.
	 */
	toJSON() {
		return {
			name: this.name,
			message: this.message,
			context: this.context,
			stack: this.stack,
		};
	}
}
