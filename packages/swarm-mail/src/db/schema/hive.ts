/**
 * Drizzle Schema for Hive (Work Item Tracking)
 *
 * Translates the PGlite cells schema to libSQL/SQLite via Drizzle ORM.
 *
 * ## Tables
 * - cells: Core work items (formerly cells)
 * - cellEvents: Event sourcing for cells
 * - cellLabels: Tags/labels on cells
 * - cellComments: Comments on cells
 * - cellDependencies: Blocking relationships
 * - schemaVersion: Migration tracking
 *
 * ## Design Notes
 * - Uses TEXT for timestamps (ISO 8601 strings, SQLite standard)
 * - Uses TEXT for IDs (nanoid-based)
 * - Self-referential FK: cells.parent_id → cells.id
 * - Indexes on common query patterns (status, parent_id)
 *
 * @module db/schema/hive
 */

import {
	index,
	integer,
	sqliteTable,
	text,
	unique,
} from "drizzle-orm/sqlite-core";

/**
 * Core cells table (with cells view alias)
 *
 * Stores the main work item data including status, priority, and epic hierarchy.
 * Self-referential foreign key enables epic → subtask relationships.
 *
 * Note: The `cells` view is an alias created by migration v8 for compatibility.
 * This schema defines the underlying `cells` table.
 */
export const cells = sqliteTable(
	"cells",
	{
		id: text("id").primaryKey(),
		project_key: text("project_key").notNull(),
		type: text("type").notNull(),
		status: text("status").notNull().default("open"),
		title: text("title").notNull(),
		description: text("description"),
		priority: integer("priority").notNull().default(2),
		// biome-ignore lint/suspicious/noExplicitAny: Self-referential FK requires `any` in Drizzle
		parent_id: text("parent_id").references((): any => cells.id),
		assignee: text("assignee"),
		created_at: integer("created_at").notNull(), // BIGINT (Unix ms)
		updated_at: integer("updated_at").notNull(), // BIGINT (Unix ms)
		closed_at: integer("closed_at"), // BIGINT (Unix ms)
		closed_reason: text("closed_reason"),
		deleted_at: integer("deleted_at"), // BIGINT (Unix ms)
		deleted_by: text("deleted_by"),
		delete_reason: text("delete_reason"),
		created_by: text("created_by"),
	},
	(table) => ({
		projectIdx: index("idx_cells_project").on(table.project_key),
		statusIdx: index("idx_cells_status").on(table.status),
		typeIdx: index("idx_cells_type").on(table.type),
		priorityIdx: index("idx_cells_priority").on(table.priority),
		assigneeIdx: index("idx_cells_assignee").on(table.assignee),
		parentIdx: index("idx_cells_parent").on(table.parent_id),
		createdIdx: index("idx_cells_created").on(table.created_at),
		projectStatusIdx: index("idx_cells_project_status").on(
			table.project_key,
			table.status,
		),
	}),
);

/**
 * cell events table - event sourcing for cells
 *
 * Stores immutable event log for cell state changes.
 * Enables event replay and audit trails.
 */
export const cellEvents = sqliteTable(
	"cell_events",
	{
		id: integer("id").primaryKey({ autoIncrement: true }),
		cell_id: text("cell_id")
			.notNull()
			.references(() => cells.id),
		event_type: text("event_type").notNull(),
		payload: text("payload").notNull(), // JSON string
		created_at: text("created_at"),
	},
	(table) => ({
		cellIdIdx: index("idx_cell_events_cell_id").on(table.cell_id),
	}),
);

/**
 * cell labels table - tags/labels on cells
 *
 * Many-to-many relationship between cells and string labels.
 * Primary key on (cell_id, label) prevents duplicates.
 */
export const cellLabels = sqliteTable(
	"cell_labels",
	{
		cell_id: text("cell_id")
			.notNull()
			.references(() => cells.id),
		label: text("label").notNull(),
		created_at: integer("created_at").notNull(), // BIGINT (Unix ms)
	},
	(table) => ({
		pk: unique().on(table.cell_id, table.label),
		labelIdx: index("idx_cell_labels_label").on(table.label),
	}),
);

/**
 * cell comments table - comments on cells
 *
 * Stores user comments/notes on work items.
 * Supports threaded comments via parent_id.
 */
