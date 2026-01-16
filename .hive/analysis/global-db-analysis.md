# Global Database Analysis: Swarm Coordination System

**Database:** `~/.config/swarm-tools/swarm.db` (SQLite/libSQL)  
**Generated:** 2025-12-31  
**Analysis Period:** 2025-12-24 to 2025-12-31  
**Analysts:** BlueWind, BrightWind, BoldMountain, ReportCombiner

---

## Executive Summary

The consolidated swarm database reveals a **maturing multi-agent coordination system** with significant activity (9,576 events, 103 agents, 1,343 work items) but **critical integrity issues** requiring immediate attention. While the system shows strong throughput (83.2% cell completion rate) and full agent engagement (100% active), it suffers from **migration-induced data corruption** and **coordinator protocol violations** that undermine reliability.

### 🔴 CRITICAL Issues (Require Immediate Action)

| Issue | Impact | Count | Severity |
|-------|--------|-------|----------|
| **cells with NULL IDs** | Primary key violations, breaks queries | 427 (32%) | 🔴 CRITICAL |
| **Orphaned message recipients** | Foreign key violations, broken routing | 208 (90%) | 🔴 CRITICAL |
| **Messages without recipients** | Undeliverable messages, data loss | 72 (25%) | 🔴 CRITICAL |
| **Expired unreleased reservations** | Stale file locks, blocks legitimate work | 213 (87%) | 🔴 CRITICAL |
| **Coordinator violations** | Protocol breaches, work not delegated | 1,097 (19.6%) | 🔴 CRITICAL |
| **Low decomposition success rate** | Feature-based strategy underperforming | 4/29 (13.8%) | 🔴 CRITICAL |

### 🟡 Warnings (Require Investigation)

- **Orphaned active reservations:** 2 locks held by deleted agents
- **Inconsistent project_key values:** 4 distinct keys across tables
- **Incomplete eval tracking:** Duration/error data missing (all 0ms)
- **Workers skipping review:** 10.9% complete without coordinator review
- **Growing backlog:** 221 open cells (mostly priority 2 tasks)

### 🟢 Strengths

- **High completion rate:** 83.2% of cells closed (1,118/1,343)
- **Zero zombie agents:** 100% of registered agents have activity
- **Low blocked rate:** Only 0.1% cells blocked (minimal dependencies)
- **Active learning system:** 658 memory operations (store/query/validate)
- **Low file contention:** 11.5% early releases (good reservation sizing)
- **Stable daily activity:** ~140 events/day post-spike

### 🎯 Recommended Actions (Prioritized)

**Immediate (Today):**
1. Execute SQL cleanup scripts (NULL IDs, orphaned refs, stale locks)
2. Enable foreign key constraints (`PRAGMA foreign_keys = ON`)
3. Implement TTL-based reservation cleanup job
4. Fix eval duration tracking (`swarm_record_outcome` instrumentation)

**This Week:**
5. Reduce coordinator violations (stronger guardrails, pre-flight checks)
6. Enforce review protocol (block completion without review)
7. Multi-strategy decomposition testing (file-based, risk-based)
8. Normalize project_key to single canonical path

**This Month:**
9. Add structured error event types (stop parsing JSON manually)
10. Implement blocked cell dependency tracking
11. File hotspot optimization (split high-contention files)
12. Agent lifecycle tracking (detect zombies, auto-cleanup)

---

## Part 1: Health & Integrity Audit

**Date:** 2024-12-31  
**Context:** Post-migration audit after consolidating 4 stray databases  
**Auditor:** BlueWind

### Table Overview

| Table | Row Count | Health Status |
|-------|-----------|---------------|
| **events** | 9,576 | ✅ Clean (append-only, valid JSON) |
| **cells** | 1,343 | ⚠️ 427 NULL IDs (32% corrupt) |
| **agents** | 103 | ✅ Clean (no duplicates) |
| **messages** | 286 | ⚠️ 72 orphaned (25%) |
| **message_recipients** | 232 | 🔴 208 orphaned (90%) |
| **reservations** | 244 | 🔴 213 expired unreleased (87%) |
| **eval_records** | 29 | ⚠️ Incomplete data (0ms durations) |
| **cell_dependencies** | 0 | ✅ Empty (no relationships created) |
| **cell_labels** | 0 | ✅ Empty |
| **cell_comments** | 0 | ✅ Empty |

### 🔴 CRITICAL: NULL cell IDs (427 records)

**Impact:** Primary key violations, duplicate records  
**Details:**
- 427 cells have `NULL` id but valid data (32% of total)
- All are closed epics with duplicate titles
- Examples: "Pino Logging Infrastructure + Compaction Instrumentation", "P0 Security Fixes + Analytics Queries"

**Root Cause:** Migration script used `INSERT OR IGNORE` which silently failed on primary key conflicts, creating NULL id records instead of skipping.

**SQL Fix:**
```sql
DELETE FROM cells WHERE id IS NULL;
```

**Severity:** 🔴 CRITICAL - Violates table constraints, breaks queries

---

### 🔴 CRITICAL: Orphaned Message Recipients (208 records)

**Impact:** Foreign key integrity violation, broken message routing  
**Details:**
- 208 message_recipient rows reference agents that don't exist (90% of table!)
- Top orphaned agents:
  - `coordinator`: 157 orphaned messages
  - `worker`: 18 orphaned messages
  - Various `Worker1`, `Worker2`, `worker-N` entries

**Root Cause:** Agents deleted but CASCADE deletes not enforced (SQLite FK constraints disabled).

**SQL Fix:**
```sql
-- Enable FK constraints
PRAGMA foreign_keys = ON;

-- Clean up orphaned recipients
DELETE FROM message_recipients
WHERE NOT EXISTS (
  SELECT 1 FROM agents 
  WHERE agents.name = message_recipients.agent_name
);
```

**Severity:** 🔴 CRITICAL - Violates referential integrity

---

### 🔴 CRITICAL: Messages Without Recipients (72 records)

**Impact:** Undeliverable messages, broken threads  
**Details:**
- 72 messages exist with no corresponding message_recipients entries (25%)
- Cannot be delivered to anyone
- Orphaned during migration when recipients were in different databases

