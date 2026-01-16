/**
 * Swarm Mail - Actor-model primitives for multi-agent coordination
 *
 * ## Simple API (libSQL convenience layer)
 * ```typescript
 * import { getSwarmMailLibSQL } from '@opencode/swarm-mail';
 * const swarmMail = await getSwarmMailLibSQL('/path/to/project');
 * ```
 *
 * ## Advanced API (database-agnostic adapter)
 * ```typescript
 * import { createSwarmMailAdapter } from '@opencode/swarm-mail';
 * const db = createCustomDbAdapter({ path: './custom.db' });
 * const swarmMail = createSwarmMailAdapter(db, '/path/to/project');
 * ```
 */

// Re-export version from version.ts which reads from package.json at runtime
// This prevents version drift between package.json and the exported constant
export { SWARM_MAIL_VERSION } from "./version";

// ============================================================================
// Debug Logging
// ============================================================================

export { log as debugLog } from "./debug";

// ============================================================================
// Core (database-agnostic)
// ============================================================================

export { createSwarmMailAdapter } from "./adapter";
export type {
	AgentAdapter,
	Conflict,
	DatabaseAdapter,
	EventStoreAdapter,
	InboxOptions,
	Message,
	MessagingAdapter,
	ReadEventsOptions,
	Reservation,
	ReservationAdapter,
	SchemaAdapter,
	SwarmMailAdapter,
} from "./types";

// ============================================================================
// LibSQL Adapter
// ============================================================================

export type { LibSQLConfig } from "./libsql";
export { createLibSQLAdapter } from "./libsql";

// ============================================================================
// Path Normalization Utilities (re-exported from swarm-cross-path)
// ============================================================================

export {
	normalize as normalizePath,
	normalizeProjectKey,
} from "swarm-cross-path";

// LibSQL Convenience Layer
export {
	closeAllSwarmMailLibSQL,
	closeAllSwarmMailLibSQL as closeAllSwarmMail, // Alias for backward compatibility
	closeSwarmMailLibSQL,
	createInMemorySwarmMailLibSQL,
	createInMemorySwarmMailLibSQL as createInMemorySwarmMail, // Alias for backward compatibility
	getDatabasePath as getLibSQLDatabasePath,
	getProjectTempDirName as getLibSQLProjectTempDirName,
	getSwarmMailLibSQL,
	hashProjectPath as hashLibSQLProjectPath,
} from "./libsql.convenience";
export {
	createLibSQLMemorySchema,
	dropLibSQLMemorySchema,
	EMBEDDING_DIM as LIBSQL_EMBEDDING_DIM,
	validateLibSQLMemorySchema,
} from "./memory/libsql-schema";
// LibSQL Schemas
export {
	createLibSQLStreamsSchema,
	dropLibSQLStreamsSchema,
	validateLibSQLStreamsSchema,
} from "./streams/libsql-schema";

// ============================================================================
// Streams Module Exports
// ============================================================================

// Re-export checkSwarmHealth from correct location
export { checkHealth as checkSwarmHealth } from "./streams/agent-mail";
export type {
	MigrationResult as AutoMigrationResult,
	MigrationStats as AutoMigrationStats,
	SourceType,
} from "./streams/auto-migrate";
// Auto-migration (project DB → global DB)
export {
	backupOldDb,
	detectSourceType,
	getGlobalDbPath,
	migrateLibSQLToGlobal,
	migrateLocalDbToGlobal,
	migrateProjectToGlobal,
	needsMigration,
} from "./streams/auto-migrate";
export type {
	DecisionTrace,
	DecisionTraceInput,
	EntityLinkInput,
} from "./streams/decision-trace-store";
// Decision trace store for observability
export {
	calculateDecisionQuality,
	createDecisionTrace,
	createEntityLink,
	findSimilarDecisions,
	getDecisionsByMemoryPattern,
	getDecisionTracesByAgent,
	getDecisionTracesByEpic,
	getDecisionTracesByType,
	getStrategySuccessRates,
	linkOutcomeToTrace,
} from "./streams/decision-trace-store";
export type {
	DecompositionGeneratedEvent,
	MailSessionState,
	SubtaskOutcomeEvent,
} from "./streams/events";
// Event types and creation (from events.ts)
export { createEvent } from "./streams/events";
// Event store primitives (now using Drizzle via wrapper functions)
// Projections (now using Drizzle via wrapper functions)
// Database path utilities
export {
	appendEvent,
	clearAdapterCache,
	getActiveReservations,
	getAgent,
	getDatabasePath,
	getEvalRecords,
	getEvalStats,
	getOldProjectDbPaths,
	getOrCreateAdapter,
	readEvents,
} from "./streams/index";
export type { EvalRecord } from "./streams/projections-drizzle";
// Swarm Mail functions
export {
	acknowledgeSwarmMessage,
	checkSwarmHealth as checkSwarmMailHealth,
	getSwarmInbox,
	initSwarmAgent,
	readSwarmMessage,
	releaseAllSwarmFiles,
	releaseSwarmFiles,
	releaseSwarmFilesForAgent,
	reserveSwarmFiles,
	sendSwarmMessage,
} from "./streams/swarm-mail";

// ============================================================================
// Durable Streams (real-time event streaming via SSE)
// ============================================================================

export {
	createDurableStreamAdapter,
	type DurableStreamAdapter,
	type StreamEvent,
} from "./streams/durable-adapter.js";

export {
	createDurableStreamServer,
	type DurableStreamServer,
	type DurableStreamServerConfig,
} from "./streams/durable-server.js";

// ============================================================================
// Analytics Module Exports
// ============================================================================

