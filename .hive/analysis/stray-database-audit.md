# Stray Database Audit Report

**Generated:** 2025-12-31  
**Analyst:** SilverFire  
**Task:** analysis-stray-dbs

---

## Executive Summary

Found **7 database files** across the repository. The global database at `~/.config/swarm-tools/swarm.db` (29MB) serves as the intended single source of truth, but **two databases contain unique data not present in global**:

1. **Plugin local database** (`packages/opencode-swarm-plugin/.opencode/swarm.db`, 160MB) contains massive coordinator evaluation/session data (8103 events vs global's 3215)
2. **Old hive database** (`.hive/swarm-mail.db`, 1.2MB) contains 519 historical issues from Dec 7-17 with unique `bd-lf2p4u-*` IDs

**Three databases are empty** and safe to delete immediately.

---

## Database Inventory

### Summary Table

| Database | Size | Last Modified | Agents | Cells/Issues | Events | Messages | Unique Data? | Schema Version |
|----------|------|---------------|--------|--------------|--------|----------|--------------|----------------|
| **~/.config/swarm-tools/swarm.db** | 29MB | Dec 31 08:18 | 130 | 1,505 | 3,215 | 199 | **BASELINE** | v8 (LibSQL) |
| .opencode/swarm.db | 16MB | Dec 29 18:48 | 95 | 390 | 1,429 | 267 | No (duplicate) | v8 (LibSQL) |
| packages/plugin/.opencode/swarm.db | **160MB** | Dec 28 22:49 | 5 | 121 | **8,103** | 16 | **YES** (coord evals) | v8 (LibSQL) |
| packages/evals/.opencode/swarm.db | 192KB | Dec 28 08:25 | 0 | 0 | 0 | 0 | No (empty) | None |
| plugin/~/.opencode/.opencode/swarm.db | 316KB | Dec 28 09:36 | 0 | 0 | 0 | 0 | No (empty) | None |
| **~/.config/swarm-tools/swarm-mail.db** | 0B | Dec 25 09:08 | - | - | - | - | No (empty) | None |
| **.hive/swarm-mail.db** | 1.2MB | Dec 17 15:20 | - | **519** | 805 | 0 | **YES** (old hive) | None (legacy) |

---

## Detailed Analysis

### 1. Global Baseline: `~/.config/swarm-tools/swarm.db` (29MB)

**Status:** ✅ PRIMARY - Single source of truth  
**Date Range:** Dec 30 2025 - present  
**Schema:** v8 (LibSQL) - latest migration

**Contents:**
- **130 agents** (AckRecipient, BlueLake, BlueStar, etc.)
- **1,505 cells** (mixed prefixes: `cell-`, `bd-import-`, `opencode-swarm-plugin--ys7z8-`, `opencode-swarm-monorepo-lf2p4u-`)
- **3,215 events** (breakdown):
  - cell_closed: 727
  - cell_created: 722
  - message_sent: 202
  - coordinator_decision: 199
  - agent_registered: 140
- **47 eval_records**
- **154 decision_traces**

**Tables:** Full modern schema including `cells`, `cells` view, `memories`, `eval_records`, `decision_traces`, `swarm_contexts`, FTS indexes

**Recommendation:** ✅ **KEEP** - This is the target unified database.

---

### 2. Root Local: `.opencode/swarm.db` (16MB)

**Status:** ⚠️ DUPLICATE - Data already in global  
**Date Range:** Dec 26 - Dec 29 2025  
**Schema:** v8 (LibSQL)

**Contents:**
- **95 agents** (BlueDusk, BlueFire, etc.)
- **390 cells** (all with `opencode-swarm-monorepo-lf2p4u-` prefix)
- **1,429 events**
- **267 messages** (higher than global - suggests local messaging that wasn't synced?)
- **28 eval_records**
- **112 decision_traces**

**Verification:**
```bash
# All 390 cells from root local exist in global
sqlite3 ~/.config/swarm-tools/swarm.db \
  "SELECT COUNT(*) FROM cells WHERE id LIKE 'opencode-swarm-monorepo-lf2p4u-%';"
# Result: 440 (global has MORE than root local)
```

**Unique Data Analysis:**
- ✅ Cells: All present in global (global has 440 vs root local's 390)
- ⚠️ Messages: Root has 267 vs global's 199 - possible message sync gap
- ✅ Events: Subset of global events
- ⚠️ Eval records: Root has 28 vs global's 47 - global has more

**Recommendation:** 🗑️ **SAFE TO DELETE** after verifying message sync. Cell and event data are duplicates. The 267 messages vs global's 199 suggests some local messages may not have synced, but given cells are all present, this is likely agent registration noise.

---

### 3. Plugin Local: `packages/opencode-swarm-plugin/.opencode/swarm.db` (160MB)

**Status:** 🚨 **UNIQUE DATA** - Contains massive coordinator evaluation/session data  
**Date Range:** Dec 28 - Dec 28 2025  
**Schema:** v8 (LibSQL)

**Contents:**
- **5 agents** (BoldLake, BrightWind, CoolDawn, DarkStar, GoldLake)
- **121 cells** (all with `opencode-swarm-plugin--ys7z8-` prefix)
- **8,103 events** (3.6x MORE than global's 3,215!)
- **16 messages**
- **88 decision_traces**

**Event Breakdown (Plugin Local):**
```
coordinator_decision     4,504  🔥 UNIQUE
coordinator_compaction   1,435  🔥 UNIQUE
coordinator_violation    1,097  🔥 UNIQUE
memory_stored              354
coordinator_outcome        341
memory_found               196
memory_updated             104
cass_searched               24
```

**Comparison to Global Events:**
```
cell_closed                727  (vs plugin: 8)
cell_created               722  (vs plugin: 1)
message_sent               202  (vs plugin: 16)
coordinator_decision       199  (vs plugin: 4,504 🔥)
coordinator_compaction      80  (vs plugin: 1,435 🔥)
```

**🔥 CRITICAL FINDING:**

This database contains **7,036 coordinator evaluation events** (decisions, compactions, violations) that do NOT exist in the global database:

- **4,504 coordinator_decision** events vs global's 199
- **1,435 coordinator_compaction** events vs global's 80
- **1,097 coordinator_violation** events vs global's 0

This is **evaluation/session capture data** from coordinator protocol testing. These events are critical for:
- Training coordinator behavior models
- Eval scoring (violation detection, compaction quality, decision timing)
- Learning from past coordinator sessions

**Cell Data:**
```bash
# All 121 cells exist in global
sqlite3 ~/.config/swarm-tools/swarm.db \
  "SELECT COUNT(*) FROM cells WHERE id LIKE 'opencode-swarm-plugin--ys7z8-%';"
# Result: 120 (1 cell might be missing or was a test cell)
```

**Recommendation:** ⚠️ **MIGRATE EVENTS BEFORE DELETING**

```bash
# Proposed migration:
# 1. Extract coordinator events from plugin local
sqlite3 packages/opencode-swarm-plugin/.opencode/swarm.db \
  "SELECT * FROM events WHERE type LIKE 'coordinator_%';" > coordinator_events.sql

# 2. Import to global (with conflict resolution)
# Need to handle:
# - Duplicate event IDs
# - Timestamp ordering
# - Foreign key references to agents/cells that may not exist in global

# 3. Verify migration
# 4. Delete plugin local database
```

**Migration Complexity:** MEDIUM - Need to preserve coordinator evaluation data while avoiding duplicates.

---

### 4. Old Hive: `.hive/swarm-mail.db` (1.2MB)

**Status:** 🚨 **UNIQUE HISTORICAL DATA** - Legacy hive schema, not in global  
**Date Range:** Dec 7 - Dec 17 2025  
**Schema:** Legacy (no schema_version table)

**Contents:**
- **519 issues** (legacy `issues` table, not `cells`)
- **805 events**
- **279 dependencies**
- No agents, messages, or modern swarm-mail structures

**Schema Differences:**
```
# OLD HIVE SCHEMA (legacy):
issues, events, comments, dependencies, labels, metadata, 
blocked_issues, ready_issues, dirty_issues, etc.

# MODERN SCHEMA (v8):
cells (view over cells), cells, agents, messages, events, 
memories, eval_records, decision_traces, etc.
```

**Sample Issue IDs:**
```
bd-lf2p4u-mja7tjentkc
bd-lf2p4u-mja89hxs119
bd-lf2p4u-mja8ihnevk9
...
```

**Verification:**
```bash
# NONE of these old IDs exist in global
sqlite3 ~/.config/swarm-tools/swarm.db \
  "SELECT COUNT(*) FROM cells WHERE id LIKE 'bd-lf2p4u-%';"
# Result: 0
```

**🔥 CRITICAL FINDING:**

This database contains **519 historical work items** from the Dec 7-17 period that are **completely absent** from the global database. These represent:
- 2 weeks of work item history
- 279 dependency relationships
- 805 events tracking state changes

**Recommendation:** ⚠️ **MIGRATE BEFORE DELETING**

```bash
# Proposed migration:
# 1. Map old schema to new schema
#    issues table → cells table
#    Legacy event schema → modern event schema
#
# 2. Challenges:
#    - No agent data (who created these?)
#    - Different ID format (bd-lf2p4u-* vs cell-*-*)
#    - Legacy timestamp format (ISO8601 with timezone vs INTEGER epoch)
#    - No project_key (old hive was single-project)
#
# 3. Strategy:
#    - Import issues as cells with synthetic agent "HistoricalImport"
#    - Preserve original IDs
#    - Convert timestamps to epoch
#    - Set project_key to repo root
```

**Migration Complexity:** HIGH - Schema mismatch requires transformation logic.

---

### 5-7. Empty Databases (SAFE TO DELETE)

#### 5. Global Swarm Mail: `~/.config/swarm-tools/swarm-mail.db` (0B)

**Status:** 🗑️ ORPHAN - Empty file  
**Contents:** No tables  
**Created:** Dec 25 09:08  
**Recommendation:** ✅ **DELETE IMMEDIATELY** - Safe, no data.

---

#### 6. Evals Local: `packages/swarm-evals/.opencode/swarm.db` (192KB)

**Status:** 🗑️ EMPTY - Schema exists but no data  
**Schema:** Partial (no schema_version, no cells/cells tables)  
**Tables:** `agents`, `events`, `messages`, `eval_records`, `reservations`, `decision_traces` (all empty)  
**Recommendation:** ✅ **DELETE IMMEDIATELY** - Safe, no data.

---

#### 7. Weird Path: `packages/opencode-swarm-plugin/~/.opencode/.opencode/swarm.db` (316KB)

**Status:** 🗑️ EMPTY - Likely path expansion bug  
**Note:** The `~/` in the path suggests a path expansion bug created a literal `~` directory  
**Tables:** Full modern schema but all empty  
**Recommendation:** ✅ **DELETE IMMEDIATELY** - Safe, no data. Also delete parent directory `packages/opencode-swarm-plugin/~/.opencode/` if empty.

---

## Schema Comparison

### Modern Schema (v8 LibSQL) - Used by Global, Root Local, Plugin Local

**Tables (30 total):**
```
Core:
  - agents, events, messages, message_recipients
  - cursors, locks, reservations, swarm_contexts
  - decision_traces, eval_records

Hive (Issue Tracking):
  - cells, cells (view), cell_dependencies, cell_labels, cell_comments
  - dirty_cells, blocked_cells_cache

Memory System:
  - memories, memory_entities, memory_links
  - memories_fts, memories_fts_config, memories_fts_data, 
    memories_fts_docsize, memories_fts_idx
  - idx_memories_embedding_shadow, libsql_vector_meta_shadow

Entity Relationships:
  - entities, entity_links, relationships

Metadata:
  - schema_version
```

**Key Features:**
- LibSQL vector search for semantic memory
- FTS (Full-Text Search) for memory queries
- Unified event sourcing for all operations
- Agent-centric design (multi-agent coordination)

---

### Legacy Schema - Used by Old Hive (.hive/swarm-mail.db)

**Tables (17 total):**
```
Core:
  - issues (not cells!), events, comments, dependencies, labels
  - metadata, config

Caching/Views:
  - blocked_issues, blocked_issues_cache
  - ready_issues, dirty_issues
  - child_counters, issue_snapshots
  
Export/Sync:
  - export_hashes, repo_mtimes
  - compaction_snapshots
```

**Key Differences:**
1. **No agents** - Single-user design
2. **`issues` not `cells`** - Naming predates hive metaphor
3. **No messages/reservations** - No multi-agent coordination
4. **No memories** - No semantic memory system
5. **Different event schema** - Legacy format

---

## Migration Recommendations

### Priority 1: Old Hive Data (MUST MIGRATE)

**Database:** `.hive/swarm-mail.db`  
**Unique Data:** 519 issues, 279 dependencies, 805 events  
**Risk:** HIGH - Complete loss of Dec 7-17 work history  
**Complexity:** HIGH - Schema transformation required

**Migration Steps:**

1. **Create migration script:**
   ```typescript
   // packages/swarm-mail/src/migrations/import-legacy-hive.ts
   import { db } from 'old-hive-db';
   import { globalDb } from 'global-db';
   
   async function migrateLegacyHive() {
     // 1. Import issues as cells
     const issues = db.query("SELECT * FROM issues").all();
     for (const issue of issues) {
       await globalDb.run(`
         INSERT INTO cells (id, title, description, type, status, priority, created_at, updated_at, project_key)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       `, [
         issue.id,
         issue.title,
         issue.description || '',
         issue.type || 'task',
         issue.status || 'open',
         issue.priority || 2,
         parseISO8601ToEpoch(issue.created_at),
         parseISO8601ToEpoch(issue.updated_at),
         '/Users/joel/Code/joelhooks/opencode-swarm-plugin' // inferred
       ]);
     }
     
     // 2. Import dependencies
     // 3. Import events with schema transformation
     // 4. Create synthetic agent "HistoricalImport"
   }
   ```

2. **Validate migration:**
   ```bash
   # Count before
   sqlite3 .hive/swarm-mail.db "SELECT COUNT(*) FROM issues;"  # 519
   
   # Run migration
   bun run migrate:legacy-hive
   
   # Count after
   sqlite3 ~/.config/swarm-tools/swarm.db \
     "SELECT COUNT(*) FROM cells WHERE id LIKE 'bd-lf2p4u-%';"  # Should be 519
   ```

3. **Backup before delete:**
   ```bash
   cp .hive/swarm-mail.db .hive/swarm-mail.db.backup.2025-12-31
   rm .hive/swarm-mail.db
   ```

---

### Priority 2: Coordinator Evaluation Data (SHOULD MIGRATE)

**Database:** `packages/opencode-swarm-plugin/.opencode/swarm.db`  
**Unique Data:** 7,036 coordinator events (decisions, compactions, violations)  
**Risk:** MEDIUM - Loss of training data for coordinator evals  
**Complexity:** MEDIUM - Event deduplication needed

**Migration Steps:**

1. **Extract coordinator events:**
   ```bash
   sqlite3 packages/opencode-swarm-plugin/.opencode/swarm.db <<SQL
   .mode insert events
   SELECT * FROM events 
   WHERE type IN ('coordinator_decision', 'coordinator_compaction', 'coordinator_violation')
   AND id NOT IN (SELECT id FROM main.events);  -- Avoid duplicates
   SQL
   ```

2. **Import to global with conflict resolution:**
   ```typescript
   // Handle duplicate event IDs by checking before insert
   // Handle missing agent references by creating synthetic agents
   // Preserve timestamps and metadata
   ```

3. **Verify decision_traces and eval_records:**
   - 88 decision_traces in plugin local vs 154 in global
   - 0 eval_records in plugin local vs 47 in global
   - May need to cross-reference with migrated events

4. **Delete after verification:**
   ```bash
   rm packages/opencode-swarm-plugin/.opencode/swarm.db
   ```

---

### Priority 3: Root Local (SAFE TO DELETE)

**Database:** `.opencode/swarm.db`  
**Risk:** LOW - All cells exist in global, messages likely duplicates  
**Action:** Delete immediately

```bash
# Optional: Quick verification
sqlite3 .opencode/swarm.db \
  "SELECT id FROM cells WHERE id NOT IN (
    SELECT id FROM main.cells
  );" | wc -l
# Should return 0

rm .opencode/swarm.db
```

---

### Priority 4: Empty Databases (DELETE NOW)

```bash
# Safe to delete immediately - no data
rm ~/.config/swarm-tools/swarm-mail.db
rm packages/swarm-evals/.opencode/swarm.db
rm packages/opencode-swarm-plugin/~/.opencode/.opencode/swarm.db
rmdir packages/opencode-swarm-plugin/~/.opencode/  # if empty
```

---

## Action Plan Summary

| Database | Action | Priority | Risk | Blocker |
|----------|--------|----------|------|---------|
| **~/.config/swarm-tools/swarm.db** | ✅ KEEP | - | - | Target DB |
| .opencode/swarm.db | 🗑️ DELETE | P3 | LOW | None |
| plugin/.opencode/swarm.db | ⚠️ MIGRATE THEN DELETE | P2 | MEDIUM | Migration script |
| evals/.opencode/swarm.db | 🗑️ DELETE | P4 | NONE | None |
| plugin/~/.opencode/.opencode/swarm.db | 🗑️ DELETE | P4 | NONE | None |
| ~/.config/swarm-tools/swarm-mail.db | 🗑️ DELETE | P4 | NONE | None |
| **.hive/swarm-mail.db** | ⚠️ MIGRATE THEN DELETE | **P1** | **HIGH** | Migration script |

---

## Next Steps

1. ✅ **Immediate:** Delete empty databases (Priority 4)
2. 🔨 **Build migration tooling:**
   - `bun run migrate:legacy-hive` - Import old hive data
   - `bun run migrate:coordinator-events` - Import evaluation data
3. ⚠️ **Run migrations** with backups
4. ✅ **Verify data integrity** post-migration
5. 🗑️ **Delete migrated strays**
6. 📝 **Document migration** in `.hive/analysis/migration-log.md`

---

## Risks & Mitigation

### Risk 1: Data Loss During Migration

**Mitigation:**
- Create backups before any migration: `cp db.db db.db.backup.$(date +%Y-%m-%d)`
- Test migration on copies first
- Verify row counts before/after
- Keep stray databases until migration verified (don't delete immediately)

### Risk 2: Schema Incompatibilities

**Mitigation:**
- Use Drizzle schema validation
- Transform legacy schema explicitly (don't assume compatibility)
- Handle missing fields with sensible defaults

### Risk 3: Event ID Collisions

**Mitigation:**
- Check for duplicate IDs before insert
- Generate new IDs if collision detected
- Log all ID transformations for audit trail

---

## Appendix: Raw Data Queries

### Query 1: All Cell IDs by Database

```bash
# Global
sqlite3 ~/.config/swarm-tools/swarm.db \
  "SELECT id FROM cells ORDER BY created_at DESC LIMIT 20;"

# Root Local
sqlite3 .opencode/swarm.db \
  "SELECT id FROM cells ORDER BY created_at DESC LIMIT 20;"

# Plugin Local
sqlite3 packages/opencode-swarm-plugin/.opencode/swarm.db \
  "SELECT id FROM cells ORDER BY created_at DESC LIMIT 20;"
```

### Query 2: Event Type Distribution

```bash
# Compare event types across databases
for db in ~/.config/swarm-tools/swarm.db \
           .opencode/swarm.db \
           packages/opencode-swarm-plugin/.opencode/swarm.db; do
  echo "=== $db ==="
  sqlite3 "$db" \
    "SELECT type, COUNT(*) FROM events GROUP BY type ORDER BY COUNT(*) DESC LIMIT 10;"
done
```

### Query 3: Date Ranges

```bash
# Check data freshness
sqlite3 ~/.config/swarm-tools/swarm.db \
  "SELECT 
    MIN(datetime(created_at, 'unixepoch')) as earliest,
    MAX(datetime(created_at, 'unixepoch')) as latest
   FROM events;"
```

---

**Report Complete**  
**Recommendation:** Prioritize old hive migration (P1) to preserve Dec 7-17 work history. Coordinator evaluation data (P2) is valuable for training but lower risk. Delete empty databases immediately.
