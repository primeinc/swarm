/**
 * cells Schema Migration (v7-v8)
 *
 * Adds cells-specific tables to the shared libSQL database.
 * This migration extends the existing swarm-mail schema.
 *
 * ## Migration Strategy
 * - Migration v7 adds cells tables to existing swarm-mail schema (v0-v6)
 * - Migration v8 adds cells view for cells→hive rename compatibility
 * - Shares same libSQL database instance and migration system
 * - Uses same schema_version table for tracking
 *
 * ## Tables Created
 * - cells: Core cell records (parallel to steveyegge/cells issues table)
 * - cell_dependencies: Dependency relationships between cells
 * - cell_labels: String tags for categorization
 * - cell_comments: Comments/notes on cells
 * - blocked_cells_cache: Materialized view for fast blocked queries
 * - dirty_cells: Tracks cells that need JSONL export
 *
 * ## Design Notes
 * - Uses BIGINT for timestamps (Unix ms, like swarm-mail events)
 * - Uses TEXT for IDs (like steveyegge/cells)
 * - CASCADE deletes for referential integrity
 * - Indexes for common query patterns
 * - CHECK constraints for data integrity
 *
 * @module hive/migrations
 */

import type { Migration } from "../streams/migrations.js";

/**
 * Migration v6: Add cells tables
 *
 * This migration is designed to be appended to the existing migrations array
 * in src/streams/migrations.ts.
 */
export const cellsMigration: Migration = {
	version: 7,
	description: "Add cells tables for issue tracking",
	up: `
    -- ========================================================================
    -- Core cells Table
    -- ========================================================================
    CREATE TABLE IF NOT EXISTS cells (
      id TEXT PRIMARY KEY,
      project_key TEXT NOT NULL,
      type TEXT NOT NULL CHECK (type IN ('bug', 'feature', 'task', 'epic', 'chore', 'message')),
      status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'blocked', 'closed', 'tombstone')),
      title TEXT NOT NULL CHECK (length(title) <= 500),
      description TEXT,
      priority INTEGER NOT NULL DEFAULT 2 CHECK (priority BETWEEN 0 AND 3),
      parent_id TEXT REFERENCES cells(id) ON DELETE SET NULL,
      assignee TEXT,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL,
      closed_at BIGINT,
      closed_reason TEXT,
      deleted_at BIGINT,
      deleted_by TEXT,
      delete_reason TEXT,
      created_by TEXT,
      CHECK ((status = 'closed') = (closed_at IS NOT NULL))
    );

    -- Indexes for common queries
    CREATE INDEX IF NOT EXISTS idx_cells_project ON cells(project_key);
    CREATE INDEX IF NOT EXISTS idx_cells_status ON cells(status);
    CREATE INDEX IF NOT EXISTS idx_cells_type ON cells(type);
    CREATE INDEX IF NOT EXISTS idx_cells_priority ON cells(priority);
    CREATE INDEX IF NOT EXISTS idx_cells_assignee ON cells(assignee);
    CREATE INDEX IF NOT EXISTS idx_cells_parent ON cells(parent_id);
    CREATE INDEX IF NOT EXISTS idx_cells_created ON cells(created_at);
    CREATE INDEX IF NOT EXISTS idx_cells_project_status ON cells(project_key, status);

    -- ========================================================================
    -- Dependencies Table
    -- ========================================================================
    CREATE TABLE IF NOT EXISTS cell_dependencies (
      cell_id TEXT NOT NULL REFERENCES cells(id) ON DELETE CASCADE,
      depends_on_id TEXT NOT NULL REFERENCES cells(id) ON DELETE CASCADE,
      relationship TEXT NOT NULL CHECK (relationship IN ('blocks', 'related', 'parent-child', 'discovered-from', 'replies-to', 'relates-to', 'duplicates', 'supersedes')),
      created_at BIGINT NOT NULL,
      created_by TEXT,
      PRIMARY KEY (cell_id, depends_on_id, relationship)
    );

    CREATE INDEX IF NOT EXISTS idx_cell_deps_cell ON cell_dependencies(cell_id);
    CREATE INDEX IF NOT EXISTS idx_cell_deps_depends_on ON cell_dependencies(depends_on_id);
    CREATE INDEX IF NOT EXISTS idx_cell_deps_relationship ON cell_dependencies(relationship);

    -- ========================================================================
    -- Labels Table
    -- ========================================================================
    CREATE TABLE IF NOT EXISTS cell_labels (
      cell_id TEXT NOT NULL REFERENCES cells(id) ON DELETE CASCADE,
      label TEXT NOT NULL,
      created_at BIGINT NOT NULL,
      PRIMARY KEY (cell_id, label)
    );

    CREATE INDEX IF NOT EXISTS idx_cell_labels_label ON cell_labels(label);

    -- ========================================================================
    -- Comments Table
    -- ========================================================================
    CREATE TABLE IF NOT EXISTS cell_comments (
      id SERIAL PRIMARY KEY,
      cell_id TEXT NOT NULL REFERENCES cells(id) ON DELETE CASCADE,
      author TEXT NOT NULL,
      body TEXT NOT NULL,
      parent_id INTEGER REFERENCES cell_comments(id) ON DELETE CASCADE,
      created_at BIGINT NOT NULL,
      updated_at BIGINT
    );

    CREATE INDEX IF NOT EXISTS idx_cell_comments_cell ON cell_comments(cell_id);
    CREATE INDEX IF NOT EXISTS idx_cell_comments_author ON cell_comments(author);
    CREATE INDEX IF NOT EXISTS idx_cell_comments_created ON cell_comments(created_at);

    -- ========================================================================
    -- Blocked Cells Cache
    -- ========================================================================
    -- Materialized view for fast blocked queries
    -- Updated by projections when dependencies change
    CREATE TABLE IF NOT EXISTS blocked_cells_cache (
      cell_id TEXT PRIMARY KEY REFERENCES cells(id) ON DELETE CASCADE,
      blocker_ids TEXT[] NOT NULL,
      updated_at BIGINT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_blocked_cells_updated ON blocked_cells_cache(updated_at);

    -- ========================================================================
    -- Dirty Cells Table
    -- ========================================================================
    -- Tracks cells that need JSONL export (incremental sync)
    CREATE TABLE IF NOT EXISTS dirty_cells (
      cell_id TEXT PRIMARY KEY REFERENCES cells(id) ON DELETE CASCADE,
      marked_at BIGINT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_dirty_cells_marked ON dirty_cells(marked_at);
  `,
	down: `
    -- Drop in reverse order to handle foreign key constraints
    DROP TABLE IF EXISTS dirty_cells;
    DROP TABLE IF EXISTS blocked_cells_cache;
    DROP TABLE IF EXISTS cell_comments;
    DROP TABLE IF EXISTS cell_labels;
    DROP TABLE IF EXISTS cell_dependencies;
    DROP TABLE IF EXISTS cells;
  `,
};