**SQL Diagnostic Query:**
```sql
SELECT id, subject, from_agent, created_at 
FROM messages m
LEFT JOIN message_recipients mr ON m.id = mr.message_id
WHERE mr.message_id IS NULL;
```

**Decision Required:** Archive, delete, or manually reconstruct recipients (needs human review of thread importance).

**Severity:** 🔴 CRITICAL - Data loss, incomplete message threads

---

### 🔴 CRITICAL: Expired Unreleased Reservations (213 records)

**Impact:** Stale file locks, blocked agents  
**Details:**
- 213 reservations past their `expires_at` timestamp but `released_at IS NULL` (87% of table)
- Blocking phantom agents from accessing files
- Agents likely crashed or failed to call `swarm_complete`

**SQL Fix:**
```sql
-- Auto-release expired reservations
UPDATE reservations
SET released_at = expires_at
WHERE expires_at < (strftime('%s', 'now') * 1000)
AND released_at IS NULL;
```

**Severity:** 🔴 CRITICAL - Blocks legitimate work, requires immediate cleanup

---

### 🟡 WARNING: Orphaned Active Reservations (2 records)

**Impact:** File locks held by non-existent agents  
**Details:**
- 2 active (unexpired) reservations for agent `PureCloud` who doesn't exist
- Files locked:
  - `packages/swarm-mail/src/sessions/chunk-processor.ts`
  - `packages/swarm-mail/src/sessions/chunk-processor.test.ts`

**SQL Fix:**
```sql
UPDATE reservations
SET released_at = (strftime('%s', 'now') * 1000)
WHERE agent_name NOT IN (SELECT name FROM agents)
AND released_at IS NULL;
```

**Severity:** 🟡 WARNING - Minor blocking issue

---

### 🟡 WARNING: Inconsistent project_key Values

**Impact:** Cross-project query complexity  
**Details:**
- **agents**: 2 unique project_keys
- **events**: 4 unique project_keys
- **messages**: 3 unique project_keys
- **reservations**: 2 unique project_keys

**Top project_keys:**
1. `/Users/joel/Code/joelhooks/opencode-swarm-plugin` - 98 agents, 1,454 events
2. `/Users/joel/Code/joelhooks/opencode-swarm-plugin/packages/opencode-swarm-plugin` - 5 agents, 8,103 events
3. `/Users/joel/Code/skillrecordings/migrate-egghead/course-builder` - 0 agents, 17 events (orphaned)
4. `/Users/joel/Code/joelhooks/opencode-next` - 0 agents, 5 events (orphaned)

**Analysis:** Most activity split between monorepo root and package subdirectory. Other projects have orphaned events from testing.

**Recommendation:** Normalize to single project_key (monorepo root) or accept multi-project design if intentional.

**Severity:** 🟡 WARNING - Design inconsistency, not blocking

---

### Schema Validation Summary

| Table | Checks Passed | Checks Failed |
|-------|---------------|---------------|
| **events** | ✅ No NULL values, valid JSON, monotonic timestamps | None |
| **cells** | ✅ No NULL titles/status/type, valid enums, no orphaned parents | ❌ 427 NULL IDs |
| **cell_dependencies** | ✅ No orphaned FK references | None (empty) |
| **messages** | ⚠️ Syntax valid | ❌ 72 orphaned (no recipients) |
| **message_recipients** | ⚠️ Syntax valid | ❌ 208 orphaned (agents missing) |
| **reservations** | ⚠️ Syntax valid | ❌ 213 expired unreleased |

---

### Migration Post-Mortem

**What Went Wrong:**
1. ❌ `INSERT OR IGNORE` silently failed, created NULL id records
2. ❌ Foreign key constraints not enforced during migration
3. ❌ No transaction rollback on partial failures
4. ❌ Missing cleanup step for expired reservations
5. ❌ No validation queries run immediately after migration

**Lessons for Next Migration:**
1. ✅ Enable `PRAGMA foreign_keys = ON` BEFORE migration
2. ✅ Use `INSERT OR REPLACE` instead of `INSERT OR IGNORE`
3. ✅ Wrap migration in `BEGIN TRANSACTION / COMMIT`
4. ✅ Run validation queries immediately after migration
5. ✅ Create rollback script before running migration
6. ✅ Test migration on database copy first

---

## Part 2: Usage Analytics & Patterns

**Analysis Period:** 2025-12-24 to 2025-12-31  
**Analyst:** BrightWind

### System Scale

- **Total events:** 9,539 (includes 37 non-coordinator events since initial count)
- **Active agents:** 100 unique agents with recorded activity
- **Work items:** 1,312 cells managed (excludes 427 NULL ID records)
- **Messages:** 283 inter-agent communications
- **File reservations:** 244 total (213 stale, 20 active)

### Event Type Distribution (Top 20)

```
┌─────────────────────────────┬───────┬─────────┐
│ Event Type                  │ Count │ % Total │
├─────────────────────────────┼───────┼─────────┤
│ coordinator_decision        │ 4,508 │  47.3%  │  ████████████████████
│ coordinator_compaction      │ 1,435 │  15.0%  │  ███████
│ coordinator_violation       │ 1,097 │  11.5%  │  █████
│ memory_stored               │   354 │   3.7%  │  █
│ coordinator_outcome         │   341 │   3.6%  │  █
│ cell_closed                 │   308 │   3.2%  │  █
│ message_sent                │   286 │   3.0%  │  █
│ cell_created                │   212 │   2.2%  │  █
│ memory_found                │   200 │   2.1%  │  █
│ agent_registered            │   129 │   1.4%  │  
│ file_reserved               │   123 │   1.3%  │  
│ memory_updated              │   104 │   1.1%  │  
│ thread_created              │    89 │   0.9%  │  
│ cell_status_changed         │    59 │   0.6%  │  
│ review_completed            │    56 │   0.6%  │  
│ cell_updated                │    49 │   0.5%  │  
│ cass_searched               │    46 │   0.5%  │  
│ decomposition_generated     │    29 │   0.3%  │  
│ swarm_completed             │    24 │   0.3%  │  
│ hive_synced                 │    23 │   0.2%  │  
└─────────────────────────────┴───────┴─────────┘
```

