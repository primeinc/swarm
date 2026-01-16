# ADR-008: Worker Handoff Protocol - Structured Contracts Over Prose

## Status

Proposed

## Context

The current `SUBTASK_PROMPT_V2` is a **280-line prose instruction manual** that gets injected into every swarm worker's context. This approach has fundamental problems:

### Current Problems

1. **Workers ignore prose** - Long text instructions get skimmed or missed entirely
2. **No validation** - Can't programmatically verify workers followed protocol
3. **Context bloat** - 280 lines * N workers burns tokens fast
4. **Drift and violations** - Workers modify files outside their scope, no automatic detection
5. **Manual error recovery** - Coordinator can't auto-detect contract violations

**Concrete example of failure:**
```
Worker assigned: ["src/auth/service.ts"]
Worker actually touched: ["src/auth/service.ts", "src/lib/jwt.ts", "src/types/user.ts"]
                         ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
                         Scope creep undetected until swarm_complete
```

Current `swarm_complete` validates `files_touched ⊆ files_owned`, but the **contract** was never machine-readable to begin with.

### Research & Inspirations

From "Patterns for Building AI Agents" and production event-driven systems:

**mdflow adapter pattern:**
- Convention-based behavior inference
- Template variables define expectations
- Minimal configuration, maximum clarity

**Bellemare's event-driven orchestration:**
- Explicit contracts between services
- Commands vs Events distinction
- Contract violations fail fast with clear errors

**Key insight:** Agents need **two channels**:
1. **Contract** (machine-readable, validated) - WHAT to do, WHERE to do it
2. **Context** (human-readable, advisory) - WHY it matters, HOW it fits together

## Decision

Replace 280-line prose with **WorkerHandoff envelope** that separates contract from context.

### WorkerHandoff Structure

```typescript
interface WorkerHandoff {
  // Machine-readable - enforced by tools
  contract: {
    task_id: string;              // Cell ID for tracking
    files_owned: string[];        // Exclusive write access (validated)
    files_readonly: string[];     // Can read, MUST NOT modify (validated)
    dependencies_completed: string[];  // Tasks that finished before this
    success_criteria: string[];   // Exit conditions (checkable)
  };
  
  // Human-readable - advisory context
  context: {
    epic_summary: string;         // Big picture goal
    your_role: string;            // What this subtask accomplishes
    what_others_did: string;      // Dependency outputs
    what_comes_next: string;      // Downstream task expectations
  };
  
  // Escalation paths - when things go wrong
  escalation: {
    blocked_contact: string;      // "coordinator" or agent name
    scope_change_protocol: string; // "swarmmail_send + await approval"
  };
}
```

### Example Handoff

```json
{
  "contract": {
    "task_id": "bd-123.2",
    "files_owned": ["src/auth/service.ts", "src/auth/service.test.ts"],
    "files_readonly": ["src/types/user.ts", "src/lib/jwt.ts"],
    "dependencies_completed": ["bd-123.1"],
    "success_criteria": [
      "AuthService.login() returns JWT token",
      "Tests pass: bun test src/auth/service.test.ts",
      "Type check passes: tsc --noEmit"
    ]
  },
  "context": {
    "epic_summary": "Add OAuth authentication to user service",
    "your_role": "Implement AuthService with JWT token generation",
    "what_others_did": "bd-123.1 created User schema with email/password fields",
    "what_comes_next": "bd-123.3 will integrate this service into API routes"
  },
  "escalation": {
    "blocked_contact": "coordinator",
    "scope_change_protocol": "swarmmail_send(subject='Scope Change', ack_required=true)"
  }
}
```

### Validation in swarm_complete

```typescript
// swarm_complete now validates against contract
function validateCompletion(handoff: WorkerHandoff, result: CompletionReport) {
  const violations: string[] = [];
  
  // 1. File scope violations
  const unauthorized = result.files_touched.filter(
    f => !handoff.contract.files_owned.includes(f)
  );
  if (unauthorized.length > 0) {
    violations.push(`Touched unauthorized files: ${unauthorized.join(", ")}`);
  }
  
  // 2. Success criteria (checkable ones)
  for (const criterion of handoff.contract.success_criteria) {
    if (criterion.startsWith("Tests pass:")) {
      // Run the test command, validate exit 0
    }
    if (criterion.startsWith("Type check passes:")) {
      // Run tsc --noEmit, validate exit 0
    }
  }
  
  // 3. Learning signals from violations
  if (violations.length > 0) {
    recordLearningSignal({
      task_id: handoff.contract.task_id,
      violation_type: "scope_creep",
      details: violations,
      impact: "negative"  // Penalize decomposition strategy
    });
  }
  
  return { valid: violations.length === 0, violations };
}
```

### Integration with Existing Tools

**swarm_spawn_subtask generates handoffs:**

