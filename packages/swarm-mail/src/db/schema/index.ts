/**
 * Barrel export for all Drizzle schemas.
 *
 * This will re-export:
 * - memory/* - semantic memory tables (memories, embeddings)
 * - streams/* - event sourcing tables (events, projections, cursors)
 * - hive/* - work item tracking tables (cells, dependencies)
 */

// Hive subsystem (work item tracking)
export {
	type BlockedCellCache,
	blockedCellsCache,
	type Cell,
	type CellComment,
	type CellDependency,
	type CellEvent,
	type CellLabel,
	cellComments,
	cellDependencies,
	cellEvents,
	cells,
	type DirtyCell,
	dirtyCells,
	type NewBlockedCellCache,
	type NewCell,
	type NewCellComment,
	type NewCellDependency,
	type NewCellEvent,
	type NewCellLabel,
	type NewDirtyCell,
	schemaVersion,
} from "./hive.js";
// Memory subsystem
export { type Memory, memories, type NewMemory } from "./memory.js";
// Streams subsystem
export {
	agentsTable,
	cursorsTable,
	eventsTable,
	locksTable,
	messagesTable,
	reservationsTable,
} from "./streams.js";