**Key Insights:**
- **Coordinator-centric:** 72.3% of events are coordinator actions (decisions, compactions, violations, outcomes)
- **Memory system active:** 658 memory operations (6.9%) - agents querying and storing learnings
- **Low swarm completion rate:** Only 24 swarm_completed vs 29 decomposition_generated → **17% incomplete**

---

### Coordinator Behavior Analysis

#### Decision Types (4,508 total)

```
┌──────────────────────────┬───────┬─────────┐
│ Decision Type            │ Count │ % Total │
├──────────────────────────┼───────┼─────────┤
│ review_completed         │ 2,002 │  44.4%  │  ████████████████████
│ decomposition_complete   │   783 │  17.4%  │  ████████
│ strategy_selected        │   670 │  14.9%  │  ███████
│ worker_spawned           │   435 │   9.6%  │  ████
│ skill_loaded             │   124 │   2.8%  │  █
│ researcher_spawned       │   124 │   2.8%  │  █
│ inbox_checked            │   124 │   2.8%  │  █
│ blocker_resolved         │   124 │   2.8%  │  █
│ scope_change_rejected    │    61 │   1.4%  │  
│ scope_change_approved    │    61 │   1.4%  │  
└──────────────────────────┴───────┴─────────┘
```

**Review dominance:** 44.4% of coordinator time spent on reviews - strong adherence to review protocol.

#### 🔴 Violation Types (1,097 total)

```
┌────────────────────────────────────┬───────┬─────────┐
│ Violation Type                     │ Count │ % Total │
├────────────────────────────────────┼───────┼─────────┤
│ coordinator_edited_file            │   461 │  42.0%  │  ████████████████████
│ coordinator_ran_tests              │   258 │  23.5%  │  ███████████
│ coordinator_reserved_files         │   172 │  15.7%  │  ███████
│ worker_completed_without_review    │   120 │  10.9%  │  █████
│ no_worker_spawned                  │    86 │   7.8%  │  ███
└────────────────────────────────────┴───────┴─────────┘
```

**Violation rate: 19.6%** (1,097 violations / 5,605 coordinator events)

**🔴 CRITICAL FINDING:** 42% of violations are coordinators editing files directly - core protocol breach. This indicates:
- Agents still learning swarm patterns
- Possible gaps in worker task definitions
- Need for stronger guardrails or better decomposition

**Workers completing without review:** 10.9% of violations - review step being skipped, breaks learning feedback loop.

---

### Work Item (Cell) Patterns

#### Status Distribution (1,343 total)

```
┌─────────────┬───────┬─────────┐
│ Status      │ Count │ % Total │
├─────────────┼───────┼─────────┤
│ closed      │ 1,118 │  83.2%  │  █████████████████████████████████████
│ open        │   221 │  16.5%  │  ███████
│ blocked     │     2 │   0.1%  │  
│ in_progress │     2 │   0.1%  │  
└─────────────┴───────┴─────────┘
```

**Completion rate: 83.2%** - strong throughput  
**Low blocked rate (0.1%)** - excellent unblocking or minimal dependency issues

#### Type Distribution (1,343 total)

```
┌─────────┬───────┬─────────┐
│ Type    │ Count │ % Total │
├─────────┼───────┼─────────┤
│ task    │   957 │  71.3%  │  ████████████████████████████
│ epic    │   255 │  19.0%  │  ███████
│ bug     │    84 │   6.3%  │  ██
│ feature │    39 │   2.9%  │  █
│ chore   │     8 │   0.6%  │  
└─────────┴───────┴─────────┘
```

**Task-heavy workload:** 71.3% tasks (likely epic subtasks)  
**Epic-to-task ratio:** 1:3.75 (255 epics → 957 tasks) - healthy decomposition granularity

---

### Message & Communication Patterns

#### Importance Distribution (286 messages)

```
┌───────────┬───────┬─────────┐
│ Importance│ Count │ % Total │
├───────────┼───────┼─────────┤
│ normal    │   239 │  83.6%  │  █████████████████████████████████
│ high      │    42 │  14.7%  │  ██████
│ urgent    │     5 │   1.7%  │  
└───────────┴───────┴─────────┘
```

**Low urgency rate:** Only 1.7% urgent messages - indicates stable coordination without many blockers.

#### Most Active Threads (Top 10)

```
┌──────────────────────────────────────────────┬───────────────┐
│ Thread ID                                    │ Message Count │
├──────────────────────────────────────────────┼───────────────┤
│ opencode-swarm-monorepo-lf2p4u-mjpyofk7wph   │      14       │
│ mjrw7leej94                                  │      13       │
│ mjmas3zxlmg                                  │      10       │
│ mjnpk5ib0ed                                  │      10       │
│ opencode-swarm-monorepo-lf2p4u-mjndfb3t7h6   │      10       │
│ opencode-swarm-plugin--ys7z8-mjmbqk4bd8i     │      10       │
│ mjoogswl9ay                                  │       9       │
│ opencode-swarm-monorepo-lf2p4u-mjqmjl3u7ky   │       7       │
│ opencode-swarm-monorepo-lf2p4u-mjrd4fkiggb   │       7       │
│ mjndfb3t7h6                                  │       6       │
└──────────────────────────────────────────────┴───────────────┘
```

**Hottest thread:** 14 messages - moderate threading activity (avg 2.86 messages per thread).

---

### File Reservation Patterns

#### Lifecycle Stats (244 total)

```
┌───────────────────────┬───────┬─────────┐
│ State                 │ Count │ % Total │
├───────────────────────┼───────┼─────────┤
│ Expired (TTL reached) │   213 │  87.3%  │  ███████████████████████████████████
│ Released early        │    28 │  11.5%  │  ████
│ Still active          │     3 │   1.2%  │  
└───────────────────────┴───────┴─────────┘
```

**Low early release rate (11.5%)** suggests:
- Agents holding files for full TTL window
- Minimal file contention requiring early release
- Good reservation sizing (not over-requesting)

#### Most Reserved Files (Top 15)

