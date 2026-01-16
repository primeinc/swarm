# Bead Event Store Integration Status

## Completed (75%)

### Files Created

1. **packages/swarm-mail/src/beads/store.ts** (336 lines)
   - `appendBeadEvent()` - Appends bead events to shared events table
   - `readBeadEvents()` - Reads bead events with filters (projectKey, beadId, types, timestamp, pagination)
   - `replayBeadEvents()` - Rebuilds projections from events (for recovery/debugging)
   - Follows streams/store.ts pattern exactly

2. **packages/swarm-mail/src/beads/events.ts** (215 lines)
   - Type definitions for all 20 bead event types
   - Avoids cross-package TypeScript imports (monorepo rootDir constraint)
   - Matches bead-events.ts from opencode-swarm-plugin but as pure TypeScript

3. **packages/swarm-mail/src/beads/store.test.ts** (16 test cases)
   - Tests for appendBeadEvent (8 event types covered)
   - Tests for readBeadEvents (filters, pagination)
   - Tests for replayBeadEvents (rebuild, clear, fromSequence)
   - **NEEDS FIX**: Schema initialization - tests manually run migrations but don't call initializeSchema()

4. **packages/swarm-mail/src/beads/index.ts**
   - Exports all store operations, event types, projections
   - Ready for consumption by other packages

## Remaining Work (25%)

### 1. Fix Test Schema Initialization

**Problem**: Tests fail with "relation 'events' does not exist"

**Root Cause**: Tests manually call `runMigrations(pglite)` which only runs numbered migrations (1-5 for Effect primitives, 6 for beads tables). The core `events` table is created by `initializeSchema()` in streams/index.ts, not migrations.

**Solution Options**:
- **Option A** (Recommended): Change tests to use `getDatabase()` instead of manually creating PGLite
  ```typescript
  const db = await getDatabase();
  ```

- **Option B**: Manually call `initializeSchema()` before running beads migration
  ```typescript
  import { initializeSchema } from "../streams/index.js"; // need to export it
  await initializeSchema(pglite);
  await runMigrations(pglite);
  await pglite.exec(beadsMigration.up);
  ```

### 2. Implement beads/adapter.ts

Create adapter factory function following streams/adapter.ts pattern:

```typescript
export function createBeadsAdapter(
  db: DatabaseAdapter,
  projectKey: string
): BeadsAdapter {
  return {
    // Bead CRUD
    async createBead(projectKey, options) {
      const event = createBeadEvent("bead_created", { ... });
      await appendBeadEvent(event, undefined, db);
      return await getBead(db, projectKey, event.cell_id);
    },
    
    async getBead(projectKey, beadId) {
      return getBead(db, projectKey, beadId);
    },
    
    async queryBeads(projectKey, options) {
      return queryBeads(db, projectKey, options);
    },
    
    // ... implement all BeadsAdapter interface methods
    
    // Delegate to store.ts for events
    // Delegate to projections.ts for queries
  };
}
```

### 3. Create beads/adapter.test.ts

Test the adapter factory - should be simpler than store tests since it delegates to tested functions.

## Key Learnings

1. **Cross-Package TypeScript Imports Fail in Monorepos**
   - Error: "File ... is not under 'rootDir'"
   - Solution: Duplicate type definitions in consuming package
   - See: beads/events.ts (duplicates bead-events.ts types)

2. **PGLite Schema Split**
   - Core tables (events, agents, messages, reservations): `initializeSchema()`
   - Additional tables (Effect primitives, beads): Numbered migrations
   - Tests must initialize both

3. **Projection Update Type Mismatch**
   - Store has typed BeadEvent union
   - Projections expect loose type with index signature
   - Solution: Cast to `any` when calling `updateProjections()`

## Next Steps for Agent

1. Run `bun test packages/swarm-mail/src/beads/store.test.ts` - should pass after schema fix
2. Implement `createBeadsAdapter` factory
3. Add adapter tests
4. Update parent bead (opencode-swarm-plugin-it2ke.18) with completion status
