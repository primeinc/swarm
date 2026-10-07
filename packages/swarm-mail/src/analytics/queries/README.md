# Pre-built Analytics Queries

Ready-to-use SQL queries for swarm coordination metrics.

## Available Queries

### 1-5: Queries Implemented in Previous Task

1. **agent-activity** - Track active agents and task assignments
2. **failed-decompositions** - Identify failed decomposition patterns
3. **lock-contention** - Measure file lock contention
4. **message-latency** - Analyze inter-agent message latency
5. **strategy-success-rates** - Compare decomposition strategy effectiveness

### 6-10: Queries Implemented in This Task

6. **scope-violations** - Files touched outside owned scope
7. **task-duration** - p50/p95/p99 task durations
8. **checkpoint-frequency** - How often agents checkpoint
9. **recovery-success** - Recovery success rate
10. **human-feedback** - Approval/rejection breakdown

## Usage

### Basic Query Execution

```typescript
import { getSwarmMailLibSQL } from "swarm-mail";
import { scopeViolations } from "swarm-mail/analytics/queries";

const adapter = await getSwarmMailLibSQL("/path/to/project");
const db = await adapter.getDatabase();

// Execute query
const result = await db.query(scopeViolations.sql);

// result.rows contains the data
console.log(result.rows);
```

### With Filters (Project-Specific)

All queries support optional `buildQuery()` for filtering by `project_key`:

```typescript
import { taskDuration } from "swarm-mail/analytics/queries";

// Filter to specific project
const filtered = taskDuration.buildQuery({ 
  project_key: "my-project" 
});

const result = await db.query(
  filtered.sql, 
  Object.values(filtered.parameters || {})
);
```

### Formatting Results

Use the analytics formatters to display results:

```typescript
import { formatTable, formatJSON, formatCSV } from "swarm-mail/analytics";

// ASCII table (for CLI output)
console.log(formatTable(result));

// JSON (for APIs)
console.log(formatJSON(result));

// CSV (for spreadsheets)
console.log(formatCSV(result));
```

## Query Details

### scope-violations

**What:** Files touched outside owned scope  
**Why:** Detect agents modifying files they weren't assigned  
**Data:** Extracts `files_touched` from `task_completed` events

**Returns:**
- `agent`: Agent name
- `task_id`: cell ID
- `files_touched`: JSON array of file paths
- `timestamp`: When completed
- `project_key`: Project identifier

### task-duration

**What:** p50/p95/p99 task durations  
**Why:** Measure task completion time distribution  
**Data:** Joins `task_started` and `task_completed` events, calculates percentiles

**Returns:**
- `p50_ms`: Median duration (milliseconds)
- `p95_ms`: 95th percentile duration
- `p99_ms`: 99th percentile duration
- `total_tasks`: Number of completed tasks

**Note:** Uses window functions to approximate percentiles (libSQL doesn't have `percentile_cont`).

### checkpoint-frequency

**What:** How often agents checkpoint  
**Why:** Understand checkpoint adoption patterns  
**Data:** Counts `checkpoint_created` events by agent

**Returns:**
- `agent`: Agent name
- `checkpoint_count`: Total checkpoints created
- `first_checkpoint`: First checkpoint timestamp
- `last_checkpoint`: Most recent checkpoint timestamp
- `avg_interval_ms`: Average time between checkpoints

### recovery-success

**What:** Recovery success rate  
**Why:** Track deferred task resolution effectiveness  
**Data:** Counts `deferred_resolved` vs `deferred_rejected` events

**Returns:**
- `resolved_count`: Successfully resolved deferrals
- `rejected_count`: Failed deferrals
- `total_count`: Total deferred events
- `success_rate_pct`: Percentage resolved successfully

### human-feedback

**What:** Approval/rejection breakdown  
**Why:** Measure quality control patterns  
**Data:** Groups `review_feedback` events by status

**Returns:**
- `status`: "approved" or "needs_changes"
- `count`: Number of reviews with this status
- `percentage`: Percentage of total reviews

## Implementation Notes

### Event Schema

All queries operate on the `events` table:

```sql
CREATE TABLE events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,
  project_key TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  data TEXT NOT NULL,  -- JSON string
  created_at TEXT DEFAULT (datetime('now'))
)
```

### JSON Extraction

libSQL stores JSON as TEXT. Use `json_extract()` to access fields:

```sql
json_extract(data, '$.agent_name')  -- Extract top-level field
json_extract(data, '$.files[0]')    -- Extract array element
```

### Percentile Approximation

libSQL lacks native percentile functions. We approximate using:

```sql
WITH ordered AS (
  SELECT 
    value,
    ROW_NUMBER() OVER (ORDER BY value) as row_num,
    COUNT(*) OVER () as total
  FROM data
)
SELECT value 
FROM ordered 
WHERE row_num = CAST(total * 0.95 AS INTEGER)
```

This gives the value closest to the 95th percentile position.

## Testing

All queries have comprehensive tests in `queries-6-10.test.ts`:

```bash
# Run tests
bun test src/analytics/queries/queries-6-10.test.ts

# Watch mode
bun test --watch src/analytics/queries/queries-6-10.test.ts
```

Tests verify:
- Required AnalyticsQuery fields (name, description, sql)
- SQL structure (SELECT/FROM clauses, event types)
- Optional filter support (buildQuery method)
- Valid SQL syntax

## Extending

To add a new query:

1. **Create query file** (`my-query.ts`)
2. **Export AnalyticsQuery** with `name`, `description`, `sql`
3. **Add optional buildQuery** for filtering
4. **Write tests** in `queries-X-Y.test.ts`
5. **Export from index.ts**

Example:

```typescript
// my-query.ts
import type { AnalyticsQuery } from "../types.js";

export const myQuery: AnalyticsQuery & {
  buildQuery?: (filters: { project_key?: string }) => AnalyticsQuery;
} = {
  name: "my-query",
  description: "What this query does",
  sql: `
    SELECT column
    FROM events
    WHERE type = 'event_type'
  `,
  buildQuery: (filters) => {
    if (filters.project_key) {
      return {
        ...myQuery,
        sql: `${myQuery.sql} AND project_key = ?`,
        parameters: { 0: filters.project_key },
      };
    }
    return myQuery;
  },
};
```