```
┌────────────────────────────────────────────────────────────┬───────┬──────────────┐
│ Path Pattern                                               │ Count │ Avg Duration │
├────────────────────────────────────────────────────────────┼───────┼──────────────┤
│ packages/swarm-mail/src/streams/events.ts                  │   6   │   3,090 sec  │
│ packages/opencode-swarm-plugin/src/index.ts                │   6   │   3,300 sec  │
│ packages/swarm-mail/README.md                              │   5   │   3,600 sec  │
│ packages/swarm-dashboard/src/App.tsx                       │   5   │   2,896 sec  │
│ packages/swarm-mail/src/streams/durable-server.ts          │   4   │   3,150 sec  │
│ packages/opencode-swarm-plugin/src/observability-tools.ts  │   4   │   3,600 sec  │
│ packages/opencode-swarm-plugin/package.json                │   4   │   3,150 sec  │
│ packages/opencode-swarm-plugin/bin/swarm.ts                │   4   │   3,600 sec  │
│ AGENTS.md                                                  │   4   │   3,600 sec  │
│ packages/swarm-mail/src/streams/durable-server.test.ts     │   3   │   3,000 sec  │
│ packages/swarm-dashboard/src/App.test.tsx                  │   3   │   3,600 sec  │
│ packages/opencode-swarm-plugin/src/swarm.integration.test.ts│   3   │   2,519 sec  │
│ packages/opencode-swarm-plugin/src/swarm-orchestrate.ts    │   3   │   1,674 sec  │
│ packages/opencode-swarm-plugin/evals/smart-operations.eval.ts│   3   │   3,600 sec  │
│ packages/opencode-swarm-plugin/evals/scorers/smart-operations-scorer.ts│ 3 │ 3,600 sec │
└────────────────────────────────────────────────────────────┴───────┴──────────────┘
```

**Hotspots:**
- **Core infrastructure:** `events.ts`, `index.ts`, `durable-server.ts` - high contention on swarm primitives
- **Documentation:** `README.md`, `AGENTS.md` - actively maintained
- **Tests:** Multiple test files in top 15 - strong test-first culture

**Duration insight:** Most reservations held for ~3,000-3,600 seconds (50-60 minutes) - suggests full 1-hour TTL usage.

---

### Activity Timeline

#### Daily Event Volume

```
┌────────────┬────────┐
│ Date       │ Events │  Visualization
├────────────┼────────┼─────────────────────────────────────────────────
│ 2025-12-31 │     44 │  █
│ 2025-12-30 │    142 │  ███
│ 2025-12-29 │    233 │  █████
│ 2025-12-28 │  7,475 │  ████████████████████████████████████████████████
│ 2025-12-27 │    650 │  ████████████
│ 2025-12-26 │    439 │  █████████
│ 2025-12-25 │    476 │  █████████
│ 2025-12-24 │    117 │  ██
└────────────┴────────┴─────────────────────────────────────────────────
```

**🔥 MASSIVE SPIKE on 2025-12-28:** 7,475 events (78.4% of all activity)

Possible explanations:
- Bulk migration/consolidation event
- Large swarm execution
- Database consolidation testing

**Declining trend post-spike:** Activity returning to baseline (44-233 events/day).

---

### 🔴 Swarm Metrics (Evaluation Records)

#### Overall Performance (29 decompositions, feature-based strategy only)

```
┌────────────────┬───────┬──────────────┬──────────────┬──────────────┐
│ Strategy       │ Count │ Success Rate │ Avg Duration │ Total Errors │
├────────────────┼───────┼──────────────┼──────────────┼──────────────┤
│ feature-based  │  29   │    13.79%    │     0.0 sec  │      0       │
└────────────────┴───────┴──────────────┴──────────────┴──────────────┘
```

**Overall Success Metrics:**
- **Total evaluations:** 29
- **Successful:** 4 (13.79%)
- **Failed:** 0 (explicitly marked failed)
- **Undetermined:** 25 (86.21% - no success flag set)

**🔴 CRITICAL FINDINGS:**
1. **Low success rate** suggests:
   - Evaluations incomplete (success flag not being set)
   - Feature-based strategy not optimal for current task types
   - Need for file-based or risk-based strategy trials
2. **Zero duration & errors:** Indicates `eval_records` capturing outcomes incompletely
3. **Single strategy bias:** No comparison data for file-based or risk-based

**Recommendation:** Implement multi-strategy A/B testing - try file-based and risk-based decomposition to compare effectiveness.

---

## Part 3: Observability & Real-Time Monitoring

**Generated:** 2025-12-31  
**Analyst:** BoldMountain

### 📊 Current State Dashboard

#### Active Cell Distribution (225 non-closed)

| Status | Count | % of Active |
|--------|-------|-------------|
| **Open** | 221 | 98.2% |
| **In Progress** | 2 | 0.9% |
| **Blocked** | 2 | 0.9% |

#### Open Cells by Priority

- **High (3):** 18 cells (8.1%)
- **Normal (2):** 95 cells (43.0%) ← **Largest backlog segment**
- **Low (1):** 105 cells (47.5%)
- **Lowest (0):** 8 cells (3.6%)

**⚠️ Growing backlog:** 221 open cells, mostly priority 2 tasks. May indicate:
- Decomposition rate exceeding completion rate
- Need for better task prioritization
- Possible abandoned epics

---

### Active File Reservations (20 Total)

**Current Workers (3 active):**
- **BoldMountain:** `.hive/analysis/db-observability.md`
- **BrightWind:** `.hive/analysis/db-usage-analytics.md`
- **BlueWind:** `.hive/analysis/db-health-audit.md`

**⚠️ Stale Reservations (17 of 20, created >24h ago):**
- **BoldRiver:** 8 files (created 2025-12-30 02:01) - 40h old
  - `packages/opencode-swarm-plugin/src/index.ts`
  - `packages/opencode-swarm-plugin/src/*-tools.ts`
  - Test files
- **WiseMountain, WarmForest, BlueForest, GoldLake, CalmRiver, SwiftStone:** 9 files total

**🔴 CRITICAL ISSUE:** 85% of reservations are zombie locks. Agents likely crashed or failed to call `swarm_complete`. Blocks other agents from working on those files.

