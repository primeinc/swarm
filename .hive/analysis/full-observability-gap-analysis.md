# Full Observability Gap Analysis

```
    ╔══════════════════════════════════════════════════════════════════╗
    ║                                                                  ║
    ║     🔭  OBSERVABILITY GAP ANALYSIS  🔭                           ║
    ║                                                                  ║
    ║     "If it's not in the event log, it didn't happen."           ║
    ║                                                                  ║
    ╚══════════════════════════════════════════════════════════════════╝
```

## Current State

### Events We HAVE (defined in events.ts)

| Category | Event Type | Emitted? | Dashboard? |
|----------|-----------|----------|------------|
| **Agent** | `agent_registered` | ✅ | ✅ |
| **Agent** | `agent_active` | ✅ | ✅ |
| **Messages** | `message_sent` | ✅ | ✅ |
| **Messages** | `message_read` | ✅ | ❌ |
| **Messages** | `message_acked` | ✅ | ❌ |
| **Messages** | `thread_created` | ✅ | ❌ |
| **Messages** | `thread_activity` | ✅ | ❌ |
| **Files** | `file_reserved` | ✅ | ✅ |
| **Files** | `file_released` | ✅ | ✅ |
| **Files** | `file_conflict` | ❌ | ❌ |
| **Tasks** | `task_started` | ❌ | ✅ |
| **Tasks** | `task_progress` | ❌ | ✅ |
| **Tasks** | `task_completed` | ❌ | ✅ |
| **Tasks** | `task_blocked` | ❌ | ✅ |
| **Swarm** | `decomposition_generated` | ✅ | ✅ |
| **Swarm** | `subtask_outcome` | ✅ | ✅ |
| **Swarm** | `human_feedback` | ❌ | ✅ |
| **Swarm** | `swarm_started` | ✅ | ✅ |
| **Swarm** | `worker_spawned` | ✅ | ✅ |
| **Swarm** | `worker_completed` | ❌ | ✅ |
| **Swarm** | `review_started` | ✅ | ✅ |
| **Swarm** | `review_completed` | ✅ | ✅ |
| **Swarm** | `swarm_completed` | ✅ | ✅ |
| **Checkpoint** | `swarm_checkpointed` | ✅ | ✅ |
| **Checkpoint** | `swarm_recovered` | ❌ | ✅ |
| **Checkpoint** | `checkpoint_created` | ❌ | ❌ |
| **Checkpoint** | `context_compacted` | ❌ | ❌ |
| **Validation** | `validation_started` | ❌ | ❌ |
| **Validation** | `validation_issue` | ❌ | ❌ |
| **Validation** | `validation_completed` | ❌ | ❌ |

### Events We NEED (not yet defined)

| Category | Event Type | Purpose |
|----------|-----------|---------|
| **Memory** | `memory_stored` | When semantic-memory_store is called |
| **Memory** | `memory_found` | When semantic-memory_find returns results |
| **Memory** | `memory_updated` | When smart upsert updates existing memory |
| **Memory** | `memory_linked` | When memories are linked (Zettelkasten) |
| **Memory** | `memory_validated` | When memory is validated (decay reset) |
| **Memory** | `memory_deleted` | When memory is removed |
| **CASS** | `cass_searched` | When cass_search is called |
| **CASS** | `cass_viewed` | When cass_view is called |
| **CASS** | `cass_indexed` | When cass_index completes |
| **Skills** | `skill_loaded` | When skills_use is called |
| **Skills** | `skill_created` | When skills_create is called |
| **Hive** | `cell_created` | When hive_create is called |
| **Hive** | `cell_updated` | When hive_update is called |
| **Hive** | `cell_status_changed` | When status changes |
| **Hive** | `cell_closed` | When hive_close is called |
| **Hive** | `epic_created` | When hive_create_epic is called |
| **Hive** | `hive_synced` | When hive_sync completes |
| **Decision** | `decision_recorded` | When decision trace is stored |
| **Decision** | `precedent_cited` | When past decision is referenced |
| **Compaction** | `compaction_triggered` | When compaction hook fires |
| **Compaction** | `swarm_detected` | When swarm signature found |
| **Compaction** | `context_injected` | When swarm context added |

---

## Gap 1: Missing Event Emissions

### Tools NOT emitting events