/**
 * Migration v7: Add cells view for cells→hive rename compatibility
 *
 * Creates a view called `cells` that points to the `cells` table.
 * This allows code that references `cells` to work with existing `cells` data.
 *
 * The view is updatable via INSTEAD OF triggers for INSERT/UPDATE/DELETE.
 */
export const cellsViewMigration: Migration = {
	version: 8,
	description: "Add cells view for cells→hive rename compatibility",
	up: `
    -- ========================================================================
    -- Hive View (alias for cells table)
    -- ========================================================================
    -- This view allows code to reference "hive" while data lives in "cells"
    CREATE OR REPLACE VIEW hive AS SELECT * FROM cells;

    -- INSTEAD OF INSERT trigger
    CREATE OR REPLACE FUNCTION hive_insert_trigger()
    RETURNS TRIGGER AS $$
    BEGIN
      INSERT INTO cells VALUES (NEW.*);
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    DROP TRIGGER IF EXISTS hive_insert ON cells;
    CREATE TRIGGER hive_insert
      INSTEAD OF INSERT ON hive
      FOR EACH ROW
      EXECUTE FUNCTION hive_insert_trigger();

    -- INSTEAD OF UPDATE trigger
    CREATE OR REPLACE FUNCTION hive_update_trigger()
    RETURNS TRIGGER AS $$
    BEGIN
      UPDATE cells SET
        project_key = NEW.project_key,
        type = NEW.type,
        status = NEW.status,
        title = NEW.title,
        description = NEW.description,
        priority = NEW.priority,
        parent_id = NEW.parent_id,
        assignee = NEW.assignee,
        created_at = NEW.created_at,
        updated_at = NEW.updated_at,
        closed_at = NEW.closed_at,
        closed_reason = NEW.closed_reason,
        deleted_at = NEW.deleted_at,
        deleted_by = NEW.deleted_by,
        delete_reason = NEW.delete_reason,
        created_by = NEW.created_by
      WHERE id = OLD.id;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    DROP TRIGGER IF EXISTS hive_update ON cells;
    CREATE TRIGGER hive_update
      INSTEAD OF UPDATE ON hive
      FOR EACH ROW
      EXECUTE FUNCTION hive_update_trigger();

    -- INSTEAD OF DELETE trigger
    CREATE OR REPLACE FUNCTION hive_delete_trigger()
    RETURNS TRIGGER AS $$
    BEGIN
      DELETE FROM cells WHERE id = OLD.id;
      RETURN OLD;
    END;
    $$ LANGUAGE plpgsql;

    DROP TRIGGER IF EXISTS hive_delete ON cells;
    CREATE TRIGGER hive_delete
      INSTEAD OF DELETE ON hive
      FOR EACH ROW
      EXECUTE FUNCTION hive_delete_trigger();
  `,
	down: `
    DROP TRIGGER IF EXISTS cells_delete ON cells;
    DROP TRIGGER IF EXISTS cells_update ON cells;
    DROP TRIGGER IF EXISTS cells_insert ON cells;
    DROP FUNCTION IF EXISTS cells_delete_trigger();
    DROP FUNCTION IF EXISTS cells_update_trigger();
    DROP FUNCTION IF EXISTS cells_insert_trigger();
    DROP VIEW IF EXISTS cells;
  `,
};

