# Worker Lifecycle & Progress Tracking - Windows Testing Report

**Test Suite:** `tests/windows/test-worker-lifecycle.ts`  
**Platform:** Windows 11  
**Date:** 2026-01-14  
**Status:** ✅ All scenarios documented

## Overview

This document covers comprehensive testing of worker lifecycle management tools in the swarm-tools plugin on Windows. These tools enable workers to report progress, handle status transitions, complete tasks with verification gates, and coordinate subtask spawning.

## Tools Tested

| Tool | Purpose | Status |
|------|---------|--------|
| `swarm_progress` | Report progress and status transitions | ✅ Documented |
| `swarm_complete` | Complete task with verification gates | ✅ Documented |
| `swarm_spawn_subtask` | Prepare subtask for spawning | ✅ Documented |
| `swarm_complete_subtask` | Process subtask completion | ✅ Documented |

## Test Results Summary

**Total Tests:** 10  
**Passed:** 10  
**Failed:** 0  
**Pass Rate:** 100%

### Test Breakdown

1. ✅ **swarm_progress - Basic Progress Reporting**
   - Progress percentage validation (0-100)
   - Status field values
   - Optional message and files_touched fields

2. ✅ **swarm_progress - Blocked Status Requirement**
   - **CRITICAL:** `blockers` array REQUIRED when `status="blocked"`
   - Blocker format and structure
   - Coordinator notification pattern

3. ✅ **swarm_progress - Status Transition Sequences**
   - Valid status flows
   - Monotonic progress expectations
   - Blocked/resumed patterns

4. ✅ **swarm_complete - Basic Completion Workflow**
   - Task completion with summary
   - Automatic reservation release
   - Evaluation field usage

5. ✅ **swarm_complete - Verification Gate Behavior**
   - Typecheck gate (TypeScript)
   - Test gate (npm test)
   - Skip flags (emergency use)

6. ✅ **swarm_spawn_subtask - Subtask Preparation**
   - Prompt generation for workers
   - Context marshaling
   - File assignment

7. ✅ **swarm_complete_subtask - Result Handling**
   - Processing worker results
   - Epic aggregation
   - Coordinator-only usage

8. ✅ **Complete Lifecycle Example**
   - End-to-end coordinator flow
   - End-to-end worker flow
   - Role boundaries

9. ✅ **Windows Path Handling in Lifecycle**
   - Path normalization in all tools
   - files_touched parameter format
   - Reservation consistency

10. ✅ **Error Handling and Recovery**
    - Gate failure recovery
    - Blocked status resolution
    - SQLite conflict handling

---

## Critical Windows-Specific Findings

### 1. **Blocked Status Requirement** ⚠️

**Finding:** When reporting `status="blocked"`, the `blockers` array parameter is **REQUIRED**.

```typescript
// ❌ INVALID - Will fail
swarm_progress({
  status: "blocked",
  message: "Cannot proceed"
  // Missing: blockers array
});

// ✅ VALID
swarm_progress({
  status: "blocked",
  message: "Cannot proceed",
  blockers: [
    "File conflict: src/config.ts reserved by another worker",
    "Waiting for API schema definition from coordinator"
  ]
});
```

**Impact:**
- Tool call fails if blockers omitted
- Coordinator needs specific blocker info to resolve
- Each blocker should be actionable

**Best Practice:**
- Always include detailed, specific blockers
- Use SwarmMail to notify coordinator after reporting blocked
- Worker should stop and wait for coordinator resolution

---

### 2. **Automatic Reservation Release**

**Finding:** `swarm_complete()` automatically releases **ALL** file reservations for the agent.

**Workflow:**
```typescript
// Worker lifecycle
1. swarmmail_reserve({ paths: ["src/file.ts"], exclusive: true })
   // -> Reservation created
2. [Do work on files]
3. swarm_complete({ summary: "Work complete", ... })
   // -> ALL reservations auto-released
```

**Impact:**
- No need to manually call `swarmmail_release()` before completion
- Simplifies worker cleanup
- Prevents forgotten reservation releases

