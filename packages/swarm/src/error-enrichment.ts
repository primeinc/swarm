/**
 * Error Enrichment - Structured error context for swarm agents
 *
 * TDD GREEN: Minimal implementation to pass tests
 */

export interface SwarmErrorContext {
	file?: string;
	line?: number;
	agent?: string;
	epic_id?: string;
	cell_id?: string;
	recent_events?: Array<{
		type: string;
		timestamp: string;
		message: string;
	}>;
}

/**
 * SwarmError - Error class with structured context
 */
export class SwarmError extends Error {
	context: SwarmErrorContext;

	constructor(message: string, context: SwarmErrorContext = {}) {
		super(message);
		this.name = "SwarmError";
		this.context = context;

		// Preserve stack trace
		if (Error.captureStackTrace) {
			Error.captureStackTrace(this, SwarmError);
		}
	}

	toJSON() {
		return {
			name: this.name,
			message: this.message,
			context: this.context,
			stack: this.stack,
		};
	}
}

/**
 * enrichError - Convert any error to SwarmError with context
 */
export function enrichError(
	error: unknown,
	context: SwarmErrorContext,
): SwarmError {
	// Already a SwarmError - merge contexts
	if (error instanceof SwarmError) {
		const merged = new SwarmError(error.message, {
			...error.context,
			...context,
		});
		merged.stack = error.stack;
		return merged;
	}

	// Plain Error - convert to SwarmError
	if (error instanceof Error) {
		const enriched = new SwarmError(error.message, context);
		enriched.stack = error.stack;
		return enriched;
	}

	// String error
	if (typeof error === "string") {
		return new SwarmError(error, context);
	}

	// Unknown type - stringify
	return new SwarmError(String(error), context);
}

/**
 * debugLog - Conditional logging based on DEBUG env var
 *
 * Patterns:
 * - DEBUG=swarm:* (all)
 * - DEBUG=swarm:coordinator
 * - DEBUG=swarm:worker
 * - DEBUG=swarm:mail
 */
export function debugLog(
	namespace: string,
	message: string,
	data?: unknown,
): void {
	const debug = process.env.DEBUG;
	if (!debug) return;

	// Parse DEBUG patterns (comma-separated)
	const patterns = debug.split(",").map((p) => p.trim());

	// Check if namespace matches any pattern
	const matches = patterns.some((pattern) => {
		if (pattern === "swarm:*") return true;
		if (pattern === `swarm:${namespace}`) return true;
		return false;
	});

	if (!matches) return;

	// Format with box-drawing characters - single console.log call
	let output = `┌─ swarm:${namespace} ─────────────────────\n`;
	output += `│ ${message}`;
	if (data !== undefined) {
		output += `\n│ ${JSON.stringify(data)}`;
	}
	output += `\n└──────────────────────────────────────────`;

	console.log(output);
}

/**
 * suggestFix - Pattern matching for common swarm errors
 */
export function suggestFix(error: Error | SwarmError): string | null {
	const message = error.message.toLowerCase();
	const isSwarmError = error instanceof SwarmError;
	const context = isSwarmError ? error.context : {};

	// Complex error - check for multiple issues FIRST (more specific)
	if (message.includes("reservation") && message.includes("not initialized")) {
		return formatSuggestion(
			"Multiple issues detected",
			"1. Call swarmmail_init() first\n2. Then reserve files with swarmmail_reserve()",
			context,
		);
	}

	// Agent not registered
	if (message.includes("agent not registered")) {
		return formatSuggestion(
			"Agent not initialized",
			"Call swarmmail_init() before any swarm operations",
			context,
		);
	}

	// File already reserved
	if (message.includes("already reserved")) {
		return formatSuggestion(
			"File reserved",
			"File is reserved by another agent. Either wait for release or coordinate with the agent.",
			context,
		);
	}

	// Uncommitted changes
	if (message.includes("uncommitted changes")) {
		return formatSuggestion(
			"Git working directory dirty",
			"Run hive_sync() or commit your changes before proceeding",
			context,
		);
	}

	// Pattern not found
	if (message.includes("pattern") && message.includes("found")) {
		return formatSuggestion(
			"Learning database query failed",
			"Try semantic-memory_find() with different search terms",
			context,
		);
	}

	// Manual close detected
	if (message.includes("manual") && message.includes("close")) {
		return formatSuggestion(
			"Worker used manual close",
			"Use swarm_complete() instead of hive_close() in worker agents",
			context,
		);
	}

	// Database not initialized
	if (message.includes("libsql") && message.includes("not initialized")) {
		return formatSuggestion(
			"Database not initialized",
			"Ensure swarmmail_init() is called to initialize the database connection",
			context,
		);
	}

	// Context exhausted
	if (message.includes("context") && message.includes("exhausted")) {
		return formatSuggestion(
			"Context window full",
			"Use /checkpoint to compress context or spawn a subagent for detailed work",
			context,
		);
	}

	return null;
}

function formatSuggestion(
	title: string,
	suggestion: string,
	context: SwarmErrorContext,
): string {
	let result = `${title}: ${suggestion}`;

	// Add context hints if available
	if (context.agent) {
		result += `\nAgent: ${context.agent}`;
	}
	if (context.cell_id) {
		result += `\nCell: ${context.cell_id}`;
	}

	return result;
}
