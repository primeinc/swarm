# ADR-003: Performance Improvements via Live Queries and Batching

## Status

Proposed

## Context

Current Swarm Mail implementation uses polling for real-time updates, which is inefficient:

- `getInbox()` polls every 500ms to detect new messages
- File reservation conflicts checked via repeated queries
- High CPU usage in background polling loops
- Latency: 250-500ms average between event and notification

Research shows PGLite provides two superior alternatives to polling:

1. **LISTEN/NOTIFY** - PostgreSQL pub/sub via `pg.listen()` and `pg.unlisten()`
2. **Live Queries** - Incremental query results via `live.incrementalQuery()` (RECOMMENDED)

Additionally, batch operations can reduce transaction overhead:

- Current: Individual transactions per message (N transactions)
- Improved: Batched inserts via `.transaction()` or `.exec()` (1 transaction)

## Decision

### Replace Polling with Live Queries

**Why Live Queries over LISTEN/NOTIFY:**

- Simpler API - returns incremental result sets automatically
- No manual query re-execution needed
- Built-in change detection
- Works with existing SQL queries

**Implementation:**

```typescript
// Before (polling):
async function watchInbox(
  agentName: string,
  callback: (messages: Message[]) => void,
) {
  const interval = setInterval(async () => {
    const messages = await getInbox(agentName, { limit: 5 });
    callback(messages);
  }, 500);
  return () => clearInterval(interval);
}

// After (live query):
import { live } from "@electric-sql/pglite/live";

async function watchInbox(
  agentName: string,
  callback: (messages: Message[]) => void,
) {
  const liveQuery = await db.live.incrementalQuery(
    `SELECT id, sender, subject, importance, received_at 
     FROM messages 
     WHERE recipient = $1 AND read_at IS NULL
     ORDER BY importance DESC, received_at DESC
     LIMIT 5`,
    [agentName],
  );

  liveQuery.subscribe(({ rows }) => {
    callback(rows as Message[]);
  });

  return () => liveQuery.unsubscribe();
}
```

**Projection Updates:**

```typescript
// Watch for new events in real-time
const liveEvents = await db.live.incrementalQuery(
  `SELECT * FROM events WHERE sequence > $1 ORDER BY sequence ASC`,
  [lastProcessedSequence],
);

liveEvents.subscribe(({ rows }) => {
  rows.forEach((event) => updateProjection(event));
});
```

### Batch Operations for Multi-Insert

**Use `.transaction()` for Multiple Related Operations:**

```typescript
// Before: N transactions
for (const message of messages) {
  await sendMessage(message); // 1 transaction each
}

// After: 1 transaction
await db.transaction(async (tx) => {
  for (const message of messages) {
    await tx.query(
      `INSERT INTO messages (sender, recipient, subject, body) VALUES ($1, $2, $3, $4)`,
      [message.sender, message.recipient, message.subject, message.body],
    );
  }
});
```

**Use `.exec()` for Batch SQL:**

```typescript
// Atomic multi-statement execution
await db.exec(`
  BEGIN;
  INSERT INTO messages (sender, recipient, subject) VALUES ('Alice', 'Bob', 'Test 1');
  INSERT INTO messages (sender, recipient, subject) VALUES ('Alice', 'Bob', 'Test 2');
  INSERT INTO messages (sender, recipient, subject) VALUES ('Alice', 'Bob', 'Test 3');
  COMMIT;
`);
```

### Connection Pooling Decision

**NOT NEEDED for PGLite:**

- PGLite runs in-process (WASM embedded database)
- Single-user design (no concurrent connections)
- Connection pooling is for client-server PostgreSQL
- Would add unnecessary complexity

## Consequences

### Easier

- **Real-time updates** - Sub-millisecond latency for new messages/events
- **Lower CPU usage** - No background polling loops
- **Fewer queries** - Live queries push changes, don't pull
- **Atomic batches** - Multi-message sends in 1 transaction
- **Simplified code** - No interval management, cleanup handled by unsubscribe

### More Difficult

- **Subscription management** - Must track and unsubscribe live queries
- **Memory usage** - Live queries hold result sets in memory
- **Testing complexity** - Async subscriptions harder to test than sync polls
- **Debugging** - Push-based updates less visible in logs