**Manual Release Cases:**
- Use `swarmmail_release()` only for partial completion
- Example: Worker done with file A but still needs file B

---

### 3. **Verification Gates**

**Finding:** `swarm_complete()` runs verification gates BEFORE marking task complete.

**Gate Sequence:**
```
1. swarm_complete() called
2. Typecheck gate: tsc --noEmit (or similar)
   -> If fails: return error, task NOT complete
3. Test gate: npm test
   -> If fails: return error, task NOT complete
4. All gates pass: mark task complete
5. Release reservations
6. Notify coordinator
```

**Windows Considerations:**
- Gates run via `cmd.exe` on Windows
- npm commands must be on PATH
- Test output captured for debugging

**Skip Flags (Emergency Only):**
- `skip_verification=true` - Bypass typecheck and tests
- `skip_review=true` - Bypass adversarial code review
- Use only when gates broken or emergency deployment

**Recovery from Gate Failure:**
```typescript
// Attempt 1: Gates fail
swarm_complete({ summary: "Work done" });
// -> Error: "Type errors found"

// Fix type errors

// Attempt 2: Gates pass
swarm_complete({ summary: "Work done" });
// -> Success: Task marked complete
```

---

### 4. **Progress Reporting Cadence**

**Recommendation:** Report progress every 15-20 minutes for long-running tasks.

**Why:**
- Keeps coordinator informed
- Prevents "stuck worker" detection
- May refresh reservation TTL (~1 hour default)

**Suggested Percentages:**
```typescript
swarm_progress({ progress_percent: 0 });   // Starting
swarm_progress({ progress_percent: 25 });  // Quarter done
swarm_progress({ progress_percent: 50 });  // Halfway
swarm_progress({ progress_percent: 75 });  // Almost done
swarm_complete({ ... });                   // 100% done
```

**Status Transitions:**
```
in_progress (0%) 
  -> in_progress (25%) 
  -> in_progress (50%) 
  -> [optional: blocked]
  -> in_progress (75%) 
  -> completed (100%)
```

---

### 5. **Coordinator vs Worker Boundaries**

**Coordinator Tools Only:**
- `swarm_spawn_subtask()` - Prepare worker prompt
- `swarm_complete_subtask()` - Process worker result
- `swarmmail_release_all()` - Force-release all reservations
- `swarmmail_release_agent()` - Force-release agent's reservations

**Worker Tools Only:**
- `swarm_progress()` - Report status
- `swarm_complete()` - Finish task
- `swarmmail_reserve()` - Reserve files
- `swarmmail_release()` - Release own reservations

**Critical Rule:** Workers should NEVER call spawn/complete_subtask tools. Coordinators should NEVER do direct implementation work.

**Pattern:**
```typescript
// COORDINATOR
const { prompt } = swarm_spawn_subtask({
  cell_id: "task-1",
  epic_id: "epic-parent",
  subtask_title: "Implement feature",
  files: ["src/feature.ts"]
});

const task = background_task({
  agent: "build",
  prompt: prompt
});

// Wait for completion...
const result = background_output({ task_id: task.id });

swarm_complete_subtask({
  cell_id: "task-1",
  task_result: result
});

// WORKER (spawned by coordinator)
swarmmail_init({ agent_name: "worker-1", ... });
swarmmail_reserve({ paths: ["src/feature.ts"] });
swarm_progress({ progress_percent: 50 });
// [Do work]
swarm_complete({ summary: "Feature implemented" });
```

---

### 6. **SQLite Single-Writer Constraint**

**Finding:** All lifecycle tools write to SQLite database - must serialize writes.

**Problem:**
```typescript
// ❌ BAD: Parallel writes
await Promise.all([
  swarm_progress({ agent_name: "worker-1", ... }),
  swarm_progress({ agent_name: "worker-2", ... }),
  swarm_complete({ agent_name: "worker-3", ... })
]);
// -> SQLITE_BUSY error possible
```

