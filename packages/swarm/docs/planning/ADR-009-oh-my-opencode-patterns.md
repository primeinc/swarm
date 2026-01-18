# ADR-009: Patterns from oh-my-opencode

## Status

Proposed

## Context

[oh-my-opencode](https://github.com/code-yeongyu/oh-my-opencode) by **code-yeongyu** is the most feature-rich OpenCode plugin in the wild (2961★). After deep analysis of its architecture, we identified several patterns that would significantly strengthen our swarm coordination.

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│   "Standing on the shoulders of giants"                        │
│                                                                 │
│   oh-my-opencode innovations we're adopting:                   │
│   • 7-Section Delegation Protocol                              │
│   • Compaction Context Injection                               │
│   • Preemptive Compaction (80% threshold)                      │
│   • Event + Polling Hybrid for completion detection            │
│   • Parallel Execution Minimums                                │
│   • Context-Safe Tool Limits                                   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### What oh-my-opencode Does Well

1. **Agent System** - Factory-based registry with model-specific configs, BackgroundManager for async execution, structured delegation prompts
2. **21 Lifecycle Hooks** - Compaction handling, session recovery, think-mode auto-switching, external hook protocol
3. **Background Agents** - Event + polling hybrid, todo-aware completion, fire-and-forget abort
4. **LSP/AST Tools** - Zero-config LSP integration, 11 code intelligence tools, context-safe limits
5. **Claude Code Compatibility** - Dual-path config loading, 4 independent loaders, auto-migration
6. **Plugin Architecture** - Hook mapping pattern, session-scoped state, graceful degradation

### What We Already Have

- Swarm Mail for inter-agent messaging
- File reservations for conflict prevention
- UBS scan on completion
- Hive for work item tracking
- Worktree isolation (ADR-007)
- Structured review (ADR-007)

### Gaps This ADR Addresses

1. **Coordinator prompts lack structure** - Workers sometimes go rogue
2. **Context compaction loses critical info** - Decomposition strategy, dependency graph forgotten
3. **No preemptive compaction** - Sessions die at 100% instead of gracefully compacting at 80%
4. **Polling-only completion detection** - Slower than event-driven
5. **No parallel execution enforcement** - Researchers call tools sequentially
6. **Tool outputs can explode context** - No hard limits on results

## Decision

### 1. 7-Section Delegation Protocol

Adopt oh-my-opencode's structured delegation format for coordinator → worker handoffs:

```markdown
## TASK
[Specific task description]

## EXPECTED OUTCOME
[What success looks like]

## REQUIRED SKILLS
[Domain knowledge needed]

## REQUIRED TOOLS
[Tools the worker should use]

## MUST DO
- [Non-negotiable requirements]
- [Quality gates]

## MUST NOT DO
- [Forbidden approaches]
- [Anti-patterns to avoid]

## CONTEXT
[Shared context from coordinator]
[Dependency information]
[What other workers are doing]
```

**Implementation:** Update `swarm_subtask_prompt` to generate this format.

**Why:** Reduces rogue behavior. Workers have clear boundaries and success criteria.

### 2. Compaction Context Injection

Preserve critical information through context compaction by injecting a structured prompt BEFORE the summarization API call:

```markdown
## 1. User Requests (As-Is)
[Exact wording of original requests - preserved verbatim]

## 2. Final Goal
[End result expected from this session]

## 3. Work Completed
[Files modified, features implemented, problems solved]

## 4. Remaining Tasks
[Pending items, follow-ups, blocked work]

## 5. MUST NOT Do
[Forbidden approaches, failed attempts, anti-patterns discovered]

## 6. Swarm State (if applicable)
[Epic ID, completed subtasks, in-progress workers, dependency graph]
```

**Implementation:** Add `experimental.session.compacting` hook that injects this prompt.

**Why:** Currently compaction loses decomposition strategy, dependency graph, and failed approaches. Workers repeat mistakes.

### 3. Preemptive Compaction

Monitor token usage and trigger compaction at 80% threshold instead of waiting for overflow:

```typescript
// In chat.message or message.updated hook
const usageRatio = totalTokens / contextLimit;
if (usageRatio >= 0.8 && !compactionInProgress.has(sessionID)) {
  compactionInProgress.add(sessionID);
  await ctx.client.session.summarize({ ... });
  
  // Auto-resume after compaction
  setTimeout(() => {
    ctx.client.session.promptAsync({ parts: [{ text: "Continue" }] });
  }, 500);
}
```

**Configuration:**
```json
{
  "preemptive_compaction": {
    "enabled": true,
    "threshold": 0.8,
    "cooldown_seconds": 300
  }
}
```

**Why:** Prevents context overflow mid-work. Coordinators and workers survive long-running epics.

### 4. Event + Polling Hybrid for Completion Detection

Currently we only poll for worker completion. Add event-driven detection as primary path:

```typescript
// Primary: Event-driven (fast)
event: async ({ event }) => {
  if (event.type === "session.idle") {
    const todos = await client.session.todo();
    if (todos.length === 0) {
      markWorkerComplete(event.properties?.info?.id);
    }
  }
}

// Fallback: Polling (reliable)
setInterval(() => {
  for (const worker of runningWorkers) {
    const status = await client.session.status(worker.sessionID);
    if (status.type === "idle") {
      // Same completion logic
    }
  }
}, 2000);
```

**Why:** Events are faster. Polling catches missed events. Hybrid = reliable + fast.

### 5. Parallel Execution Minimums

Enforce minimum parallel tool calls for researcher agents:

```markdown
## PARALLEL EXECUTION REQUIREMENTS

You MUST launch multiple tools simultaneously in your first action.
Never call tools sequentially unless output depends on prior result.

Minimum parallel calls by request type:
- TYPE A (conceptual): 3+ tools (context7 + pdf-brain + websearch)
- TYPE B (implementation): 4+ tools (repo-autopsy + grep + ast-grep + read)
- TYPE C (comprehensive): 6+ tools (all of the above)

WRONG:
1. Search for X
2. Wait for result
3. Search for Y

RIGHT:
[Search X | Search Y | Search Z] → single response
```

**Implementation:** Add to `swarm-researcher` agent prompt. Enforce via output validation.

**Why:** Sequential tool calls waste round-trips and burn context. Parallel = faster + cheaper.

### 6. Context-Safe Tool Limits

Add hard limits and truncation reporting to tools that can explode context:

| Tool | Limit | Truncation Message |
|------|-------|-------------------|
| `repo-autopsy_search` | 100 results | `Found 347 results (showing first 100):` |
| `cass_search` | 50 results | `Found 89 sessions (showing first 50):` |
| `find-exports` | 50 results | `Found 72 exports (showing first 50):` |
| `semantic-memory_find` | 20 results | `Found 45 memories (showing first 20):` |

**Implementation:**
```typescript
const MAX_RESULTS = 100;
const total = results.length;
const truncated = total > MAX_RESULTS;
const limited = truncated ? results.slice(0, MAX_RESULTS) : results;

if (truncated) {
  output.unshift(`Found ${total} results (showing first ${MAX_RESULTS}):`);
}
```

**Why:** Unbounded results kill context. Truncation with count lets agent know there's more.

### 7. Todo-Aware Completion (Bonus)

Before marking a worker complete, check if it left unfinished work:

```typescript
async function canMarkComplete(sessionID: string): Promise<boolean> {
  const todos = await client.session.todo({ path: { id: sessionID } });
  const incomplete = todos.filter(t => t.status !== "completed");
  
  if (incomplete.length > 0) {
    // Inject continuation prompt
    await client.session.prompt({
      path: { id: sessionID },
      body: { parts: [{ text: "You have incomplete TODOs. Continue working." }] }
    });
    return false;
  }
  return true;
}
```

**Why:** Prevents race conditions where worker marks complete before finishing TODO list.

### 8. Think Mode for Complex Decomposition (Bonus)

Auto-enable extended thinking when decomposing complex tasks:

```typescript
// In chat.params hook
const complexityIndicators = [
  "decompose", "break down", "plan", "architect",
  "refactor across", "migrate", "redesign"
];

if (complexityIndicators.some(k => prompt.toLowerCase().includes(k))) {
  output.message.model = { modelID: "claude-sonnet-4-5-high" };
  output.message.thinking = { type: "enabled", budget_tokens: 16000 };
}
```

**Why:** Complex decomposition benefits from extended reasoning. Auto-switching removes friction.

## Implementation

### Phase 1: Delegation Protocol + Context Injection (Priority)
1. Update `swarm_subtask_prompt` with 7-section format
2. Add compaction context injection hook
3. Test with existing swarm workflows

### Phase 2: Preemptive Compaction + Event Hybrid
1. Add token monitoring to coordinator/worker sessions
2. Implement 80% threshold compaction with cooldown
3. Add event-driven completion detection
4. Keep polling as fallback

### Phase 3: Tool Limits + Parallel Enforcement
1. Add limits to repo-autopsy, cass, find-exports, semantic-memory
2. Update swarm-researcher prompt with parallel minimums
3. Add output validation for parallel enforcement

### Phase 4: Bonus Features
1. Todo-aware completion check
2. Think mode auto-switching for decomposition

## Consequences

### Positive
- **Better worker behavior**: 7-section protocol reduces rogue actions
- **Context survives compaction**: Critical info preserved through summarization
- **No more context overflow**: Preemptive compaction at 80%
- **Faster completion detection**: Events + polling hybrid
- **Cheaper research**: Parallel execution reduces round-trips
- **Predictable tool output**: Hard limits prevent context explosion

### Negative
- **More complexity**: Additional hooks and state management
- **Prompt bloat**: 7-section format is verbose (but worth it)
- **Compaction overhead**: Preemptive compaction adds latency (but prevents crashes)

### Neutral
- **Attribution**: All patterns credited to code-yeongyu/oh-my-opencode
- **Not a fork**: We're adopting patterns, not copying code

## Alternatives Considered

### Copy oh-my-opencode Wholesale
Could fork and adapt. Rejected because:
- Different architecture (we have Swarm Mail, Hive, etc.)
- Our patterns complement theirs, not replace
- Selective adoption is cleaner

### Skip Compaction Handling
Could rely on OpenCode's built-in compaction. Rejected because:
- Default compaction loses swarm-specific context
- Decomposition strategy, dependency graph critical for workers

### Always Use Extended Thinking
Could enable thinking for all coordinator actions. Rejected because:
- Overkill for simple tasks
- Slower and more expensive
- Auto-detection is smarter

## References

- [oh-my-opencode](https://github.com/code-yeongyu/oh-my-opencode) by code-yeongyu - Primary source
- [ADR-007](./ADR-007-swarm-enhancements-worktree-review.md) - Worktree isolation + structured review
- [ADR-008](./ADR-008-worker-handoff-protocol.md) - Worker handoff protocol

## Acknowledgments

Major thanks to **code-yeongyu** for building oh-my-opencode and open-sourcing these patterns. The OpenCode ecosystem is stronger because of contributions like this.

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│   🐝  "Good artists copy, great artists steal"                 │
│       — Picasso (probably misattributed)                       │
│                                                                 │
│   We're stealing the good stuff and making it ours.            │
│   With proper attribution, of course.                          │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```
