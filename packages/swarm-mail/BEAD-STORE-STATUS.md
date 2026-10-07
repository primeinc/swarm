# cell Event Store Integration Status

## Completed (75%)

### Files Created

1. **packages/swarm-mail/src/cells/store.ts** (336 lines)
   - `appendcellEvent()` - Appends cell events to shared events table
   - `readcellEvents()` - Reads cell events with filters (projectKey, cellId, types, timestamp, pagination)
   - `replaycellEvents()` - Rebuilds projections from events (for recovery/debugging)
   - Follows streams/store.ts pattern exactly

2. **packages/swarm-mail/src/cells/events.ts** (215 lines)
   - Type definitions for all 20 cell event types
   - Avoids cross-package TypeScript imports (monorepo rootDir constraint)
   - Matches cell-events.ts from opencode-swarm-plugin but as pure TypeScript

3. **packages/swarm-mail/src/cells/store.test.ts** (16 test cases)
   - Tests for appendcellEvent (8 event types covered)
   - Tests for readcellEvents (filters, pagination)
   - Tests for replaycellEvents (rebuild, clear, fromSequence)
   - **NEEDS FIX**: Schema initialization - tests manually run migrations but don't call initializeSchema()

4. **packages/swarm-mail/src/cells/index.ts**
   - Exports all store operations, event types, projections
   - Ready for consumption by other packages

## Remaining Work (25%)

### 1. Fix Test Schema Initialization

**Problem**: Tests fail with "relation 'events' does not exist"

**Root Cause**: Tests manually call `runMigrations(pglite)` which only runs numbered migrations (1-5 for Effect primitives, 6 for cells tables). The core `events` table is created by `initializeSchema()` in streams/index.ts, not migrations.

**Solution Options**:
- **Option A** (Recommended): Change tests to use `getDatabase()` instead of manually creating PGLite
  ```typescript
  const db = await getDatabase();
  ```

- **Option B**: Manually call `initializeSchema()` before running cells migration
  ```typescript
  import { initializeSchema } from "../streams/index.js"; // need to export it
  await initializeSchema(pglite);
  await runMigrations(pglite);
  await pglite.exec(cellsMigration.up);
  ```

### 2. Implement cells/adapter.ts

Create adapter factory function following streams/adapter.ts pattern:

```typescript
export function createcellsAdapter(
  db: DatabaseAdapter,
  projectKey: string
): cellsAdapter {
  return {
    // cell CRUD
    async createcell(projectKey, options) {
      const event = createcellEvent("cell_created", { ... });
      await appendcellEvent(event, undefined, db);
      return await getcell(db, projectKey, event.cell_id);
    },
    
    async getcell(projectKey, cellId) {
      return getcell(db, projectKey, cellId);
    },
    
    async querycells(projectKey, options) {
      return querycells(db, projectKey, options);
    },
    
    // ... implement all cellsAdapter interface methods
    
    // Delegate to store.ts for events
    // Delegate to projections.ts for queries
  };
}
```

### 3. Create cells/adapter.test.ts

Test the adapter factory - should be simpler than store tests since it delegates to tested functions.

## Key Learnings

1. **Cross-Package TypeScript Imports Fail in Monorepos**
   - Error: "File ... is not under 'rootDir'"
   - Solution: Duplicate type definitions in consuming package
   - See: cells/events.ts (duplicates cell-events.ts types)

2. **PGLite Schema Split**
   - Core tables (events, agents, messages, reservations): `initializeSchema()`
   - Additional tables (Effect primitives, cells): Numbered migrations
   - Tests must initialize both

3. **Projection Update Type Mismatch**
   - Store has typed cellEvent union
   - Projections expect loose type with index signature
   - Solution: Cast to `any` when calling `updateProjections()`

## Next Steps for Agent

1. Run `bun test packages/swarm-mail/src/cells/store.test.ts` - should pass after schema fix
2. Implement `createcellsAdapter` factory
3. Add adapter tests
4. Update parent cell (opencode-swarm-plugin-it2ke.18) with completion status