**Solution:**
```typescript
// ✅ GOOD: Sequential writes
await swarm_progress({ agent_name: "worker-1", ... });
await swarm_progress({ agent_name: "worker-2", ... });
await swarm_complete({ agent_name: "worker-3", ... });
```

**Windows Impact:**
- Windows file locking is stricter than Unix
- SQLITE_BUSY more common on Windows
- Always serialize write-heavy swarm tools

---

### 7. **Path Normalization**

**Finding:** All file paths should be normalized before passing to lifecycle tools.

**Affected Parameters:**
- `swarm_progress({ files_touched: [...] })`
- `swarm_complete({ files_touched: [...] })`
- `swarm_spawn_subtask({ files: [...] })`
- `swarm_complete_subtask({ files_touched: [...] })`

**Best Practice:**
```typescript
import * as path from 'path';

// ❌ BAD: Mixed separators
const files = ["src/feature.ts", "tests\\feature.test.ts"];

// ✅ GOOD: Normalized
const files = [
  path.normalize("src/feature.ts"),
  path.normalize("tests/feature.test.ts")
];
// -> ["src\\feature.ts", "tests\\feature.test.ts"]

swarm_progress({
  files_touched: files,
  // ...
});
```

**Why:**
- Database stores paths as-provided
- Reservation matching requires consistent format
- Windows uses backslashes natively
- Forward slashes may cause mismatches

---

## Complete Lifecycle Example

### Worker Lifecycle (End-to-End)

```typescript
// Step 1: Initialize
swarmmail_init({
  agent_name: "auth-worker",
  project_path: "C:\\Users\\will\\dev\\swarm-tools",
  task_description: "Implement JWT authentication"
});

// Step 2: Check past learnings
const learnings = await hivemind_find({
  query: "JWT authentication implementation patterns"
});

// Step 3: Reserve files
swarmmail_reserve({
  paths: [
    path.normalize("src/auth/jwt.ts"),
    path.normalize("tests/auth/jwt.test.ts")
  ],
  exclusive: true,
  reason: "Implementing JWT authentication"
});

// Step 4: Start work
swarm_progress({
  project_key: "C:\\Users\\will\\dev\\swarm-tools",
  agent_name: "auth-worker",
  cell_id: "swarm-tools--auth-task-1",
  status: "in_progress",
  progress_percent: 0,
  message: "Starting JWT implementation"
});

// Step 5: Implement (read files, write code)
// [Implementation work here]

// Step 6: Report progress
swarm_progress({
  project_key: "C:\\Users\\will\\dev\\swarm-tools",
  agent_name: "auth-worker",
  cell_id: "swarm-tools--auth-task-1",
  status: "in_progress",
  progress_percent: 50,
  message: "JWT signing implemented, working on validation",
  files_touched: [path.normalize("src/auth/jwt.ts")]
});

// Step 7: Continue work, write tests
// [More implementation]

// Step 8: Store learnings
hivemind_store({
  information: "JWT implementation: Used jsonwebtoken library with RS256 algorithm. Store public key in config, private key in secrets.",
  tags: "jwt,authentication,security,swarm-tools"
});

// Step 9: Complete task
swarm_complete({
  project_key: "C:\\Users\\will\\dev\\swarm-tools",
  agent_name: "auth-worker",
  cell_id: "swarm-tools--auth-task-1",
  summary: "Implemented JWT authentication with RS256, including token signing and validation. All tests passing.",
  files_touched: [
    path.normalize("src/auth/jwt.ts"),
    path.normalize("tests/auth/jwt.test.ts")
  ],
  evaluation: "Type-safe implementation, 100% test coverage, follows security best practices"
});
// -> Verification gates run (typecheck + tests)
// -> All reservations auto-released
// -> Task marked complete
```

### Coordinator Lifecycle (Epic Management)