**Recommendation:** Implement TTL-based auto-release (current default: 3600s = 1h). Add cleanup job for reservations where agent hasn't been active in >1h.

---

### Agent Activity (Last 10 Active)

| Agent | Last Active | Status |
|-------|-------------|--------|
| BoldMountain | 2025-12-31 17:51:26 | 🟢 Active now |
| BrightWind | 2025-12-31 17:51:17 | 🟢 Active now |
| BlueWind | 2025-12-31 17:51:11 | 🟢 Active now |
| BoldRiver | 2025-12-30 02:01:08 | 🔴 Inactive ~40h |
| SilverStar | 2025-12-30 02:01:03 | 🔴 Inactive ~40h |
| WiseMountain | 2025-12-30 02:00:58 | 🔴 Inactive ~40h |
| WarmForest | 2025-12-30 01:46:02 | 🔴 Inactive ~40h |
| BlueForest | 2025-12-30 01:45:57 | 🔴 Inactive ~40h |
| GoldLake | 2025-12-30 01:45:38 | 🔴 Inactive ~40h |
| CalmRiver | 2025-12-30 01:45:31 | 🔴 Inactive ~40h |

**Total Registered Agents:** 103  
**Active Agents (last 7 days):** 100%

---

### Communication Activity

| Metric | Count |
|--------|-------|
| Total Messages | 288 |
| Unique Threads | 112 |
| Avg Messages/Thread | 2.6 |

**Low thread depth** suggests:
- Quick resolution of coordination issues
- Minimal back-and-forth needed
- Or: agents not using messages effectively for coordination

---

### Hourly Activity (Today)

```
16:00: ███████████ 18 events
17:00: ████████████████ 28 events (CURRENT HOUR)
```

**Peak Hours:** 17:00 (current activity from 3 parallel agents analyzing database)

---

### 🚧 Bottlenecks & Performance

#### Task Decomposition Performance (29 evals, all feature-based)

| Metric | Value |
|--------|-------|
| Success Rate | 13.8% (4/29) |
| Avg Duration | 0.0 ms |
| Max Duration | 0 ms |
| Min Duration | 0 ms |
| Avg Errors | 0 |

**🔴 CRITICAL FINDING:** All 29 eval_records show `total_duration_ms = 0` and `total_errors = 0`, but only 4 marked as successful. This suggests:

1. **Duration tracking not working** - `swarm_record_outcome` not being called or duration calculation broken
2. **Low success rate** - Only 13.8% of decompositions succeed
3. **Single strategy bias** - All 29 use `feature-based`, no `file-based` or `risk-based` comparisons

**Failed Decompositions (Representative Sample):**
- "Dashboard Live Updates + WebTUI Catppuccin Restyle"
- "Wire up swarm-dashboard: /cells endpoint + App.tsx"
- "Extract @swarmtools/evals package (PR #81 fix)"
- "Fix CI/CD: @swarmtools/evals type errors"
- "Refactor build script to scripts/build.ts"
- "Dashboard WebSocket Polish: partysocket + Status UI + Tests"
- "Context Graph: Full Implementation (4 Phases)"

**Successful Decompositions (Sample):**
- "Comprehensive event instrumentation with rich metadata" ✅
- "Post-swarm validation system with event stream integration" ✅
- "Hivemind Memory Unification" ✅

---

#### Coordinator Violations (1,097 events, 19.6% of coordinator activity)

**What Coordinators Are Doing Wrong:**
- **Editing files directly** (should spawn workers) - 461 violations (42%)
- **Running tests/builds** (should delegate) - 258 violations (23.5%)
- **Reserving files** (should let workers reserve) - 172 violations (15.7%)
- **Skipping reviews** (should validate worker output) - 120 violations (10.9%)
- **Working serially** (should spawn parallel workers) - 86 violations (7.8%)

**Learning Impact:**
- Violations feed into coordinator behavior scorers
- Used to refine coordinator prompts in evals
- Should decrease over time as model learns protocol

**Current trend:** Violations remain steady (~19.6%) - protocol reinforcement not yet effective.

---

#### Blocked Cells (2 total)

**Total Blocked:** 2 cells (status='blocked')  
**Blocked Cells Cache:** Empty (0 entries)

**Issue:** Cells marked as blocked but not tracked in `blocked_cells_cache`. Suggests:
- Dependency tracking incomplete
- Manual blocks without dependency metadata
- Need to populate cache when cells transition to blocked status

---

### 🔍 Failure Patterns

#### Error Events (Explicit)

**Query:** `SELECT * FROM events WHERE type LIKE '%error%' OR type LIKE '%fail%'`  
**Result:** 0 events

**Analysis:**
- No explicit error/failure event types in current schema
- Errors likely embedded in `data` JSON field of other event types
- **Recommendation:** Add dedicated error event types (`worker_failed`, `decomposition_failed`, `test_failed`, etc.)

---

#### Review Rejections

**Total Review Events:** 56  
**Rejection Data:** Not easily extractable from current schema

Would need to parse `events.data` JSON to get:
- How many reviews resulted in "needs_changes"
- How many workers hit 3-strike limit
- Common rejection reasons (type errors, missing tests, scope creep)

**Recommendation:** Add structured review outcome events with rejection reason field.

---

## Consolidated Recommendations

### 🔴 Immediate Actions (Execute Today)

#### 1. Database Cleanup (SQL Scripts)

**Enable Foreign Key Constraints:**
```sql
PRAGMA foreign_keys = ON;
```

**Clean NULL cell IDs:**
```sql
DELETE FROM cells WHERE id IS NULL;
-- Expected: 427 rows deleted
```

**Release Expired Reservations:**
```sql
UPDATE reservations
SET released_at = expires_at
WHERE expires_at < (strftime('%s', 'now') * 1000)
AND released_at IS NULL;
-- Expected: 213 rows updated
```

**Clean Orphaned Message Recipients:**
```sql
DELETE FROM message_recipients
WHERE NOT EXISTS (
  SELECT 1 FROM agents 
  WHERE agents.name = message_recipients.agent_name
);
-- Expected: 208 rows deleted
```

