/**
 * Memory Module - Semantic memory with vector embeddings
 *
 * Provides Ollama-based embedding generation and memory storage.
 */

// High-level adapter (primary API)
export {
	createMemoryAdapter,
	type FindOptions,
	type HealthStatus,
	type Memory,
	type MemoryConfig,
	type SearchResult,
	type StoreOptions,
} from "./adapter.js";
// Auto-tagging (LLM-based tag generation)
export {
	type AutoTagConfig,
	type AutoTagResult,
	generateTags,
} from "./auto-tagger.js";
// Legacy migration tool
export {
	getDefaultLegacyPath,
	getMigrationStatus,
	legacyDatabaseExists,
	type MigrationOptions,
	type MigrationResult,
	migrateLegacyMemories,
} from "./migrate-legacy.js";
// Migrations
export {
	memoryMigration,
	memoryMigrations,
	type OllamaEmbedder,
	type RepairStats,
	repairStaleEmbeddings,
} from "./migrations.js";
// Low-level services (advanced usage)
export {
	getDefaultConfig,
	makeOllamaLive,
	Ollama,
	OllamaError,
} from "./ollama.js";
export { createMemoryStore, EMBEDDING_DIM } from "./store.js";

// Git sync (JSONL export/import)
export {
	type ExportOptions as MemoryExportOptions,
	exportMemories,
	type ImportOptions as MemoryImportOptions,
	importMemories,
	type MemoryExport,
	type MemoryImportResult,
	parseMemoryJSONL,
	serializeMemoryToJSONL,
	syncMemories,
} from "./sync.js";