### Performance Impact (Estimated)

| Metric               | Before (Polling) | After (Live Queries)    | Improvement     |
| -------------------- | ---------------- | ----------------------- | --------------- |
| Notification latency | 250-500ms        | <10ms                   | 25-50x faster   |
| CPU usage (idle)     | 5-10% (polling)  | <1% (event-driven)      | 5-10x reduction |
| Queries per second   | 2-4 (polling)    | 0 (push)                | Eliminated      |
| Transaction overhead | N (individual)   | 1 (batched)             | N speedup       |
| Memory usage         | Low              | Medium (result caching) | +10-20%         |

### Risks & Mitigations

| Risk                              | Impact | Mitigation                                          |
| --------------------------------- | ------ | --------------------------------------------------- |
| Memory leaks from subscriptions   | High   | Enforce unsubscribe in cleanup, add timeout guards  |
| Live queries fail on syntax error | High   | Validate SQL in tests, fallback to polling on error |
| Large result sets in memory       | Medium | Hard limit on LIMIT clause (max 100 rows)           |
| Subscription overhead at scale    | Medium | Pool subscriptions, deduplicate queries             |
| Debugging push updates            | Low    | Add subscription logging, event stream tracing      |

## Implementation Notes

### Phase 1: Live Query Infrastructure (Week 1)

**1.1 Create Live Query Wrapper**

```typescript
// src/streams/live-query.ts
import { live } from "@electric-sql/pglite/live";
import type { PGlite } from "@electric-sql/pglite";

interface LiveQueryOptions<T> {
  db: PGlite;
  query: string;
  params: unknown[];
  onUpdate: (rows: T[]) => void;
  onError?: (error: Error) => void;
}

export async function createLiveQuery<T>(options: LiveQueryOptions<T>) {
  const { db, query, params, onUpdate, onError } = options;

  try {
    const liveQuery = await db.live.incrementalQuery(query, params);

    const unsubscribe = liveQuery.subscribe({
      next: ({ rows }) => onUpdate(rows as T[]),
      error: onError || ((err) => console.error("Live query error:", err)),
    });

    return {
      unsubscribe,
      refresh: () => liveQuery.refresh(),
    };
  } catch (error) {
    if (onError) onError(error as Error);
    throw error;
  }
}
```

**1.2 Add Cleanup Tracking**

```typescript
// Track active subscriptions for cleanup
const activeSubscriptions = new Set<() => void>();

export function registerSubscription(unsubscribe: () => void) {
  activeSubscriptions.add(unsubscribe);
}

export function cleanupAllSubscriptions() {
  activeSubscriptions.forEach((unsub) => unsub());
  activeSubscriptions.clear();
}

// Call on shutdown
process.on("SIGTERM", cleanupAllSubscriptions);
```

### Phase 2: Replace Polling (Week 2)

**2.1 Inbox Watching**

```typescript
// src/agent-mail.ts
export async function watchInbox(
  db: PGlite,
  agentName: string,
  callback: (messages: Message[]) => void,
) {
  const { unsubscribe } = await createLiveQuery<Message>({
    db,
    query: `
      SELECT id, sender, subject, importance, received_at 
      FROM messages 
      WHERE recipient = $1 AND read_at IS NULL
      ORDER BY importance DESC, received_at DESC
      LIMIT 5
    `,
    params: [agentName],
    onUpdate: callback,
  });

  registerSubscription(unsubscribe);
  return unsubscribe;
}
```

**2.2 Event Stream Watching**

```typescript
// src/streams/projections.ts
export async function watchEvents(
  db: PGlite,
  fromSequence: number,
  callback: (events: SwarmMailEvent[]) => void,
) {
  const { unsubscribe } = await createLiveQuery<SwarmMailEvent>({
    db,
    query: `SELECT * FROM events WHERE sequence > $1 ORDER BY sequence ASC`,
    params: [fromSequence],
    onUpdate: callback,
  });

  registerSubscription(unsubscribe);
  return unsubscribe;
}
```

**2.3 File Reservation Conflicts**