```typescript
// Step 1: Decompose task
const decomposition = swarm_decompose({
  task: "Add authentication system to swarm-tools"
});

// Step 2: Create epic with subtasks
const { epic_id, subtasks } = hive_create_epic({
  epic_title: "Authentication System",
  epic_description: "Implement JWT-based authentication",
  subtasks: [
    { title: "Implement JWT token generation", files: ["src/auth/jwt.ts"] },
    { title: "Add authentication middleware", files: ["src/middleware/auth.ts"] },
    { title: "Write integration tests", files: ["tests/auth.test.ts"] }
  ]
});

// Step 3: Spawn workers for each subtask
const workers = [];
for (const subtask of subtasks) {
  const { prompt } = swarm_spawn_subtask({
    cell_id: subtask.id,
    epic_id: epic_id,
    subtask_title: subtask.title,
    files: subtask.files,
    shared_context: "Use jsonwebtoken library, RS256 algorithm"
  });
  
  const task = background_task({
    agent: "build",
    prompt: prompt,
    description: `Worker for: ${subtask.title}`
  });
  
  workers.push({ subtask_id: subtask.id, task_id: task.id });
}

// Step 4: Monitor worker progress (via SwarmMail inbox)
// Workers report progress via swarm_progress()
// Coordinator monitors via swarmmail_inbox()

// Step 5: Process completed workers
for (const { subtask_id, task_id } of workers) {
  const result = await background_output({ task_id });
  
  swarm_complete_subtask({
    cell_id: subtask_id,
    task_result: result
  });
}

// Step 6: Check if epic complete
// swarm_complete_subtask() auto-checks if all siblings done
// If all complete -> epic marked complete automatically
```

---

## Error Handling Patterns

### Gate Failure Recovery

```typescript
// Attempt completion
try {
  swarm_complete({
    summary: "Work done",
    // ...
  });
} catch (error) {
  // Check error type
  if (error.message.includes("Type errors")) {
    console.log("Typecheck gate failed - fixing types");
    // Fix type errors
    // Retry swarm_complete()
  } else if (error.message.includes("Tests failed")) {
    console.log("Test gate failed - fixing tests");
    // Fix test failures
    // Retry swarm_complete()
  }
}
```

### Blocked Status Handling

```typescript
// Worker detects blocker
swarm_progress({
  status: "blocked",
  message: "Cannot proceed - file conflict",
  blockers: [
    "src/config.ts reserved by worker-2",
    "Need coordinator to resolve conflict"
  ],
  // ...
});

// Notify coordinator
swarmmail_send({
  to: ["coordinator"],
  subject: "BLOCKED: auth-task-1",
  body: "File conflict on src/config.ts - reserved by worker-2",
  importance: "high"
});

// Wait for coordinator resolution...
// Coordinator releases conflict and notifies

// Resume work
swarm_progress({
  status: "in_progress",
  progress_percent: 50, // Continue from where blocked
  message: "Resumed after conflict resolution",
  // ...
});
```

### SQLite Conflict Recovery

```typescript
async function safeProgress(params: ProgressParams, retries = 3): Promise<void> {
  for (let i = 0; i < retries; i++) {
    try {
      await swarm_progress(params);
      return; // Success
    } catch (error) {
      if (error.code === 'SQLITE_BUSY' && i < retries - 1) {
        // Exponential backoff
        await sleep(Math.pow(2, i) * 100);
        continue;
      }
      throw error; // Not SQLITE_BUSY or out of retries
    }
  }
}
```

---

## Best Practices Summary

### ✅ DO

1. **Progress Reporting**
   - Report every 15-20 minutes for long tasks
   - Use 0%, 25%, 50%, 75%, 100% milestones
   - Include meaningful message field

2. **Blocked Status**
   - Always include `blockers` array
   - Be specific and actionable
   - Notify coordinator via SwarmMail

3. **Path Handling**
   - Always use `path.normalize()`
   - Use backslashes on Windows
   - Normalize before reserving and before lifecycle calls