**Release Orphaned Active Reservations:**
```sql
UPDATE reservations
SET released_at = (strftime('%s', 'now') * 1000)
WHERE agent_name NOT IN (SELECT name FROM agents)
AND released_at IS NULL;
-- Expected: 2 rows updated
```

**Verify Cleanup:**
```sql
SELECT 
  (SELECT COUNT(*) FROM cells WHERE id IS NULL) as null_cell_ids,
  (SELECT COUNT(*) FROM message_recipients mr 
   WHERE NOT EXISTS (SELECT 1 FROM agents WHERE name = mr.agent_name)) as orphaned_recipients,
  (SELECT COUNT(*) FROM messages m 
   WHERE NOT EXISTS (SELECT 1 FROM message_recipients WHERE message_id = m.id)) as orphaned_messages,
  (SELECT COUNT(*) FROM reservations 
   WHERE expires_at < (strftime('%s', 'now') * 1000) AND released_at IS NULL) as stale_reservations;
```

**Expected Result (post-cleanup):**
```
null_cell_ids: 0
orphaned_recipients: 0
orphaned_messages: 72 (requires manual review)
stale_reservations: 0
```

---

#### 2. Implement TTL-Based Reservation Cleanup

**Add to cron or systemd timer:**
```bash
# Run every hour
0 * * * * sqlite3 ~/.config/swarm-tools/swarm.db "UPDATE reservations SET released_at = expires_at WHERE expires_at < (strftime('%s', 'now') * 1000) AND released_at IS NULL"
```

**Or add to swarm CLI:**
```bash
swarm cleanup --stale-reservations --dry-run  # Preview
swarm cleanup --stale-reservations --execute  # Execute
```

---

#### 3. Fix Eval Duration Tracking

**Verify `swarm_record_outcome` calls:**
- Check if `swarm_complete` calls `swarm_record_outcome`
- Add instrumentation to confirm duration capture
- Debug why all durations are 0ms

**Add logging to `swarm_record_outcome`:**
```typescript
console.log(`[swarm_record_outcome] cell_id=${cell_id} duration=${duration_ms}ms errors=${error_count} success=${success}`);
```

**Test with minimal swarm:**
```bash
swarm decompose "Add console.log statement" --strategy feature-based
# Verify eval_record gets non-zero duration
```

---

#### 4. Review Orphaned Messages (Human Decision)

**Identify candidates for deletion:**
```sql
SELECT id, subject, from_agent, thread_id, created_at 
FROM messages m
LEFT JOIN message_recipients mr ON m.id = mr.message_id
WHERE mr.message_id IS NULL
ORDER BY created_at DESC
LIMIT 20;
```

**Decision criteria:**
- **Delete if:** Test data, duplicate threads, expired coordination
- **Archive if:** Contains valuable context, part of important epic
- **Reconstruct recipients if:** Critical coordination message with identifiable intended recipients

**Create archive table before deleting:**
```sql
CREATE TABLE IF NOT EXISTS messages_archive AS SELECT * FROM messages WHERE 1=0;
INSERT INTO messages_archive SELECT * FROM messages WHERE id IN (/* orphaned IDs */);
DELETE FROM messages WHERE id IN (/* orphaned IDs after review */);
```

---

### 🟡 This Week Actions

#### 5. Reduce Coordinator Violations (19.6% → <10%)

**Add Pre-Flight Check to Coordinator Prompt:**
```markdown
Before editing ANY file, ask yourself:
1. Can this be decomposed into 2+ worker tasks?
2. Does this require sequential steps that must be done by me?
3. Is this a 1-line fix that would take longer to explain than do?

If answer to #1 is YES → DECOMPOSE and spawn workers.
If answer to #2 is NO → DECOMPOSE and spawn workers.
Only if #3 is YES may you edit directly (but log it as a learning signal).
```

**Add Guardrails in Swarm Tools:**
```typescript
// In coordinator session, intercept Edit/Write/Bash tools
if (toolName === 'edit' || toolName === 'write') {
  throw new Error('COORDINATOR VIOLATION: Use swarm_spawn_subtask instead of editing directly');
}
```

**Track Trends:**
```sql
-- Violations per day
SELECT date(timestamp/1000, 'unixepoch') as date, 
       COUNT(*) as violations
FROM events 
WHERE type='coordinator_violation'
GROUP BY date 
ORDER BY date DESC 
LIMIT 14;
```

---

#### 6. Enforce Review Protocol (10.9% skip → 0%)

**Make Review Mandatory:**
```typescript
// In swarm_complete
if (!reviewCompleted) {
  throw new Error('Cannot complete without coordinator review. Call swarm_review first.');
}
```

**Auto-Call Review:**
```typescript
// Option 1: swarm_complete automatically calls swarm_review
async function swarm_complete({ cell_id, ... }) {
  // Auto-generate review if not done
  const review = await swarm_review({ cell_id, files_touched });
  // Block if review rejects
  if (review.status === 'needs_changes') {
    throw new Error(`Review failed: ${review.issues}`);
  }
  // Continue with completion
}
```

**Add Review Quality Scoring:**
```typescript
interface ReviewOutcome {
  status: 'approved' | 'needs_changes';
  issues: Array<{file: string, line: number, severity: 'high'|'medium'|'low', description: string}>;
  quality_score: number; // 0-100
}
```

---

#### 7. Multi-Strategy Decomposition Testing

**Run 10 Evals Per Strategy:**
```bash
# File-based
swarm eval --strategy file-based --count 10

# Risk-based
swarm eval --strategy risk-based --count 10

# Feature-based (baseline)
swarm eval --strategy feature-based --count 10
```

**Compare Success Rates:**
```sql
SELECT strategy, 
       COUNT(*) as total,
       SUM(CASE WHEN overall_success=1 THEN 1 ELSE 0 END) as successes,
       ROUND(100.0 * SUM(CASE WHEN overall_success=1 THEN 1 ELSE 0 END) / COUNT(*), 2) as success_rate,
       AVG(total_duration_ms) as avg_duration_ms,
       AVG(total_errors) as avg_errors
FROM eval_records
GROUP BY strategy
ORDER BY success_rate DESC;
```

