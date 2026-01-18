/**
 * Session Export - Export events from libSQL to JSONL files for git sync
 *
 * Part of the hybrid architecture where:
 * - libSQL = system-level source of truth (all reads/writes)
 * - JSONL = project-level git artifact (export-only for persistence)
 *
 * This function reads events from the libSQL event store and writes them
 * to JSONL files grouped by session_id for git tracking.
 *
 * @module sessions/session-export
 */

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { AgentEvent } from "../streams/events.js";
import type { SwarmMailAdapter } from "../types/adapter.js";

export interface ExportOptions {
	/** Only export events after this timestamp */
	since?: number;
	/** Only export specific session IDs */
	sessionIds?: string[];
}

export interface ExportResult {
	/** Number of events exported */
	exported: number;
	/** List of JSONL files written */
	files: string[];
}

/**
 * Export sessions from libSQL to JSONL files
 *
 * Reads events from the libSQL event store and writes them to JSONL files
 * grouped by session_id. Each session gets its own file: {outputDir}/{session_id}.jsonl
 *
 * @param adapter - SwarmMailAdapter instance
 * @param outputDir - Directory to write JSONL files
 * @param options - Export options (since timestamp, sessionIds filter)
 * @returns Export result with count and file list
 *
 * @example
 * ```typescript
 * const adapter = await getSwarmMailLibSQL('/path/to/project');
 * const result = await exportSessionsToJsonl(adapter, '.hive/sessions', {
 *   since: Date.now() - 86400000, // Last 24 hours
 * });
 * console.log(`Exported ${result.exported} events to ${result.files.length} files`);
 * ```
 */
export async function exportSessionsToJsonl(
	adapter: SwarmMailAdapter,
	outputDir: string,
	options: ExportOptions = {},
): Promise<ExportResult> {
	// Read events from libSQL
	const events = await adapter.readEvents({
		since: options.since,
	});

	// Group events by session_id
	const sessionMap = new Map<
		string,
		Array<AgentEvent & { id: number; sequence: number }>
	>();

	for (const event of events) {
		// Extract session_id from event data
		// Session ID is typically stored in the event data JSON
		const sessionId = extractSessionId(event);

		// Skip if sessionIds filter is specified and this session isn't included
		if (options.sessionIds && !options.sessionIds.includes(sessionId)) {
			continue;
		}

		if (!sessionMap.has(sessionId)) {
			sessionMap.set(sessionId, []);
		}

		sessionMap.get(sessionId)!.push(event);
	}

	// Ensure output directory exists
	await mkdir(outputDir, { recursive: true });

	// Write each session to its own JSONL file
	const files: string[] = [];
	let totalExported = 0;

	for (const [sessionId, sessionEvents] of sessionMap.entries()) {
		const filePath = join(outputDir, `${sessionId}.jsonl`);

		// Convert events to JSONL format (one JSON object per line)
		const jsonlContent = sessionEvents
			.map((event) => JSON.stringify(event))
			.join("\n");

		// Write to file
		await writeFile(filePath, jsonlContent + "\n", "utf-8");

		files.push(filePath);
		totalExported += sessionEvents.length;
	}

	return {
		exported: totalExported,
		files,
	};
}

/**
 * Extract session_id from an event
 *
 * Session ID can be stored in different places depending on event type:
 * - Explicit session_id field in data
 * - Epic ID (for swarm coordination events)
 * - Thread ID (for message events)
 * - Falls back to sanitized project_key if no session identifier found
 *
 * @param event - Event with id, sequence, and data
 * @returns Session identifier (sanitized for use as filename)
 */
function extractSessionId(
	event: AgentEvent & { id: number; sequence: number },
): string {
	// Check for explicit session_id in event data
	if ("session_id" in event && typeof event.session_id === "string") {
		return sanitizeSessionId(event.session_id);
	}

	// Check for epic_id (swarm coordination)
	if ("epic_id" in event && typeof event.epic_id === "string") {
		return sanitizeSessionId(event.epic_id);
	}

	// Check for thread_id (messaging)
	if ("thread_id" in event && typeof event.thread_id === "string") {
		return sanitizeSessionId(event.thread_id);
	}

	// Fallback to sanitized project_key (all events in same session)
	return sanitizeSessionId(event.project_key);
}

/**
 * Sanitize session ID for use as filename
 *
 * Replaces path separators and other problematic characters with safe alternatives.
 *
 * @param sessionId - Raw session identifier
 * @returns Sanitized session ID safe for use as filename
 */
function sanitizeSessionId(sessionId: string): string {
	return sessionId
		.replace(/\//g, "-") // Replace forward slashes
		.replace(/\\/g, "-") // Replace backslashes
		.replace(/:/g, "-") // Replace colons (Windows drive letters)
		.replace(/\s+/g, "_") // Replace whitespace with underscores
		.replace(/[<>:"|?*]/g, "_"); // Replace other invalid filename chars
}
