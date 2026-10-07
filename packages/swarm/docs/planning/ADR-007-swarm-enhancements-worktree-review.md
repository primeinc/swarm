# ADR-007: Swarm Enhancements - Worktree Isolation + Structured Review

## Status

Proposed

## Context

After reviewing [nexxeln/opencode-config](https://github.com/nexxeln/opencode-config), we identified several patterns that would strengthen our swarm coordination:

1. **Git worktree isolation** - Each worker gets a complete isolated copy of the repo
2. **Structured review loop** - Workers must pass review before completion
3. **Retry options on abort** - Clean recovery paths when things go wrong

Currently our swarm uses:
- **File reservations** via Swarm Mail for conflict prevention
- **UBS scan** on completion for bug detection
- **Manual cleanup** on abort

## Decision

### 1. Optional Worktree Isolation Mode

Add `isolation` parameter to swarm initialization:

```typescript
swarm_init({
  task: "Large refactor across 50 files",
  isolation: "worktree"  // or "reservation" (default)
})
```

**When to use worktrees:**
- Large refactors touching many files
- High risk of merge conflicts
- Need complete isolation (different node_modules, etc.)

**When to use reservations (default):**
- Most swarm tasks
- Quick parallel work
- Lower overhead

**Worktree lifecycle:**
```
swarm_worktree_create(task_id) → /path/to/worktree
  ↓
worker does work in worktree
  ↓
swarm_worktree_merge(task_id)  → cherry-pick commit to main
  ↓
swarm_worktree_cleanup(task_id) → remove worktree
```

**On abort:** Hard reset main to start commit, delete all worktrees.

### 2. Structured Review Step

The coordinator reviews worker output before marking complete. This replaces the current "trust but verify with UBS" approach.

**Review flow:**
```
worker completes → coordinator reviews → approved/needs_changes
                                              ↓
                                    if needs_changes: worker fixes (max 3 attempts)
                                              ↓
                                    if approved: mark complete
```

**Review prompt includes:**
- Epic goal (the big picture)
- Task requirements
- What completed tasks this builds on (dependency context)
- What future tasks depend on this (downstream context)
- The actual code changes

**Why coordinator reviews (not separate reviewer agent):**
- Coordinator already has full epic context loaded
- Avoids spawning another agent just for review
- Keeps the feedback loop tight
- Coordinator can make judgment calls about "good enough"

**Review criteria:**
1. Does it fulfill the task requirements?
2. Does it serve the epic goal?
3. Will downstream tasks be able to use it?
4. Are there critical bugs? (UBS scan still runs)

### 3. Retry Options on Abort

When a swarm aborts (user request or failure), provide clear recovery paths:

```json
{
  "retry_options": {
    "same_plan": "/swarm --retry",
    "edit_plan": "/swarm --retry --edit",
    "fresh_start": "/swarm \"original task\""
  }
}
```

**`--retry`**: Resume with same plan, skip completed tasks
**`--retry --edit`**: Show plan for modification before resuming
**Fresh start**: Decompose from scratch

This requires persisting swarm session state (already have this via Hive cells).

## Implementation

### Phase 1: Structured Review (Priority)
1. Add review step to `swarm_complete`
2. Create review prompt with epic context injection
3. Handle needs_changes → worker retry loop (max 3)
4. Keep UBS scan as additional safety net

### Phase 2: Worktree Isolation
1. Add `isolation` mode to `swarm_init`
2. Implement worktree lifecycle tools
3. Update worker prompts to work in worktree path
4. Add cherry-pick merge on completion
5. Add cleanup on abort

### Phase 3: Retry Options
1. Persist session state for recovery
2. Add `--retry` and `--retry --edit` flags
3. Skip completed tasks on retry
4. Show plan editor for `--edit` mode

## Consequences

### Positive
- **Better quality**: Structured review catches issues before integration
- **Safer large refactors**: Worktree isolation eliminates merge conflicts
- **Cleaner recovery**: Retry options reduce friction after failures
- **Coordinator stays in control**: Review keeps human-in-the-loop feel

### Negative
- **More complexity**: Two isolation modes to maintain
- **Slower completion**: Review step adds latency
- **Disk usage**: Worktrees consume space (mitigated by cleanup)

### Neutral
- **Credit**: Patterns inspired by nexxeln/opencode-config - should acknowledge in docs

## Alternatives Considered

### Separate Reviewer Agent
nexxeln uses a dedicated reviewer subagent. We chose coordinator-as-reviewer because:
- Avoids context duplication (coordinator already has epic context)
- Faster feedback loop
- Coordinator can make "ship it" judgment calls

### Staged Changes on Finalize
nexxeln soft-resets to leave changes staged for user review. We're skipping this because:
- Our flow already has explicit commit step
- Hive tracks what changed
- User can always `git diff` before committing

### Always Use Worktrees
Could simplify by always using worktrees. Rejected because:
- Overkill for most tasks
- Slower setup/teardown
- File reservations work fine for typical parallel work

## References

- [nexxeln/opencode-config](https://github.com/nexxeln/opencode-config) - Source of inspiration
- Epic: `bd-lf2p4u-mjaja96b9da` - Swarm Enhancements