/**
 * LibSQL-compatible cells view migration (v8)
 *
 * SQLite doesn't support CREATE OR REPLACE or stored procedures.
 * Use DROP IF EXISTS + CREATE and inline INSTEAD OF triggers.
 */
export const cellsViewMigrationLibSQL: Migration = {
	version: 8,
	description: "Add cells view for cells→hive rename compatibility (LibSQL)",
	up: `
    -- ========================================================================
    -- Hive View (alias for cells table) - LibSQL version
    -- ========================================================================
    DROP VIEW IF EXISTS hive;
    CREATE VIEW hive AS SELECT * FROM cells;

    -- INSTEAD OF INSERT trigger (inline, no stored procedure)
    DROP TRIGGER IF EXISTS hive_insert;
    CREATE TRIGGER hive_insert
      INSTEAD OF INSERT ON hive
      FOR EACH ROW
    BEGIN
      INSERT INTO cells VALUES (
        NEW.id, NEW.project_key, NEW.type, NEW.status, NEW.title,
        NEW.description, NEW.priority, NEW.parent_id, NEW.assignee,
        NEW.created_at, NEW.updated_at, NEW.closed_at, NEW.closed_reason,
        NEW.deleted_at, NEW.deleted_by, NEW.delete_reason, NEW.created_by
      );
    END;

    -- INSTEAD OF UPDATE trigger
    DROP TRIGGER IF EXISTS hive_update;
    CREATE TRIGGER hive_update
      INSTEAD OF UPDATE ON hive
      FOR EACH ROW
    BEGIN
      UPDATE cells SET
        project_key = NEW.project_key,
        type = NEW.type,
        status = NEW.status,
        title = NEW.title,
        description = NEW.description,
        priority = NEW.priority,
        parent_id = NEW.parent_id,
        assignee = NEW.assignee,
        created_at = NEW.created_at,
        updated_at = NEW.updated_at,
        closed_at = NEW.closed_at,
        closed_reason = NEW.closed_reason,
        deleted_at = NEW.deleted_at,
        deleted_by = NEW.deleted_by,
        delete_reason = NEW.delete_reason,
        created_by = NEW.created_by
      WHERE id = OLD.id;
    END;

    -- INSTEAD OF DELETE trigger
    DROP TRIGGER IF EXISTS hive_delete;
    CREATE TRIGGER hive_delete
      INSTEAD OF DELETE ON hive
      FOR EACH ROW
    BEGIN
      DELETE FROM cells WHERE id = OLD.id;
    END;

    -- INSTEAD OF UPDATE trigger
    DROP TRIGGER IF EXISTS hive_update;
    CREATE TRIGGER hive_update
      INSTEAD OF UPDATE ON hive
      FOR EACH ROW
    BEGIN
      UPDATE cells SET
        project_key = NEW.project_key,
        type = NEW.type,
        status = NEW.status,
        title = NEW.title,
        description = NEW.description,
        priority = NEW.priority,
        parent_id = NEW.parent_id,
        assignee = NEW.assignee,
        created_at = NEW.created_at,
        updated_at = NEW.updated_at,
        closed_at = NEW.closed_at,
        closed_reason = NEW.closed_reason,
        deleted_at = NEW.deleted_at,
        deleted_by = NEW.deleted_by,
        delete_reason = NEW.delete_reason,
        created_by = NEW.created_by
      WHERE id = OLD.id;
    END;

    -- INSTEAD OF DELETE trigger
    DROP TRIGGER IF EXISTS hive_delete;
    CREATE TRIGGER hive_delete
      INSTEAD OF DELETE ON hive
      FOR EACH ROW
    BEGIN
      DELETE FROM cells WHERE id = OLD.id;
    END;
  `,
	down: `
    DROP TRIGGER IF EXISTS cells_delete;
    DROP TRIGGER IF EXISTS cells_update;
    DROP TRIGGER IF EXISTS cells_insert;
    DROP VIEW IF EXISTS cells;
  `,
};