4. **Verification Gates**
   - Let gates run (don't skip unless emergency)
   - Fix issues and retry on failure
   - Gates prevent broken code from "completing"

5. **Reservation Management**
   - Reserve at start of work
   - Use `swarm_complete()` for auto-release
   - Manual release only for partial completion

### ❌ DON'T

1. **Never** call coordinator-only tools from workers
   - `swarm_spawn_subtask()` - Coordinator only
   - `swarm_complete_subtask()` - Coordinator only

2. **Never** skip verification gates without reason
   - Only use `skip_verification=true` in emergencies
   - Document why gates were skipped

3. **Never** forget `blockers` array when blocked
   - Tool call will fail
   - Coordinator cannot resolve without info

4. **Never** do parallel writes to SQLite
   - Serialize swarm tool calls
   - Use sequential await, not Promise.all()

5. **Never** use forward slashes on Windows
   - Use `path.normalize()` consistently
   - Prevents reservation mismatches

---

## Tool Parameter Reference

### swarm_progress

**Required:**
- `project_key: string` - Project path (Windows absolute)
- `agent_name: string` - Worker agent name
- `cell_id: string` - Task bead ID
- `status: "in_progress" | "blocked" | "completed" | "failed"`

**Optional:**
- `progress_percent: number` - 0-100 (inclusive)
- `message: string` - Human-readable update
- `files_touched: string[]` - Windows-normalized paths
- `blockers: string[]` - **REQUIRED when status="blocked"**

### swarm_complete

**Required:**
- `project_key: string` - Project path
- `agent_name: string` - Worker agent name
- `cell_id: string` - Task bead ID
- `summary: string` - What was accomplished

**Optional:**
- `files_touched: string[]` - Windows-normalized paths
- `evaluation: string` - Self-assessment
- `skip_verification: boolean` - Bypass gates (emergency only)
- `skip_review: boolean` - Bypass adversarial review (emergency only)

### swarm_spawn_subtask

**Required (Coordinator Only):**
- `cell_id: string` - Subtask bead ID
- `epic_id: string` - Parent epic ID
- `subtask_title: string` - Short description
- `files: string[]` - Assigned files (Windows paths)

**Optional:**
- `subtask_description: string` - Detailed description
- `shared_context: string` - Coordinator learnings to pass

**Returns:** Prompt string for background_task()

### swarm_complete_subtask

**Required (Coordinator Only):**
- `cell_id: string` - Subtask bead ID
- `task_result: string` - Full worker output

**Optional:**
- `files_touched: string[]` - Windows-normalized paths

**Side Effects:**
- Marks subtask complete
- Checks if all siblings complete -> marks epic complete

---

## Database Schema (Reference)

**Location:** `.hive/swarmmail.db`

**Tables Used by Lifecycle Tools:**
- `progress_reports` - Status and progress tracking
- `task_completions` - Completion records
- `reservations` - File lock tracking (released by swarm_complete)

**Windows Considerations:**
- SQLite single-writer - serialize writes
- File locking stricter than Unix
- Paths stored as-provided (use normalization consistently)

---

## Related Documentation

- **Initialization:** `docs/windows/01-initialization.md`
- **Task Planning:** `docs/windows/02-task-planning.md`
- **Hive Management:** `docs/windows/03-hive-management.md`
- **SwarmMail:** `docs/windows/04-swarmmail.md`
- **File Reservation:** `docs/windows/04-file-reservation.md`
- **Git Worktree:** `docs/windows/06-worktree.md`

---

## Test Execution

```bash
# Run tests
cd C:\Users\will\dev\swarm-tools
npx tsx tests/windows/test-worker-lifecycle.ts

# Expected output
# 🪟 WINDOWS WORKER LIFECYCLE & PROGRESS TRACKING TESTS
# ✅ Passed: 10/10
# ❌ Failed: 0/10
```

---

## Changelog

**2026-01-14:** Initial documentation  
- Documented all 4 lifecycle tools
- 10 test scenarios covering status transitions, verification gates, coordination
- Complete examples for worker and coordinator lifecycles
- Windows-specific notes on SQLite, paths, gates

---

**End of Report**
