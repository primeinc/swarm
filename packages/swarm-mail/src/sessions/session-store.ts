/**
 * Session Store - High-level API for session storage with quality filtering
 *
 * Extends SessionIndexer with quality filtering capabilities to prevent
 * ghost sessions (single-event, no meaningful work) from polluting eval data.
 *
 * @module sessions/session-store
 */

import { promises as fs } from "node:fs";
import { Effect, type Layer } from "effect";
import type { SwarmDb } from "../db/client.js";
import type { Ollama } from "../memory/ollama.js";
import {
	type IndexFileResult,
	type SearchOptions,
	SessionIndexer,
} from "./session-indexer.js";
import { type NormalizedMessage, SessionParser } from "./session-parser.js";
import {
	isQualitySession,
	type PurgeResult,
	purgeGhostSessions,
	type SessionQualityCriteria,
} from "./session-quality.js";

/**
 * Options for indexing with quality filtering
 */
export interface IndexWithFilteringOptions {
	/** Quality criteria for filtering (uses defaults if not provided) */
	qualityCriteria?: SessionQualityCriteria;
	/** Whether to skip ghost sessions during indexing (default: true) */
	skipGhostSessions?: boolean;
}

/**
 * Result from indexing with quality filtering
 */
export interface FilteredIndexResult extends IndexFileResult {
	/** Whether the session was filtered out as a ghost */
	filtered: boolean;
	/** Number of events in the session */
	eventCount: number;
	/** Session duration in seconds (null if timestamps invalid) */
	durationSeconds: number | null;
}

/**
 * Options for querying sessions with quality filtering
 */
export interface SessionQueryOptions {
	/** Minimum number of events per session */
	minEvents?: number;
	/** Filter by agent type */
	agentType?: string;
	/** Maximum number of sessions to return */
	limit?: number;
}

/**
 * Session Store - Wrapper around SessionIndexer with quality filtering
 *
 * Provides a higher-level API that automatically filters ghost sessions
 * during indexing and querying.
 */
export class SessionStore {
	private indexer: SessionIndexer;
	private db: SwarmDb;
	private ollamaLayer: Layer.Layer<Ollama>;
	private defaultCriteria: SessionQualityCriteria;

	constructor(
		db: SwarmDb,
		ollamaLayer: Layer.Layer<Ollama>,
		defaultCriteria: SessionQualityCriteria = {},
	) {
		this.db = db;
		this.ollamaLayer = ollamaLayer;
		this.indexer = new SessionIndexer(db, ollamaLayer);
		this.defaultCriteria = defaultCriteria;
	}

	/**
	 * Index a single session file with quality filtering
	 *
	 * @param filePath - Absolute path to JSONL session file
	 * @param options - Indexing options
	 * @returns Effect with filtered index result
	 *
	 * @example
	 * ```typescript
	 * const result = await Effect.runPromise(
	 *   store.indexFile('/path/to/session.jsonl', {
	 *     skipGhostSessions: true,
	 *     qualityCriteria: { minEvents: 5 }
	 *   })
	 * );
	 *
	 * if (result.filtered) {
	 *   console.log('Ghost session skipped');
	 * } else {
	 *   console.log(`Indexed ${result.indexed} chunks`);
	 * }
	 * ```
	 */
	indexFile(
		filePath: string,
		options: IndexWithFilteringOptions = {},
	): Effect.Effect<FilteredIndexResult, Error> {
		const self = this;
		return Effect.gen(function* (_) {
			const {
				qualityCriteria = self.defaultCriteria,
				skipGhostSessions = true,
			} = options;

			// Parse session to check quality before indexing
			const content = yield* _(
				Effect.tryPromise({
					try: () => fs.readFile(filePath, "utf-8"),
					catch: (error: unknown) => new Error(`Failed to read file: ${error}`),
				}),
			);

			const parser = new SessionParser("opencode-swarm");
			const messages = yield* _(
				Effect.tryPromise({
					try: () => parser.parse(content, { filePath }),
					catch: (error: unknown) =>
						new Error(`Failed to parse JSONL: ${error}`),
				}),
			);

			// Check quality
			const isQuality = isQualitySession(messages, qualityCriteria);
			const duration = calculateDuration(messages);

			// Skip ghost sessions if requested
			if (skipGhostSessions && !isQuality) {
				return {
					path: filePath,
					agent_type: "opencode-swarm",
					indexed: 0,
					skipped: messages.length,
					duration_ms: 0,
					filtered: true,
					eventCount: messages.length,
					durationSeconds: duration,
				};
			}

			// Index the session
			const indexResult = yield* _(self.indexer.indexFile(filePath));

			return {
				...indexResult,
				filtered: false,
				eventCount: messages.length,
				durationSeconds: duration,
			};
		});
	}

	/**
	 * Purge ghost sessions from the memory store
	 *
	 * WARNING: This is a destructive operation. Consider backing up first.
	 *
	 * @param criteria - Quality criteria for purging
	 * @returns Effect with purge result
	 *
	 * @example
	 * ```typescript
	 * const result = await Effect.runPromise(
	 *   store.purgeGhosts({ minEvents: 3, minDurationSeconds: 60 })
	 * );
	 *
	 * console.log(`Purged ${result.stats.purgedCount} ghost sessions`);
	 * console.log(`Kept ${result.stats.keptCount} quality sessions`);
	 * ```
	 */
	purgeGhosts(
		criteria: SessionQualityCriteria = {},
	): Effect.Effect<PurgeResult, Error> {
		// TODO: Implement actual database purge
		// For now, this is a placeholder that would need to:
		// 1. Query all unique session_ids from memory store
		// 2. Load messages for each session
		// 3. Filter by quality
		// 4. Delete ghost session chunks from memory store

		// Placeholder implementation
		const sessions = new Map<string, NormalizedMessage[]>();
		const result = purgeGhostSessions(sessions, criteria);

		return Effect.succeed(result);
	}

	/**
	 * Search sessions with quality filtering
	 *
	 * @param query - Search query
	 * @param options - Search options with quality filters
	 * @returns Effect with search results
	 */
	search(
		query: string,
		options: SearchOptions = {},
	): Effect.Effect<any[], Error> {
		// Delegate to indexer (quality filtering would be added in future)
		return this.indexer.search(query, options);
	}
}

/**
 * Calculate session duration in seconds
 */
function calculateDuration(messages: NormalizedMessage[]): number | null {
	if (messages.length === 0) return null;

	try {
		const timestamps = messages
			.map((m) => new Date(m.timestamp).getTime())
			.filter((t) => !isNaN(t));

		if (timestamps.length < 2) return null;

		const earliest = Math.min(...timestamps);
		const latest = Math.max(...timestamps);

		return (latest - earliest) / 1000;
	} catch {
		return null;
	}
}