export type {
	AgentActivityFilters,
	FailedDecompositionsFilters,
	LockContentionFilters,
	MessageLatencyFilters,
	OutputFormat,
	QueryResult,
	StrategySuccessRatesFilters,
} from "./analytics/index.js";
// Event-sourcing analytics (queries 1-10 from analytics/)
export {
	agentActivity,
	checkpointFrequency,
	failedDecompositions,
	formatCSV,
	formatJSON,
	formatJSONL,
	formatTable,
	humanFeedback,
	lockContention,
	messageLatency,
	QueryBuilder,
	recoverySuccess,
	scopeViolations,
	strategySuccessRates,
	taskDuration,
} from "./analytics/index.js";
// AnalyticsQuery type (from query-builder module)
export type { AnalyticsQuery } from "./analytics/types.js";
// Four Golden Signals analytics (new root-level module)
export { ANALYTICS_QUERIES, runAnalyticsQuery } from "./analytics.js";

// ============================================================================
// Hive Module Exports (work item tracking)
// ============================================================================

export * from "./hive";

// ============================================================================
// Memory Module Exports (semantic memory store)
// ============================================================================

export { createMemoryAdapter } from "./memory/adapter";
export {
	memoryMigration,
	memoryMigrations,
} from "./memory/migrations";
export type { MemoryConfig } from "./memory/ollama";
export {
	getDefaultConfig,
	makeOllamaLive,
	Ollama,
	OllamaError,
	OllamaError as OllamaProviderError,
} from "./memory/ollama";
export type {
	Memory,
	SearchOptions,
	SearchResult,
} from "./memory/store";
export {
	createMemoryStore,
	EMBEDDING_DIM,
} from "./memory/store";
export type {
	ExportOptions as MemoryExportOptions,
	ImportOptions as MemoryImportOptions,
	MemoryExport,
	MemoryImportResult,
} from "./memory/sync";
// Memory sync (JSONL export/import for git)
export {
	exportMemories,
	importMemories,
	parseMemoryJSONL,
	serializeMemoryToJSONL,
	syncMemories,
} from "./memory/sync";
// Memory test utilities
export { createTestMemoryDb } from "./memory/test-utils";
export type {
	FieldSelection,
	FieldSet,
	MemoryField,
	SearchResultField,
} from "./sessions/pagination";
// Pagination API for field selection (token budget optimization)
export {
	FIELD_SETS,
	projectSearchResult,
	projectSearchResults,
} from "./sessions/pagination";

// ============================================================================
// Wave 1-2: Memory Intelligence Services
// ============================================================================

export type {
	AutoTagConfig,
	AutoTagResult,
} from "./memory/auto-tagger";
// Auto-tagging (LLM-powered tag generation)
export { generateTags } from "./memory/auto-tagger";
export type {
	Entity,
	ExtractionResult,
	Relationship,
} from "./memory/entity-extraction";
// Entity extraction (knowledge graph building)
export {
	extractEntitiesAndRelationships,
	getEntitiesByType,
	getRelationshipsForEntity,
	linkMemoryToEntities,
	storeEntities,
	storeRelationships,
} from "./memory/entity-extraction";
export type {
	LinkingConfig,
	MemoryLink,
} from "./memory/memory-linking";
// Memory linking (semantic relationship detection)
export {
	autoLinkMemory,
	createLink,
	findRelatedMemories,
	getLinks,
	updateLinkStrength,
} from "./memory/memory-linking";
export type {
	MemoryOperation,
	MemoryOperationConfig,
} from "./memory/memory-operations";
// Smart operations (ADD/UPDATE/DELETE/NOOP analysis)
export { analyzeMemoryOperation } from "./memory/memory-operations";

// ============================================================================
// Drizzle Database Client (for memory store)
// ============================================================================

export type { SwarmDb } from "./db";
export { closeDb, createInMemoryDb, getDb } from "./db";
export { createDrizzleClient } from "./db/drizzle";
export { withSqliteRetry } from "./db/retry";
export { toDrizzleDb, toSwarmDb } from "./libsql.convenience";

// ============================================================================
// Database Consolidation (stray database detection and migration)
// ============================================================================

export type { ManagedDb } from "./db/client-factory";
export { DbClientFactory } from "./db/client-factory";
export type {
	ConsolidationOptions,
	ConsolidationReport,
	StrayDatabase,
} from "./db/consolidate-databases";
export {
	analyzeStrayDatabase,
	consolidateDatabases,
	detectStrayDatabases,
	migrateToGlobal,
} from "./db/consolidate-databases";
export { DbFileOps } from "./db/file-ops";

// ============================================================================
// Session Management (CASS inhousing)
// ============================================================================

export type { FileEvent, FileWatcherOptions } from "./sessions/file-watcher";
export { FileWatcher } from "./sessions/file-watcher";
export type {
	IndexDirectoryOptions,
	IndexFileResult,
	IndexHealth,
	SearchOptions as SessionSearchOptions,
	SessionStats,
	StalenessResult,
} from "./sessions/session-indexer";
export { SessionIndexer } from "./sessions/session-indexer";
export type { SessionViewerOpts } from "./sessions/session-viewer";
export { viewSessionLine } from "./sessions/session-viewer";

// ============================================================================
// Legacy Hive Schema Migration (issues → cells)
// ============================================================================

export {
	type LegacyDependency,
	type LegacyEvent,
	type LegacyIssue,
	type MigrationSummary as LegacyHiveMigrationSummary,
	migrateLegacyHive,
	transformDependency,
	transformEvent,
	transformIssue,
} from "./migrations/legacy-hive-transformer";