```typescript
// These tools should emit events but don't:

// Hive tools
hive_create()      // → cell_created
hive_update()      // → cell_updated  
hive_start()       // → cell_status_changed (open → in_progress)
hive_close()       // → cell_closed (partial - only emits swarm_completed for epics)
hive_sync()        // → hive_synced

// Memory tools
semantic-memory_store()    // → memory_stored
semantic-memory_find()     // → memory_found
semantic-memory_validate() // → memory_validated
semantic-memory_remove()   // → memory_deleted

// CASS tools
cass_search()  // → cass_searched
cass_view()    // → cass_viewed
cass_index()   // → cass_indexed

// Skills tools
skills_use()    // → skill_loaded
skills_create() // → skill_created

// Swarm tools (partial)
swarm_complete()  // → worker_completed (MISSING - only emits subtask_outcome)
swarm_progress()  // → task_progress (MISSING)
```

### Fix: Add appendEvent calls

```typescript
// Example: hive_create should emit
const event = createEvent("cell_created", {
  cell_id: result.id,
  title: args.title,
  description: args.description,
  issue_type: args.type,
  priority: args.priority,
  parent_id: args.parent_id,
  created_by: agentName,
});
await appendEvent(event, projectKey);
```

---

## Gap 2: Missing Event Types

### New schemas needed in events.ts

```typescript
// Memory Events
export const MemoryStoredEventSchema = BaseEventSchema.extend({
  type: z.literal("memory_stored"),
  memory_id: z.string(),
  content_preview: z.string(), // First 100 chars
  tags: z.array(z.string()),
  auto_tagged: z.boolean(),
  collection: z.string().optional(),
  embedding_model: z.string().optional(),
});

export const MemoryFoundEventSchema = BaseEventSchema.extend({
  type: z.literal("memory_found"),
  query: z.string(),
  result_count: z.number().int().min(0),
  top_score: z.number().min(0).max(1).optional(),
  search_duration_ms: z.number().int().min(0),
  used_fts: z.boolean(),
});

export const MemoryUpdatedEventSchema = BaseEventSchema.extend({
  type: z.literal("memory_updated"),
  memory_id: z.string(),
  operation: z.enum(["ADD", "UPDATE", "DELETE", "NOOP"]),
  reason: z.string().optional(),
  supersedes_id: z.string().optional(),
});

export const MemoryLinkedEventSchema = BaseEventSchema.extend({
  type: z.literal("memory_linked"),
  source_id: z.string(),
  target_id: z.string(),
  link_type: z.string(),
  strength: z.number().min(0).max(1),
});

// CASS Events
export const CassSearchedEventSchema = BaseEventSchema.extend({
  type: z.literal("cass_searched"),
  query: z.string(),
  agent_filter: z.string().optional(),
  days_filter: z.number().optional(),
  result_count: z.number().int().min(0),
  search_duration_ms: z.number().int().min(0),
});

export const CassViewedEventSchema = BaseEventSchema.extend({
  type: z.literal("cass_viewed"),
  session_path: z.string(),
  line_number: z.number().int().optional(),
  agent_type: z.string(),
});

// Skills Events
export const SkillLoadedEventSchema = BaseEventSchema.extend({
  type: z.literal("skill_loaded"),
  skill_name: z.string(),
  skill_source: z.enum(["global", "project", "bundled"]),
  context_provided: z.boolean(),
  content_length: z.number().int().min(0),
});

// Decision Trace Events
export const DecisionRecordedEventSchema = BaseEventSchema.extend({
  type: z.literal("decision_recorded"),
  decision_id: z.string(),
  decision_type: z.string(),
  epic_id: z.string().optional(),
  cell_id: z.string().optional(),
  rationale_length: z.number().int().min(0),
  precedent_count: z.number().int().min(0),
});

// Compaction Events
export const CompactionTriggeredEventSchema = BaseEventSchema.extend({
  type: z.literal("compaction_triggered"),
  session_id: z.string(),
  trigger: z.enum(["auto", "manual", "context_limit"]),
  context_size_before: z.number().int().min(0).optional(),
});

export const SwarmDetectedEventSchema = BaseEventSchema.extend({
  type: z.literal("swarm_detected"),
  session_id: z.string(),
  confidence: z.enum(["high", "medium", "low", "none"]),
  detection_source: z.enum(["projection", "hive_query", "fallback"]),
  epic_id: z.string().optional(),
  subtask_count: z.number().int().min(0).optional(),
  reasons: z.array(z.string()),
});

export const ContextInjectedEventSchema = BaseEventSchema.extend({
  type: z.literal("context_injected"),
  session_id: z.string(),
  context_type: z.enum(["llm_generated", "static_swarm_context", "detection_fallback"]),
  content_length: z.number().int().min(0),
  injection_method: z.enum(["output.prompt", "output.context.push"]),
});
```

---

## Gap 3: Dashboard Not Displaying All Events

### Events defined but not rendered

