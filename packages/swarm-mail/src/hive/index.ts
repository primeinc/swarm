/**
 * Beads Module - Event-sourced issue tracking
 *
 * Exports:
 * - HiveAdapter interface and types
 * - Migration definitions
 * - Projection functions
 * - Store operations (append, read, replay)
 * - Event type definitions
 *
 * @module beads
 */

// Types
export type {
	// Backward compatibility aliases
	Bead,
	BeadAdapter,
	BeadComment,
	BeadDependency,
	BeadLabel,
	BeadStatus,
	BeadsAdapter,
	BeadsAdapterFactory,
	BeadsSchemaAdapter,
	BeadType,
	Cell,
	CellAdapter,
	CellComment,
	CellDependency,
	CellLabel,
	CellStatus,
	CellType,
	CommentAdapter,
	CreateBeadOptions,
	CreateCellOptions,
	DependencyAdapter,
	DependencyRelationship,
	EpicAdapter,
	HiveAdapter,
	HiveAdapterFactory,
	HiveSchemaAdapter,
	LabelAdapter,
	QueryAdapter,
	QueryBeadsOptions,
	QueryCellsOptions,
	UpdateBeadOptions,
	UpdateCellOptions,
} from "../types/hive-adapter.js";
// Adapter factory
// Backward compatibility alias
export {
	createHiveAdapter,
	createHiveAdapter as createBeadsAdapter,
} from "./adapter.js";
// Comment operations
export {
	getCommentById,
	getCommentThread,
} from "./comments.js";
// Dependency operations
export {
	getOpenBlockers,
	invalidateBlockedCache,
	rebuildAllBlockedCaches,
	rebuildBeadBlockedCache,
	wouldCreateCycle,
} from "./dependencies.js";
// Event types
export type {
	BaseCellEvent,
	CellAssignedEvent,
	CellClosedEvent,
	CellCommentAddedEvent,
	CellCommentDeletedEvent,
	CellCommentUpdatedEvent,
	CellCompactedEvent,
	CellCreatedEvent,
	CellDeletedEvent,
	CellDependencyAddedEvent,
	CellDependencyRemovedEvent,
	CellEpicChildAddedEvent,
	CellEpicChildRemovedEvent,
	CellEpicClosureEligibleEvent,
	CellEvent,
	CellLabelAddedEvent,
	CellLabelRemovedEvent,
	CellReopenedEvent,
	CellStatusChangedEvent,
	CellUpdatedEvent,
	CellWorkStartedEvent,
} from "./events.js";
// FlushManager for auto-sync
export {
	FlushManager,
	type FlushManagerOptions,
	type FlushResult,
} from "./flush-manager.js";
// JSONL export/import
export {
	type CellExport,
	computeContentHash,
	type ExportOptions,
	exportDirtyBeads,
	exportToJSONL,
	type ImportOptions,
	type ImportResult,
	importFromJSONL,
	parseJSONL,
	serializeToJSONL,
} from "./jsonl.js";

// Label operations
export {
	getAllLabels,
	getCellsByLabel,
} from "./labels.js";
// 3-Way Merge Driver
export {
	CLOCK_SKEW_GRACE_MS,
	DEFAULT_TOMBSTONE_TTL_MS,
	type IssueKey,
	isExpiredTombstone,
	isTombstone,
	type MergeOptions,
	type MergeResult,
	MIN_TOMBSTONE_TTL_MS,
	merge3Way,
	mergeJsonl,
	STATUS_TOMBSTONE,
} from "./merge.js";
// Migrations
export {
	beadsMigration,
	beadsMigrations,
	cellsViewMigration,
	hiveMigrations,
} from "./migrations.js";
// Projections
export {
	clearAllDirtyBeads,
	clearDirtyBead,
	getBlockedCells,
	getBlockers,
	getCell,
	getComments,
	getDependencies,
	getDependents,
	getDirtyCells,
	getInProgressCells,
	getLabels,
	getNextReadyCell,
	isBlocked,
	markBeadDirty,
	queryCells,
	updateProjections,
} from "./projections.js";
// Query utilities
export {
	type BlockedCell,
	type EpicStatus,
	findCellsByPartialId,
	getBlockedIssues,
	getEpicsEligibleForClosure,
	getReadyWork,
	getStaleIssues,
	getStatistics,
	type ReadyWorkOptions,
	resolvePartialId,
	type SortPolicy,
	type StaleOptions,
	type Statistics,
} from "./queries.js";
// Store operations
export {
	appendCellEvent,
	type ReadCellEventsOptions,
	readCellEvents,
	replayCellEvents,
} from "./store.js";
