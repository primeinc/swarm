#!/usr/bin/env bun
/**
 * JSONL to libSQL Migration Script
 *
 * One-time migration to import existing coordinator session JSONL files
 * into the libSQL events table.
 *
 * Source: ~/.config/swarm-tools/sessions/*.jsonl (180 files, ~1126 events)
 * Target: Global libSQL database via getSwarmMailLibSQL
 *
 * Event types in JSONL:
 * - DECISION (998 events)
 * - OUTCOME (117 events)
 * - COMPACTION (11 events)
 *
 * Maps to coordinator event types in events.ts:
 * - coordinator_decision
 * - coordinator_outcome
 * - coordinator_compaction
 *
 * Usage:
 *   bun run scripts/migrate-jsonl-to-libsql.ts [--dry-run] [--sessions-dir <path>]
 *
 * @example
 * # Dry run to preview
 * bun run scripts/migrate-jsonl-to-libsql.ts --dry-run
 *
 * # Run migration
 * bun run scripts/migrate-jsonl-to-libsql.ts
 *
 * # Custom sessions directory
 * bun run scripts/migrate-jsonl-to-libsql.ts --sessions-dir /path/to/sessions
 */

import { readdir, readFile } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { parseArgs } from "node:util";
import { getSwarmMailLibSQL } from "swarm-mail";
import type { DatabaseAdapter } from "swarm-mail";

// ============================================================================
// CLI Arguments
// ============================================================================

const { values } = parseArgs({
	options: {
		"dry-run": { type: "boolean", default: false },
		"sessions-dir": {
			type: "string",
			default: path.join(os.homedir(), ".config/swarm-tools/sessions"),
		},
	},
	strict: true,
	allowPositionals: false,
});

const DRY_RUN = values["dry-run"] ?? false;
const SESSIONS_DIR = values["sessions-dir"] as string;

// ============================================================================
// JSONL Event Schema
// ============================================================================

interface JSONLEvent {
	session_id: string;
	epic_id: string;
	timestamp: string; // ISO-8601
	event_type: "DECISION" | "OUTCOME" | "COMPACTION" | "VIOLATION";
	decision_type?: string;
	outcome_type?: string;
	compaction_type?: string;
	violation_type?: string;
	payload: unknown;
}

// ============================================================================
// Event Type Mapping
// ============================================================================

/**
 * Map JSONL event to libSQL event type
 */
function mapEventType(
	jsonlEvent: JSONLEvent,
):
	| "coordinator_decision"
	| "coordinator_outcome"
	| "coordinator_compaction"
	| "coordinator_violation"
	| null {
	switch (jsonlEvent.event_type) {
		case "DECISION":
			return "coordinator_decision";
		case "OUTCOME":
			return "coordinator_outcome";
		case "COMPACTION":
			return "coordinator_compaction";
		case "VIOLATION":
			return "coordinator_violation";
		default:
			return null;
	}
}

/**
 * Convert JSONL event to libSQL event row format
 */
function convertEvent(
	jsonlEvent: JSONLEvent,
	projectKey: string,
): { type: string; project_key: string; timestamp: number; data: string } | null {
	const eventType = mapEventType(jsonlEvent);
	if (!eventType) {
		console.warn(
			`Unknown event type: ${jsonlEvent.event_type} in session ${jsonlEvent.session_id}`,
		);
		return null;
	}

	const timestamp = new Date(jsonlEvent.timestamp).getTime();

	// The data field stores everything except type, project_key, and timestamp
	const data = {
		session_id: jsonlEvent.session_id,
		epic_id: jsonlEvent.epic_id,
		event_type: jsonlEvent.event_type,
		payload: jsonlEvent.payload,
	};

	// Add type-specific fields
	if (jsonlEvent.decision_type) {
		(data as any).decision_type = jsonlEvent.decision_type;
	}
	if (jsonlEvent.outcome_type) {
		(data as any).outcome_type = jsonlEvent.outcome_type;
	}
	if (jsonlEvent.compaction_type) {
		(data as any).compaction_type = jsonlEvent.compaction_type;
	}
	if (jsonlEvent.violation_type) {
		(data as any).violation_type = jsonlEvent.violation_type;
	}

	return {
		type: eventType,
		project_key: projectKey,
		timestamp,
		data: JSON.stringify(data),
	};
}

// ============================================================================
// Migration
// ============================================================================

/**
 * Read all JSONL files from sessions directory
 */
async function readSessionFiles(sessionsDir: string): Promise<JSONLEvent[]> {
	const files = await readdir(sessionsDir);
	const jsonlFiles = files.filter((f) => f.endsWith(".jsonl"));

	console.log(
		`Found ${jsonlFiles.length} JSONL files in ${sessionsDir}`,
	);

	const allEvents: JSONLEvent[] = [];

	for (const file of jsonlFiles) {
		const filePath = path.join(sessionsDir, file);
		const content = await readFile(filePath, "utf-8");
		const lines = content.trim().split("\n").filter(Boolean);

		for (const line of lines) {
			try {
				const event = JSON.parse(line) as JSONLEvent;
				allEvents.push(event);
			} catch (error) {
				console.error(`Failed to parse line in ${file}:`, line);
				console.error(error);
			}
		}
	}

	return allEvents;
}

