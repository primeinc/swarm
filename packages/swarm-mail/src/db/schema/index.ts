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
	type BlockedcellCache,
	blockedcellsCache,
	type Cell,
	type CellComment,
	type CellDependency,
	type CellEvent,
	type CellLabel,
	type cell,
	type cellComment,
	cellComments,
	cellDependencies,
	type cellDependency,
	cellEvents,
	type cellLabel,
	cellLabels,
	cells,
	type Dirtycell,
	dirtycells,
	type NewBlockedcellCache,
	type NewCell,
	type NewCellComment,
	type NewCellDependency,
	type NewCellEvent,
	type NewCellLabel,
	type Newcell,
	type NewcellComment,
	type NewcellDependency,
	type NewcellLabel,
	type NewDirtycell,
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
