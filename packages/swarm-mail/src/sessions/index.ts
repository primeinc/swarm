/**
 * Sessions Module - Session indexing and search
 *
 * Provides session parsing, chunking, embedding, and search capabilities
 * for multi-agent conversation history.
 *
 * @module sessions
 */

// Chunk processor (message-level chunking + embedding)
export {
	ChunkProcessor,
	type EmbeddedChunk,
	type MessageChunk,
	type NormalizedMessage,
} from "./chunk-processor.js";

// File watcher (auto-indexing)
// export {
// 	FileWatcher,
// 	type FileWatcherOptions,
// 	type WatchEvent,
// } from "./file-watcher.js";

// Session parser (JSONL → NormalizedMessage)
// export {
// 	SessionParser,
// 	type SessionParserOptions,
// } from "./session-parser.js";

// Session viewer (JSONL line reader)
// export {
// 	SessionViewer,
// 	type SessionViewerOptions,
// } from "./session-viewer.js";

// Pagination (field projection for compact output)
export {
	FIELD_SETS,
	type FieldSelection,
	type FieldSet,
	type MemoryField,
	projectSearchResult,
	projectSearchResults,
	type SearchResultField,
} from "./pagination.js";
// Session indexer (main orchestrator)
export {
	type IndexDirectoryOptions,
	type IndexFileResult,
	type IndexHealth,
	type SearchOptions,
	SessionIndexer,
	type SessionStats,
	type StalenessResult,
} from "./session-indexer.js";
// Session quality (ghost session detection)
export {
	isQualitySession,
	type PurgeResult,
	purgeGhostSessions,
	type SessionQualityCriteria,
} from "./session-quality.js";
// Session store (indexing with quality filtering)
export {
	type FilteredIndexResult,
	type IndexWithFilteringOptions,
	type SessionQueryOptions,
	SessionStore,
} from "./session-store.js";
// Staleness detector (track index freshness)
export {
	type BulkStalenessCheckItem,
	type BulkStalenessResult,
	type CheckStalenessOpts,
	type IndexState,
	type RecordIndexedOpts,
	StalenessDetector,
} from "./staleness-detector.js";
