/**
 * Session Store Tests - TDD RED/GREEN/REFACTOR
 *
 * Tests for high-level session storage API with quality filtering.
 */

import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Effect } from "effect";
import { describe, expect, test } from "vitest";
import { createInMemoryDb } from "../db/client.js";
import { makeOllamaLive } from "../memory/ollama.js";
import { SessionStore } from "./session-store.js";

describe("SessionStore - Quality Filtering", () => {
	test("filters out ghost sessions during indexing", async () => {
		const db = await createInMemoryDb();
		const ollamaLayer = makeOllamaLive({
			ollamaHost: "http://localhost:11434",
			ollamaModel: "mxbai-embed-large",
		});

		const store = new SessionStore(db, ollamaLayer);

		// Create a ghost session (single event)
		const tmpDir = await fs.mkdtemp(
			path.join(os.tmpdir(), "session-store-test-"),
		);
		const ghostPath = path.join(tmpDir, "ghost.jsonl");
		await fs.writeFile(
			ghostPath,
			JSON.stringify({
				session_id: "ses_ghost",
				event_type: "session_start",
				timestamp: "2025-12-26T10:00:00Z",
				payload: {},
			}),
		);

		const result = await Effect.runPromise(
			store.indexFile(ghostPath, { skipGhostSessions: true }),
		);

		expect(result.filtered).toBe(true);
		expect(result.indexed).toBe(0);
		expect(result.eventCount).toBe(1);

		// Cleanup
		await fs.rm(tmpDir, { recursive: true });
	});

	test("indexes quality sessions normally", async () => {
		const db = await createInMemoryDb();
		const ollamaLayer = makeOllamaLive({
			ollamaHost: "http://localhost:11434",
			ollamaModel: "mxbai-embed-large",
		});

		const store = new SessionStore(db, ollamaLayer);

		// Create a quality session (multiple events with meaningful work)
		const tmpDir = await fs.mkdtemp(
			path.join(os.tmpdir(), "session-store-test-"),
		);
		const qualityPath = path.join(tmpDir, "quality.jsonl");
		const events = [
			{
				session_id: "ses_quality",
				event_type: "session_start",
				timestamp: "2025-12-26T10:00:00Z",
				payload: {},
			},
			{
				session_id: "ses_quality",
				event_type: "DECISION",
				timestamp: "2025-12-26T10:00:30Z",
				payload: { action: "spawn" },
			},
			{
				session_id: "ses_quality",
				event_type: "OUTCOME",
				timestamp: "2025-12-26T10:01:30Z",
				payload: { status: "success" },
			},
		];
		await fs.writeFile(
			qualityPath,
			events.map((e) => JSON.stringify(e)).join("\n"),
		);

		const result = await Effect.runPromise(
			store.indexFile(qualityPath, { skipGhostSessions: true }),
		);

		expect(result.filtered).toBe(false);
		expect(result.indexed).toBeGreaterThan(0);
		expect(result.eventCount).toBe(3);
		expect(result.durationSeconds).toBe(90);

		// Cleanup
		await fs.rm(tmpDir, { recursive: true });
	});

	test("respects custom quality criteria", async () => {
		const db = await createInMemoryDb();
		const ollamaLayer = makeOllamaLive({
			ollamaHost: "http://localhost:11434",
			ollamaModel: "mxbai-embed-large",
		});

		const store = new SessionStore(db, ollamaLayer);

		// Create a borderline session (3 events, but short duration)
		const tmpDir = await fs.mkdtemp(
			path.join(os.tmpdir(), "session-store-test-"),
		);
		const borderlinePath = path.join(tmpDir, "borderline.jsonl");
		const events = [
			{
				session_id: "ses_borderline",
				event_type: "session_start",
				timestamp: "2025-12-26T10:00:00Z",
				payload: {},
			},
			{
				session_id: "ses_borderline",
				event_type: "DECISION",
				timestamp: "2025-12-26T10:00:15Z",
				payload: {},
			},
			{
				session_id: "ses_borderline",
				event_type: "OUTCOME",
				timestamp: "2025-12-26T10:00:25Z",
				payload: {},
			},
		];
		await fs.writeFile(
			borderlinePath,
			events.map((e) => JSON.stringify(e)).join("\n"),
		);

		// Default criteria would filter (25s < 60s minimum)
		const defaultResult = await Effect.runPromise(
			store.indexFile(borderlinePath, { skipGhostSessions: true }),
		);
		expect(defaultResult.filtered).toBe(true);

		// Custom criteria allowing shorter sessions
		const customResult = await Effect.runPromise(
			store.indexFile(borderlinePath, {
				skipGhostSessions: true,
				qualityCriteria: { minDurationSeconds: 20 },
			}),
		);
		expect(customResult.filtered).toBe(false);

		// Cleanup
		await fs.rm(tmpDir, { recursive: true });
	});
});