```typescript
export const swarm_spawn_subtask = tool(/* ... */)
  .handler(async ({ input, context }) => {
    const handoff: WorkerHandoff = {
      contract: {
        task_id: input.cell_id,
        files_owned: input.files,
        files_readonly: inferReadonlyFiles(input.files, epicContext),
        dependencies_completed: input.dependencies_completed || [],
        success_criteria: generateSuccessCriteria(input.subtask_description)
      },
      context: {
        epic_summary: epicContext.summary,
        your_role: input.subtask_title,
        what_others_did: summarizeDependencies(input.dependencies_completed),
        what_comes_next: summarizeDownstream(input.cell_id)
      },
      escalation: {
        blocked_contact: "coordinator",
        scope_change_protocol: "swarmmail_send(subject='Scope Change', ack_required=true)"
      }
    };
    
    return formatHandoff(handoff); // Compact JSON + minimal prose wrapper
  });
```

**swarm_complete validates contract:**

```typescript
export const swarm_complete = tool(/* ... */)
  .handler(async ({ input, context }) => {
    const handoff = getStoredHandoff(input.cell_id);
    const validation = validateCompletion(handoff, {
      files_touched: input.files_touched,
      summary: input.summary
    });
    
    if (!validation.valid) {
      throw new Error(
        `Contract violations detected:\n${validation.violations.join("\n")}`
      );
    }
    
    // Proceed with UBS scan, reservation release, etc.
  });
```

## Consequences

### Positive

- **Validation enforced** - Can't complete with contract violations
- **Clear boundaries** - Workers know exactly what's in/out of scope
- **Better learning** - Scope creep violations feed back into strategy selection
- **Context efficiency** - Contract is ~30 lines JSON vs 280 lines prose
- **Fail fast** - Violations detected immediately, not during merge
- **Programmatic recovery** - Coordinator can auto-detect and reassign work

### Negative

- **Requires storage** - Handoffs must persist (already have event store)
- **Success criteria limited** - Can't validate all criteria automatically
- **Migration cost** - Existing `SUBTASK_PROMPT_V2` users need update
- **More upfront work** - Coordinator must generate better contracts

### Neutral

- **Prose still exists** - `context` field provides human explanation, just smaller
- **Not eliminating checklist** - 9-step survival checklist stays, but moves to tool enforcement

## Implementation Notes

### Phase 1: Storage & Schema

1. Add `WorkerHandoff` schema to swarm-mail event types
2. Store handoffs in event log when spawning subtasks
3. Retrieve handoffs in `swarm_complete` for validation

### Phase 2: Generation Logic

1. Implement `inferReadonlyFiles()` - analyze imports/dependencies
2. Implement `generateSuccessCriteria()` - parse task description for checkable conditions
3. Implement `summarizeDependencies()` and `summarizeDownstream()` - build context from epic graph

### Phase 3: Validation

1. Add contract validation to `swarm_complete`
2. Implement checkable criteria runners (test commands, type checks)
3. Record learning signals for violations

### Phase 4: Migration

1. Update `formatSubtaskPromptV2` to generate handoff JSON
2. Deprecate 280-line prose template
3. Update tests for new handoff format

### Phase 5: Enhanced Features (Future)

1. **Readonly enforcement** - Detect modifications to `files_readonly` via git diff
2. **Dependency validation** - Verify `dependencies_completed` actually ran first
3. **Auto-generated success criteria** - Parse test files, infer criteria from code

## Alternatives Considered

### Keep Prose, Add Validation

Keep `SUBTASK_PROMPT_V2` but add validation after-the-fact. **Rejected** because:
- Still burns 280 lines of context per worker
- Workers still ignore prose
- Validation happens too late (after work done)

### Minimal Contract Only

Remove context entirely, pure machine contract. **Rejected** because:
- Workers need WHY to make good judgment calls
- Context helps with edge cases not in contract
- Loss of human readability hurts debugging

### Command Pattern (Bellemare Style)

Full event-sourcing with Command objects. **Rejected** because:
- Over-engineered for current needs
- Already have event store for coordination
- Contract + context is simpler and sufficient

## References

- **"Patterns for Building AI Agents"** - Subagent context sharing patterns
- **mdflow** - Convention-based adapter design, template variable contracts
- **Bellemare's "Building Event-Driven Microservices"** - Explicit contracts, fail-fast validation
- **Current implementation:** `src/swarm-prompts.ts` (SUBTASK_PROMPT_V2, lines 253-530)
- **Related:** ADR-007 (Structured Review), ADR-002 (Package Extraction)

## Success Criteria

- [ ] `WorkerHandoff` schema defined and validated with Zod
- [ ] `swarm_spawn_subtask` generates handoffs instead of raw prose
- [ ] `swarm_complete` validates contract before accepting completion
- [ ] Scope violations trigger learning signals (negative feedback)
- [ ] Workers receive handoff as JSON + compact context wrapper (<50 lines)
- [ ] Test suite validates contract enforcement catches violations
- [ ] Migration path documented for existing swarm users