export const cellComments = sqliteTable(
	"cell_comments",
	{
		id: integer("id").primaryKey({ autoIncrement: true }),
		cell_id: text("cell_id")
			.notNull()
			.references(() => cells.id),
		author: text("author").notNull(),
		body: text("body").notNull(),
		// biome-ignore lint/suspicious/noExplicitAny: Self-referential FK requires `any` in Drizzle
		parent_id: integer("parent_id").references((): any => cellComments.id),
		created_at: integer("created_at").notNull(), // BIGINT (Unix ms)
		updated_at: integer("updated_at"), // BIGINT (Unix ms)
	},
	(table) => ({
		cellIdx: index("idx_cell_comments_cell").on(table.cell_id),
		authorIdx: index("idx_cell_comments_author").on(table.author),
		createdIdx: index("idx_cell_comments_created").on(table.created_at),
	}),
);

/**
 * cell dependencies table - blocking relationships
 *
 * Tracks which cells block other cells.
 * cellId: the blocked cell
 * dependsOnId: the blocking cell
 * relationship: type of dependency (blocks, related, etc.)
 *
 * Primary key on (cell_id, depends_on_id, relationship) prevents duplicates.
 */
export const cellDependencies = sqliteTable(
	"cell_dependencies",
	{
		cell_id: text("cell_id")
			.notNull()
			.references(() => cells.id),
		depends_on_id: text("depends_on_id")
			.notNull()
			.references(() => cells.id),
		relationship: text("relationship").notNull(),
		created_at: integer("created_at").notNull(), // BIGINT (Unix ms)
		created_by: text("created_by"),
	},
	(table) => ({
		pk: unique().on(table.cell_id, table.depends_on_id, table.relationship),
		cellIdx: index("idx_cell_deps_cell").on(table.cell_id),
		dependsOnIdx: index("idx_cell_deps_depends_on").on(table.depends_on_id),
		relationshipIdx: index("idx_cell_deps_relationship").on(table.relationship),
	}),
);

/**
 * Blocked cells cache - materialized view for fast blocked queries
 *
 * Caches which cells are blocked and what blocks them.
 * Updated by projections when dependencies change.
 */
export const blockedcellsCache = sqliteTable(
	"blocked_cells_cache",
	{
		cell_id: text("cell_id")
			.primaryKey()
			.references(() => cells.id),
		// SQLite doesn't have array types - need to store as JSON
		blocker_ids: text("blocker_ids").notNull(), // JSON array of cell IDs
		updated_at: integer("updated_at").notNull(), // BIGINT (Unix ms)
	},
	(table) => ({
		updatedIdx: index("idx_blocked_cells_updated").on(table.updated_at),
	}),
);

/**
 * Dirty cells table - tracks cells needing JSONL export
 *
 * Marks cells that have changed and need to be exported to .hive/issues.jsonl.
 * Cleared after successful export.
 */
export const dirtycells = sqliteTable(
	"dirty_cells",
	{
		cell_id: text("cell_id")
			.primaryKey()
			.references(() => cells.id),
		marked_at: integer("marked_at").notNull(), // BIGINT (Unix ms)
	},
	(table) => ({
		markedIdx: index("idx_dirty_cells_marked").on(table.marked_at),
	}),
);

/**
 * Schema version table - migration tracking
 *
 * Tracks which migrations have been applied.
 * Used by migration system to determine which migrations to run.
 */
export const schemaVersion = sqliteTable("schema_version", {
	version: integer("version").primaryKey(),
	applied_at: text("applied_at"),
});

/**
 * Type exports for type-safe inserts/selects
 */
export type cell = typeof cells.$inferSelect;
export type Newcell = typeof cells.$inferInsert;
export type Cell = typeof cells.$inferSelect; // Alias for backward compatibility
export type NewCell = typeof cells.$inferInsert; // Alias for backward compatibility
export type CellEvent = typeof cellEvents.$inferSelect;
export type NewCellEvent = typeof cellEvents.$inferInsert;
export type cellLabel = typeof cellLabels.$inferSelect;
export type NewcellLabel = typeof cellLabels.$inferInsert;
export type CellLabel = typeof cellLabels.$inferSelect; // Alias
export type NewCellLabel = typeof cellLabels.$inferInsert; // Alias
export type cellComment = typeof cellComments.$inferSelect;
export type NewcellComment = typeof cellComments.$inferInsert;
export type CellComment = typeof cellComments.$inferSelect; // Alias
export type NewCellComment = typeof cellComments.$inferInsert; // Alias
export type cellDependency = typeof cellDependencies.$inferSelect;
export type NewcellDependency = typeof cellDependencies.$inferInsert;
export type CellDependency = typeof cellDependencies.$inferSelect; // Alias
export type NewCellDependency = typeof cellDependencies.$inferInsert; // Alias
export type BlockedcellCache = typeof blockedcellsCache.$inferSelect;
export type NewBlockedcellCache = typeof blockedcellsCache.$inferInsert;
export type Dirtycell = typeof dirtycells.$inferSelect;
export type NewDirtycell = typeof dirtycells.$inferInsert;