```typescript
// Watch for conflicts with my reservations
export async function watchReservationConflicts(
  db: PGlite,
  myReservations: string[],
  callback: (conflicts: Conflict[]) => void,
) {
  const { unsubscribe } = await createLiveQuery<Conflict>({
    db,
    query: `
      SELECT r.* FROM file_reservations r
      WHERE r.path_pattern = ANY($1)
      AND r.agent_name != $2
      AND r.expires_at > NOW()
    `,
    params: [myReservations, currentAgent],
    onUpdate: callback,
  });

  return unsubscribe;
}
```

### Phase 3: Batch Operations (Week 3)

**3.1 Batch Message Send**

```typescript
export async function sendMessages(db: PGlite, messages: MessageDraft[]) {
  await db.transaction(async (tx) => {
    for (const msg of messages) {
      await tx.query(
        `INSERT INTO messages (sender, recipient, subject, body, thread_id, importance) 
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          msg.sender,
          msg.recipient,
          msg.subject,
          msg.body,
          msg.thread_id,
          msg.importance,
        ],
      );
    }
  });
}
```

**3.2 Batch Event Append**

```typescript
export async function appendEvents(db: PGlite, events: SwarmMailEvent[]) {
  await db.transaction(async (tx) => {
    for (const event of events) {
      await tx.query(
        `INSERT INTO events (type, data, project_key, timestamp) 
         VALUES ($1, $2, $3, $4)`,
        [
          event.type,
          JSON.stringify(event.data),
          event.projectKey,
          event.timestamp,
        ],
      );
    }
  });
}
```

### Phase 4: Testing & Benchmarks (Week 4)

**4.1 Integration Tests**

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";

describe("Live Queries", () => {
  let unsubscribe: () => void;

  afterEach(() => {
    unsubscribe?.();
  });

  it("notifies on new message", async () => {
    const updates: Message[] = [];

    unsubscribe = await watchInbox(db, "Alice", (messages) => {
      updates.push(...messages);
    });

    await sendMessage(db, { to: "Alice", subject: "Test", body: "Hello" });

    // Wait for async update
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(updates).toHaveLength(1);
    expect(updates[0].subject).toBe("Test");
  });

  it("cleans up on unsubscribe", async () => {
    const updateCount = { count: 0 };

    unsubscribe = await watchInbox(db, "Alice", () => {
      updateCount.count++;
    });

    unsubscribe();

    await sendMessage(db, {
      to: "Alice",
      subject: "After unsubscribe",
      body: "Test",
    });
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(updateCount.count).toBe(0); // Should not increment after unsubscribe
  });
});
```

**4.2 Performance Benchmarks**

```typescript
import { bench, describe } from "vitest";

describe("Batch vs Individual Inserts", () => {
  bench("Individual inserts (N transactions)", async () => {
    for (let i = 0; i < 100; i++) {
      await sendMessage(db, { to: "Bob", subject: `Msg ${i}`, body: "Test" });
    }
  });

  bench("Batch insert (1 transaction)", async () => {
    const messages = Array.from({ length: 100 }, (_, i) => ({
      to: "Bob",
      subject: `Msg ${i}`,
      body: "Test",
    }));
    await sendMessages(db, messages);
  });
});
```

### Success Criteria

- [ ] All polling loops removed from codebase
- [ ] Live queries handle 100+ concurrent watchers without leaks
- [ ] Batch operations 10x faster than individual inserts (benchmark)
- [ ] Notification latency <50ms for new messages (99th percentile)
- [ ] CPU usage <1% in idle state (no polling)
- [ ] Memory usage increase <20% compared to polling
- [ ] Integration tests pass with live queries
- [ ] Cleanup functions properly unsubscribe all watchers

### Migration Path

1. Add live query infrastructure (non-breaking)
2. Feature flag to toggle live queries vs polling (`ENABLE_LIVE_QUERIES=true`)
3. Run both in parallel for 1 week, monitor metrics
4. Default to live queries if metrics are better
5. Remove polling code after 2 weeks of stable live queries
6. Add batch operations (non-breaking performance improvement)

### Fallback Strategy

If live queries prove unstable:

- Keep polling as fallback (`ENABLE_LIVE_QUERIES=false`)
- Add exponential backoff to polling (reduce CPU)
- Consider hybrid: live queries for critical paths, polling for non-critical