The dashboard has types for these but may not render them distinctly:

- `message_read` / `message_acked` - Show in message thread view
- `thread_created` / `thread_activity` - Show thread lifecycle
- `file_conflict` - Show conflict resolution
- `checkpoint_created` / `context_compacted` - Show compaction activity
- `validation_*` - Show validation results

### Dashboard improvements needed

1. **Event type icons** - Distinct icons for each event category
2. **Event filtering** - Filter by type, agent, epic
3. **Timeline view** - Gantt-style view of swarm lifecycle
4. **Memory pane** - Show memory operations
5. **CASS pane** - Show cross-agent searches
6. **Decision trace pane** - Show decision rationale

---

## Implementation Plan

### Phase 1: Emit Missing Events (Priority: HIGH)

1. Add `appendEvent` calls to all hive tools
2. Add `appendEvent` calls to all memory tools
3. Add `appendEvent` calls to swarm_complete (worker_completed)
4. Add `appendEvent` calls to swarm_progress (task_progress)

### Phase 2: Add New Event Types (Priority: HIGH)

1. Add Memory event schemas
2. Add CASS event schemas
3. Add Skills event schemas
4. Add Decision trace event schemas
5. Add Compaction event schemas
6. Update dashboard types.ts to match

### Phase 3: Dashboard Enhancements (Priority: MEDIUM)

1. Add event type icons and colors
2. Add filtering by event type
3. Add memory operations pane
4. Add decision trace pane
5. Add timeline/Gantt view

### Phase 4: Validation (Priority: LOW)

1. Add validation events emission
2. Add validation pane to dashboard
3. Add schema validation on event emission

---

## Event Emission Checklist

### For each tool, ensure:

```typescript
// 1. Import at top of file
import { createEvent, appendEvent } from "swarm-mail";

// 2. Create event with all relevant fields
const event = createEvent("event_type", {
  // Required fields
  project_key: projectKey,
  timestamp: Date.now(),
  // Event-specific fields
  ...eventData,
});

// 3. Append event (with error handling)
try {
  await appendEvent(event, projectKey);
} catch (error) {
  console.warn(`[tool_name] Failed to emit ${event.type}:`, error);
  // Don't throw - event emission should not break tool execution
}
```

---

## Dashboard Event Display

### Event Row Component Enhancement

```tsx
// EventRow.tsx - Add icons and colors per event type
const EVENT_ICONS: Record<string, string> = {
  // Agent
  agent_registered: "👤",
  agent_active: "🟢",
  
  // Messages
  message_sent: "📨",
  message_read: "👁️",
  message_acked: "✅",
  
  // Files
  file_reserved: "🔒",
  file_released: "🔓",
  file_conflict: "⚠️",
  
  // Swarm
  swarm_started: "🐝",
  worker_spawned: "🚀",
  worker_completed: "✨",
  review_started: "🔍",
  review_completed: "📋",
  swarm_completed: "🎉",
  
  // Memory
  memory_stored: "💾",
  memory_found: "🔎",
  memory_updated: "📝",
  memory_linked: "🔗",
  
  // CASS
  cass_searched: "🔍",
  cass_viewed: "👀",
  
  // Skills
  skill_loaded: "📚",
  
  // Decisions
  decision_recorded: "⚖️",
  
  // Compaction
  compaction_triggered: "📦",
  swarm_detected: "🎯",
  context_injected: "💉",
};

const EVENT_COLORS: Record<string, string> = {
  // Success events - green
  worker_completed: "text-green-500",
  review_completed: "text-green-500",
  swarm_completed: "text-green-500",
  
  // Warning events - yellow
  file_conflict: "text-yellow-500",
  task_blocked: "text-yellow-500",
  
  // Error events - red
  // (none currently, but validation_issue would be)
  
  // Info events - blue
  swarm_started: "text-blue-500",
  worker_spawned: "text-blue-500",
  
  // Memory events - purple
  memory_stored: "text-purple-500",
  memory_found: "text-purple-500",
};
```

---

## Success Criteria

When complete, the dashboard should show:

1. **Full swarm lifecycle** - From `/swarm` to epic close
2. **All agent communication** - Messages, threads, acks
3. **File coordination** - Reservations, releases, conflicts
4. **Memory operations** - Store, find, link, validate
5. **CASS queries** - Cross-agent searches
6. **Skill loading** - Which skills were used
7. **Decision traces** - Why decisions were made
8. **Compaction events** - When and how context was compressed

```
           🔭
         /   \
        | o o |  "Now we can see EVERYTHING."
         \   /
          | |
         _| |_
        /     \
       |  📊   |
        \_____/
```