/**
 * LibSQL-compatible cells migration (v7)
 *
 * Differences from PGLite version:
 * - Uses INTEGER PRIMARY KEY AUTOINCREMENT instead of SERIAL
 * - Uses TEXT (JSON string) instead of TEXT[] for arrays
 * - Uses INTEGER instead of BIGINT (SQLite treats both as INTEGER anyway)
 */
export const cellsMigrationLibSQL: Migration = {
	version: 7,
	description: "Add cells tables for issue tracking (LibSQL)",
	up: `
    -- ========================================================================
    -- Core cells Table
    -- ========================================================================
    CREATE TABLE IF NOT EXISTS cells (
      id TEXT PRIMARY KEY,
      project_key TEXT NOT NULL,
      type TEXT NOT NULL CHECK (type IN ('bug', 'feature', 'task', 'epic', 'chore', 'message')),
      status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'blocked', 'closed', 'tombstone')),
      title TEXT NOT NULL CHECK (length(title) <= 500),
      description TEXT,
      priority INTEGER NOT NULL DEFAULT 2 CHECK (priority BETWEEN 0 AND 3),
      parent_id TEXT REFERENCES cells(id) ON DELETE SET NULL,
      assignee TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      closed_at INTEGER,
      closed_reason TEXT,
      deleted_at INTEGER,
      deleted_by TEXT,
      delete_reason TEXT,
      created_by TEXT,
      CHECK ((status = 'closed') = (closed_at IS NOT NULL))
    );

    -- Indexes for common queries
    CREATE INDEX IF NOT EXISTS idx_cells_project ON cells(project_key);
    CREATE INDEX IF NOT EXISTS idx_cells_status ON cells(status);
    CREATE INDEX IF NOT EXISTS idx_cells_type ON cells(type);
    CREATE INDEX IF NOT EXISTS idx_cells_priority ON cells(priority);
    CREATE INDEX IF NOT EXISTS idx_cells_assignee ON cells(assignee);
    CREATE INDEX IF NOT EXISTS idx_cells_parent ON cells(parent_id);
    CREATE INDEX IF NOT EXISTS idx_cells_created ON cells(created_at);
    CREATE INDEX IF NOT EXISTS idx_cells_project_status ON cells(project_key, status);

    -- ========================================================================
    -- Dependencies Table
    -- ========================================================================
    CREATE TABLE IF NOT EXISTS cell_dependencies (
      cell_id TEXT NOT NULL REFERENCES cells(id) ON DELETE CASCADE,
      depends_on_id TEXT NOT NULL REFERENCES cells(id) ON DELETE CASCADE,
      relationship TEXT NOT NULL CHECK (relationship IN ('blocks', 'related', 'parent-child', 'discovered-from', 'replies-to', 'relates-to', 'duplicates', 'supersedes')),
      created_at INTEGER NOT NULL,
      created_by TEXT,
      PRIMARY KEY (cell_id, depends_on_id, relationship)
    );

    CREATE INDEX IF NOT EXISTS idx_cell_deps_cell ON cell_dependencies(cell_id);
    CREATE INDEX IF NOT EXISTS idx_cell_deps_depends_on ON cell_dependencies(depends_on_id);
    CREATE INDEX IF NOT EXISTS idx_cell_deps_relationship ON cell_dependencies(relationship);

    -- ========================================================================
    -- Labels Table
    -- ========================================================================
    CREATE TABLE IF NOT EXISTS cell_labels (
      cell_id TEXT NOT NULL REFERENCES cells(id) ON DELETE CASCADE,
      label TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (cell_id, label)
    );

    CREATE INDEX IF NOT EXISTS idx_cell_labels_label ON cell_labels(label);

    -- ========================================================================
    -- Comments Table
    -- ========================================================================
    CREATE TABLE IF NOT EXISTS cell_comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cell_id TEXT NOT NULL REFERENCES cells(id) ON DELETE CASCADE,
      author TEXT NOT NULL,
      body TEXT NOT NULL,
      parent_id INTEGER REFERENCES cell_comments(id) ON DELETE CASCADE,
      created_at INTEGER NOT NULL,
      updated_at INTEGER
    );

    CREATE INDEX IF NOT EXISTS idx_cell_comments_cell ON cell_comments(cell_id);
    CREATE INDEX IF NOT EXISTS idx_cell_comments_author ON cell_comments(author);
    CREATE INDEX IF NOT EXISTS idx_cell_comments_created ON cell_comments(created_at);

    -- ========================================================================
    -- Blocked Cells Cache
    -- ========================================================================
    -- Materialized view for fast blocked queries
    -- Updated by projections when dependencies change
    -- Note: SQLite doesn't support arrays, so blocker_ids is a JSON string
    CREATE TABLE IF NOT EXISTS blocked_cells_cache (
      cell_id TEXT PRIMARY KEY REFERENCES cells(id) ON DELETE CASCADE,
      blocker_ids TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_blocked_cells_updated ON blocked_cells_cache(updated_at);

    -- ========================================================================
    -- Dirty Cells Table
    -- ========================================================================
    -- Tracks cells that need JSONL export (incremental sync)
    CREATE TABLE IF NOT EXISTS dirty_cells (
      cell_id TEXT PRIMARY KEY REFERENCES cells(id) ON DELETE CASCADE,
      marked_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_dirty_cells_marked ON dirty_cells(marked_at);
  `,
	down: `
    -- Drop in reverse order to handle foreign key constraints
    DROP TABLE IF EXISTS dirty_cells;
    DROP TABLE IF EXISTS blocked_cells_cache;
    DROP TABLE IF EXISTS cell_comments;
    DROP TABLE IF EXISTS cell_labels;
    DROP TABLE IF EXISTS cell_dependencies;
    DROP TABLE IF EXISTS cells;
  `,
};