/**
 * Check if event already exists in database
 * Uses timestamp + session_id as uniqueness key
 */
async function eventExists(
	db: DatabaseAdapter,
	timestamp: number,
	sessionId: string,
): Promise<boolean> {
	// Query using DatabaseAdapter query method
	const result = await db.query(
		`SELECT id FROM events 
		 WHERE timestamp = ? 
		 AND json_extract(data, '$.session_id') = ?
		 LIMIT 1`,
		[timestamp, sessionId]
	);

	return result.rows.length > 0;
}

/**
 * Batch insert events into libSQL
 */
async function batchInsertEvents(
	db: DatabaseAdapter,
	events: Array<{ type: string; project_key: string; timestamp: number; data: string }>,
): Promise<number> {
	if (events.length === 0) return 0;

	// Batch insert - libSQL supports multiple values
	const BATCH_SIZE = 100;
	let insertedCount = 0;

	for (let i = 0; i < events.length; i += BATCH_SIZE) {
		const batch = events.slice(i, i + BATCH_SIZE);

		// Build INSERT statement with multiple values
		const placeholders = batch.map(() => "(?, ?, ?, ?)").join(", ");
		const values: any[] = [];
		for (const row of batch) {
			values.push(row.type, row.project_key, row.timestamp, row.data);
		}

		await db.query(
			`INSERT INTO events (type, project_key, timestamp, data) VALUES ${placeholders}`,
			values
		);

		insertedCount += batch.length;
	}

	return insertedCount;
}

/**
 * Main migration function
 */
async function migrate() {
	console.log("═══════════════════════════════════════════════════════════");
	console.log("  JSONL → libSQL Migration");
	console.log("═══════════════════════════════════════════════════════════");
	console.log(`Mode: ${DRY_RUN ? "DRY RUN" : "LIVE"}`);
	console.log(`Sessions directory: ${SESSIONS_DIR}`);
	console.log("");

	// Step 1: Read all JSONL files
	console.log("Step 1: Reading JSONL files...");
	const jsonlEvents = await readSessionFiles(SESSIONS_DIR);
	console.log(`✓ Found ${jsonlEvents.length} events in JSONL files`);
	console.log("");

	// Event type distribution
	const typeDistribution = jsonlEvents.reduce(
		(acc, e) => {
			acc[e.event_type] = (acc[e.event_type] || 0) + 1;
			return acc;
		},
		{} as Record<string, number>,
	);
	console.log("Event type distribution:");
	for (const [type, count] of Object.entries(typeDistribution)) {
		console.log(`  ${type}: ${count}`);
	}
	console.log("");

	if (DRY_RUN) {
		console.log("DRY RUN: Would import these events to libSQL");
		console.log("Run without --dry-run to execute migration");
		return;
	}

	// Step 2: Get libSQL database
	console.log("Step 2: Connecting to libSQL...");
	const swarmMail = await getSwarmMailLibSQL(process.cwd());
	const db = await swarmMail.getDatabase();
	console.log("✓ Connected to libSQL");
	console.log("");

	// Step 3: Convert and deduplicate events
	console.log("Step 3: Converting and checking for duplicates...");
	const projectKey = process.cwd();
	const eventsToInsert: Array<{
		type: string;
		project_key: string;
		timestamp: number;
		data: string;
	}> = [];

	let skippedInvalid = 0;
	let skippedDuplicate = 0;

	for (const jsonlEvent of jsonlEvents) {
		const converted = convertEvent(jsonlEvent, projectKey);
		if (!converted) {
			skippedInvalid++;
			continue;
		}

		// Check if already exists
		const exists = await eventExists(
			db,
			converted.timestamp,
			jsonlEvent.session_id,
		);
		if (exists) {
			skippedDuplicate++;
			continue;
		}

		eventsToInsert.push(converted);
	}

	console.log(`✓ Converted ${eventsToInsert.length} events`);
	console.log(`  Skipped (invalid): ${skippedInvalid}`);
	console.log(`  Skipped (duplicate): ${skippedDuplicate}`);
	console.log("");

	// Step 4: Batch insert
	console.log("Step 4: Inserting events...");
	const insertedCount = await batchInsertEvents(db, eventsToInsert);
	console.log(`✓ Inserted ${insertedCount} events`);
	console.log("");

	console.log("═══════════════════════════════════════════════════════════");
	console.log("  Migration Complete");
	console.log("═══════════════════════════════════════════════════════════");
	console.log(`Total events processed: ${jsonlEvents.length}`);
	console.log(`Successfully inserted: ${insertedCount}`);
	console.log(`Skipped (invalid): ${skippedInvalid}`);
	console.log(`Skipped (duplicate): ${skippedDuplicate}`);
}

// ============================================================================
// Run
// ============================================================================

migrate().catch((error) => {
	console.error("Migration failed:");
	console.error(error);
	process.exit(1);
});