**Decision:** Adopt strategy with highest success rate as new default.

---

#### 8. Normalize project_key Values

**Choose Canonical Path:**
- **Option A:** Monorepo root → `/Users/joel/Code/joelhooks/opencode-swarm-plugin`
- **Option B:** Package path → `/Users/joel/Code/joelhooks/opencode-swarm-plugin/packages/opencode-swarm-plugin`

**Recommended:** Use monorepo root (broader scope, covers all packages).

**Migration Script:**
```sql
-- Update agents
UPDATE agents 
SET project_key = '/Users/joel/Code/joelhooks/opencode-swarm-plugin'
WHERE project_key LIKE '%/packages/opencode-swarm-plugin%';

-- Update events
UPDATE events 
SET project_key = '/Users/joel/Code/joelhooks/opencode-swarm-plugin'
WHERE project_key LIKE '%/packages/opencode-swarm-plugin%';

-- Update messages
UPDATE messages 
SET project_key = '/Users/joel/Code/joelhooks/opencode-swarm-plugin'
WHERE project_key LIKE '%/packages/opencode-swarm-plugin%';

-- Update reservations
UPDATE reservations 
SET project_key = '/Users/joel/Code/joelhooks/opencode-swarm-plugin'
WHERE project_key LIKE '%/packages/opencode-swarm-plugin%';

-- Verify
SELECT project_key, COUNT(*) FROM agents GROUP BY project_key;
SELECT project_key, COUNT(*) FROM events GROUP BY project_key;
SELECT project_key, COUNT(*) FROM messages GROUP BY project_key;
SELECT project_key, COUNT(*) FROM reservations GROUP BY project_key;
```

---

### 🔵 This Month Actions

#### 9. Add Structured Error Event Types

**Define Error Events:**
```typescript
type ErrorEvent = 
  | { type: 'worker_failed', cell_id: string, error: string, stack: string }
  | { type: 'decomposition_failed', task: string, reason: string }
  | { type: 'test_failed', file: string, test_name: string, error: string }
  | { type: 'reservation_conflict', file: string, agent1: string, agent2: string }
  | { type: 'review_rejected', cell_id: string, attempt: number, issues: Array<...> };
```

**Emit from Error Handlers:**
```typescript
try {
  await worker.execute();
} catch (error) {
  await emitEvent({
    type: 'worker_failed',
    cell_id,
    error: error.message,
    stack: error.stack
  });
  throw error;
}
```

**Query Error Patterns:**
```sql
SELECT type, COUNT(*) as count
FROM events
WHERE type LIKE '%_failed' OR type LIKE '%_rejected' OR type LIKE '%_conflict'
GROUP BY type
ORDER BY count DESC;
```

---

#### 10. Implement Blocked Cell Dependency Tracking

**Populate `blocked_cells_cache` on Status Change:**
```typescript
async function updateCellStatus(id: string, status: 'blocked', blocker_id: string, reason: string) {
  await db.execute(`UPDATE cells SET status='blocked' WHERE id=?`, [id]);
  await db.execute(`
    INSERT INTO blocked_cells_cache (cell_id, blocked_by_id, reason, blocked_at)
    VALUES (?, ?, ?, ?)
  `, [id, blocker_id, reason, Date.now()]);
}
```

**Query Blockers:**
```sql
SELECT b.id, b.title, bbc.blocked_by_id, b2.title as blocker_title, bbc.reason
FROM cells b
JOIN blocked_cells_cache bbc ON b.id = bbc.cell_id
JOIN cells b2 ON bbc.blocked_by_id = b2.id
WHERE b.status='blocked';
```

**Auto-Unblock When Blocker Closes:**
```typescript
async function closeCell(id: string) {
  await db.execute(`UPDATE cells SET status='closed' WHERE id=?`, [id]);
  
  // Find cells blocked by this one
  const blocked = await db.query(`
    SELECT cell_id FROM blocked_cells_cache WHERE blocked_by_id=?
  `, [id]);
  
  // Unblock them
  for (const row of blocked) {
    await db.execute(`UPDATE cells SET status='open' WHERE id=?`, [row.cell_id]);
    await db.execute(`DELETE FROM blocked_cells_cache WHERE cell_id=?`, [row.cell_id]);
  }
}
```

---

#### 11. File Hotspot Optimization

**Identify High-Contention Files:**
```sql
SELECT path_pattern, COUNT(*) as reservation_count
FROM reservations
GROUP BY path_pattern
HAVING COUNT(*) > 3
ORDER BY reservation_count DESC;
```

**Top Hotspots:**
- `packages/swarm-mail/src/streams/events.ts` - 6 reservations
- `packages/opencode-swarm-plugin/src/index.ts` - 6 reservations

**Refactoring Strategy:**
1. **Split `events.ts`:**
   - `events/types.ts` - Event type definitions
   - `events/emitter.ts` - Event emission logic
   - `events/store.ts` - Event storage (libSQL)
   - `events/queries.ts` - Event queries

2. **Split `index.ts`:**
   - `exports/tools.ts` - Tool exports
   - `exports/schemas.ts` - Schema exports
   - `exports/utils.ts` - Utility exports

**Benefits:**
- Reduces file contention (workers edit different files)
- Improves modularity
- Faster parallel work

---

#### 12. Agent Lifecycle Tracking

**Add Agent Lifecycle Events:**
```typescript
type AgentLifecycleEvent =
  | { type: 'agent_spawned', agent_name: string, parent_agent?: string, task: string }
  | { type: 'agent_shutdown', agent_name: string, reason: 'completed' | 'crashed' | 'timeout' }
  | { type: 'agent_heartbeat', agent_name: string };
```

**Emit Heartbeats:**
```typescript
// Every 5 minutes
setInterval(() => {
  emitEvent({ type: 'agent_heartbeat', agent_name });
}, 5 * 60 * 1000);
```

**Detect Zombie Agents:**
```sql
-- Agents with reservations but no heartbeat in last hour
SELECT DISTINCT r.agent_name, a.last_active_at
FROM reservations r
JOIN agents a ON r.agent_name = a.name
WHERE r.released_at IS NULL
AND a.last_active_at < (strftime('%s', 'now', '-1 hour') * 1000);
```