/**
 * Export individual migrations
 */
export const cellsMigrations: Migration[] = [cellsMigration];

/**
 * All hive migrations in order (PGLite version)
 */
export const hiveMigrations: Migration[] = [cellsMigration, cellsViewMigration];

/**
 * Migration v9: Add sessions table for handoff notes
 *
 * Inspired by Chainlink's session management pattern.
 * Credit: @dollspace-gay (https://github.com/dollspace-gay/chainlink)
 *
 * Enables context preservation across sessions via handoff notes.
 * When a session ends, agents can save notes for the next session.
 * When a new session starts, it shows the previous handoff notes.
 */
export const sessionsMigrationLibSQL: Migration = {
	version: 9,
	description: "Add sessions table for handoff notes (Chainlink pattern)",
	up: `
    -- ========================================================================
    -- Sessions Table
    -- ========================================================================
    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_key TEXT NOT NULL,
      started_at INTEGER NOT NULL,
      ended_at INTEGER,
      active_cell_id TEXT REFERENCES cells(id) ON DELETE SET NULL,
      handoff_notes TEXT,
      created_by TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project_key);
    CREATE INDEX IF NOT EXISTS idx_sessions_started ON sessions(started_at);
    CREATE INDEX IF NOT EXISTS idx_sessions_active_cell ON sessions(active_cell_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_project_ended ON sessions(project_key, ended_at);
  `,
	down: `
    DROP TABLE IF EXISTS sessions;
  `,
};

/**
 * All hive migrations in order (LibSQL version)
 */
export const hiveMigrationsLibSQL: Migration[] = [
	cellsMigrationLibSQL,
	cellsViewMigrationLibSQL,
	sessionsMigrationLibSQL,
];