**Auto-Cleanup:**
```sql
-- Release reservations for zombies
UPDATE reservations
SET released_at = (strftime('%s', 'now') * 1000)
WHERE agent_name IN (
  SELECT DISTINCT r.agent_name
  FROM reservations r
  JOIN agents a ON r.agent_name = a.name
  WHERE r.released_at IS NULL
  AND a.last_active_at < (strftime('%s', 'now', '-1 hour') * 1000)
);
```

---

## Appendix: Monitoring Queries

### Health Check Query (Run Daily)

```sql
SELECT 
  -- Data integrity
  (SELECT COUNT(*) FROM cells WHERE id IS NULL) as null_cell_ids,
  (SELECT COUNT(*) FROM message_recipients mr 
   WHERE NOT EXISTS (SELECT 1 FROM agents WHERE name = mr.agent_name)) as orphaned_recipients,
  (SELECT COUNT(*) FROM messages m 
   WHERE NOT EXISTS (SELECT 1 FROM message_recipients WHERE message_id = m.id)) as orphaned_messages,
  (SELECT COUNT(*) FROM reservations 
   WHERE expires_at < (strftime('%s', 'now') * 1000) AND released_at IS NULL) as stale_reservations,
  
  -- Activity metrics
  (SELECT COUNT(*) FROM cells WHERE status='open') as open_cells,
  (SELECT COUNT(*) FROM cells WHERE status='blocked') as blocked_cells,
  (SELECT COUNT(*) FROM reservations WHERE released_at IS NULL) as active_reservations,
  
  -- Quality metrics
  (SELECT COUNT(*) FROM events WHERE type='coordinator_violation' 
   AND timestamp > (strftime('%s', 'now', '-7 days') * 1000)) as violations_7d,
  (SELECT COUNT(*) FROM eval_records WHERE overall_success=1) as successful_evals,
  (SELECT COUNT(*) FROM eval_records) as total_evals;
```

**Expected Healthy Values:**
```
null_cell_ids: 0
orphaned_recipients: 0
orphaned_messages: 0
stale_reservations: <10
open_cells: <300
blocked_cells: <5
active_reservations: <30
violations_7d: <200 (trending down)
successful_evals / total_evals: >50%
```

---

### Performance Monitoring (Run Weekly)

```sql
-- Decomposition success rate by strategy
SELECT strategy, 
       COUNT(*) as total,
       SUM(CASE WHEN overall_success=1 THEN 1 ELSE 0 END) as successes,
       ROUND(100.0 * SUM(CASE WHEN overall_success=1 THEN 1 ELSE 0 END) / COUNT(*), 2) as success_rate
FROM eval_records
WHERE created_at > (strftime('%s', 'now', '-7 days') * 1000)
GROUP BY strategy;

-- File hotspots (top 10)
SELECT path_pattern, COUNT(*) as reservation_count, AVG(released_at - created_at) as avg_hold_time_ms
FROM reservations
WHERE created_at > (strftime('%s', 'now', '-7 days') * 1000)
GROUP BY path_pattern
ORDER BY reservation_count DESC
LIMIT 10;

-- Coordinator violation trend
SELECT date(timestamp/1000, 'unixepoch') as date, COUNT(*) as violations
FROM events
WHERE type='coordinator_violation'
AND timestamp > (strftime('%s', 'now', '-14 days') * 1000)
GROUP BY date
ORDER BY date DESC;
```

---

### Activity Dashboard (Run on Demand)

```sql
-- Current active work
SELECT a.name as agent, b.title as task, b.status, r.path_pattern as file
FROM agents a
LEFT JOIN reservations r ON a.name = r.agent_name AND r.released_at IS NULL
LEFT JOIN cells b ON b.status='in_progress'
WHERE a.last_active_at > (strftime('%s', 'now', '-1 hour') * 1000)
ORDER BY a.last_active_at DESC;

-- Recent completions
SELECT b.title, b.closed_at, b.priority, b.type
FROM cells b
WHERE b.status='closed'
AND b.closed_at > (strftime('%s', 'now', '-24 hours') * 1000)
ORDER BY b.closed_at DESC;

-- Communication activity
SELECT m.subject, m.from_agent, m.importance, m.created_at
FROM messages m
WHERE m.created_at > (strftime('%s', 'now', '-24 hours') * 1000)
ORDER BY m.created_at DESC
LIMIT 20;
```

---

## Summary & Next Steps

### Current State

**Database Health:** ⚠️ **MODERATE** (significant integrity issues post-migration, but core data intact)  
**System Performance:** ⚠️ **MODERATE** (good throughput, but high violation rate and low decomposition success)  
**Data Quality:** 🔴 **POOR** (427 NULL IDs, 208 orphaned refs, 213 stale locks)  
**Coordination Effectiveness:** 🟡 **FAIR** (19.6% violations, 13.8% success rate)

### Immediate Priorities (This Week)

1. ✅ **Execute SQL cleanup scripts** (fixes 650+ integrity issues)
2. ✅ **Implement TTL-based reservation cleanup** (prevents zombie locks)
3. ✅ **Fix eval duration tracking** (enables accurate performance metrics)
4. ✅ **Reduce coordinator violations** (stronger guardrails + pre-flight checks)
5. ✅ **Enforce review protocol** (0% skipped reviews)
6. ✅ **Multi-strategy decomposition testing** (find optimal strategy)

### Success Metrics (30-Day Goals)

| Metric | Current | Target | Status |
|--------|---------|--------|--------|
| NULL cell IDs | 427 | 0 | 🔴 |
| Stale Reservations | 213 | <10 | 🔴 |
| Coordinator Violations | 19.6% | <10% | 🟡 |
| Decomposition Success | 13.8% | >50% | 🔴 |
| Workers Skip Review | 10.9% | 0% | 🟡 |
| Blocked Cells | 2 | <5 | 🟢 |
| Open Cell Backlog | 221 | <150 | 🟡 |

---

**Report Status:** ✅ Complete  
**Next Review:** 2026-01-07 (1 week post-cleanup)  
**Owner:** Swarm Coordination Team

