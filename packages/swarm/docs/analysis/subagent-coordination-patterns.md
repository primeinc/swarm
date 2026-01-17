prefer tdd

# Subagent Coordination Patterns Analysis

**Source:** obra/superpowers repository  
**Files Analyzed:**

- skills/subagent-driven-development/SKILL.md
- skills/dispatching-parallel-agents/SKILL.md
- skills/requesting-code-review/SKILL.md
- skills/requesting-code-review/code-reviewer.md

---

## 1. Core Principles

1. **Fresh Subagent Per Task** - No context pollution. Each agent starts clean, reads requirements, executes, reports back.

2. **Review Between Tasks** - Code review after EACH task catches issues before they compound. Cheaper than debugging later.

3. **Focused Agent Prompts** - One clear problem domain per agent. Self-contained context. Specific about expected output.

4. **Parallelize Independent Work** - 3+ independent failures/tasks = dispatch concurrent agents. No shared state = parallel safe.

5. **Same Session Execution** - Subagent-driven development stays in current session (vs executing-plans which spawns parallel session).

6. **Quality Gates Over Speed** - More subagent invocations cost tokens, but catching issues early is cheaper than debugging cascading failures.

7. **Never Skip Review** - Even "simple" tasks get reviewed. Critical issues block progress. Important issues fixed before next task.

8. **Explicit Severity Tiers** - Critical (must fix), Important (should fix), Minor (nice to have). Not everything is critical.

---

## 2. When to Use Each Pattern

### Subagent-Driven Development

**Use when:**

- Staying in current session (no context switch)
- Tasks are mostly independent
- Want continuous progress with quality gates
- Have a plan ready to execute

**Don't use when:**

- Need to review plan first → use `executing-plans`
- Tasks are tightly coupled → manual execution better
- Plan needs revision → brainstorm first

**Decision tree:**

```
Have implementation plan?
├─ Yes → Tasks independent?
│  ├─ Yes → Stay in session?
│  │  ├─ Yes → Subagent-Driven Development ✓
│  │  └─ No → Executing Plans (parallel session)
│  └─ No → Manual execution (tight coupling)
└─ No → Write plan first
```

---

### Dispatching Parallel Agents

**Use when:**

- 3+ test files failing with different root causes
- Multiple subsystems broken independently
- Each problem can be understood without context from others
- No shared state between investigations

**Don't use when:**

- Failures are related (fix one might fix others)
- Need to understand full system state
- Agents would interfere with each other (shared state, editing same files)
- Exploratory debugging (don't know what's broken yet)

**Decision tree:**

```
Multiple failures?
├─ Yes → Are they independent?
│  ├─ Yes → Can work in parallel?
│  │  ├─ Yes → 3+ failures?
│  │  │  ├─ Yes → Parallel Dispatch ✓
│  │  │  └─ No → Sequential agents
│  │  └─ No (shared state) → Sequential agents
│  └─ No (related) → Single agent investigates all
└─ No → Single investigation
```

**Heuristics:**

- Different test files = likely independent
- Different subsystems = likely independent
- Same error across files = likely related
- Cascading failures = investigate root cause first

---

### Requesting Code Review

**Mandatory:**

- After each task in subagent-driven development
- After completing major feature
- Before merge to main

**Optional but valuable:**

- When stuck (fresh perspective)
- Before refactoring (baseline check)
- After fixing complex bug

**Never skip because:**

- "It's simple" (simple tasks can have subtle issues)
- "I'm confident" (review finds blind spots)
- "Time pressure" (unfixed bugs cost more time later)

---

## 3. Agent Prompt Best Practices

### Anatomy of a Good Prompt

**1. Focused** - One clear problem domain

```markdown
❌ "Fix all the tests"
✓ "Fix agent-tool-abort.test.ts"
```

**2. Self-contained** - All context needed

```markdown
❌ "Fix the race condition"
✓ "Fix the 3 failing tests in src/agents/agent-tool-abort.test.ts:

1.  'should abort tool with partial output capture' - expects 'interrupted at' in message
2.  'should handle mixed completed and aborted tools' - fast tool aborted instead of completed
3.  'should properly track pendingToolCount' - expects 3 results but gets 0"
```

**3. Specific about output** - What should agent return?

```markdown
❌ "Fix it"
✓ "Return: Summary of root cause and what you fixed"
```

**4. Constraints** - Prevent scope creep

```markdown
✓ "Do NOT just increase timeouts - find the real issue"
✓ "Do NOT change production code - fix tests only"
✓ "Don't refactor - minimal changes to make tests pass"
```

---

### Implementation Subagent Template

```markdown
You are implementing Task N from [plan-file].

Read that task carefully. Your job is to:

1. Implement exactly what the task specifies
2. Write tests (following TDD if task says to)
3. Verify implementation works
4. Commit your work
5. Report back

Work from: [directory]

Report: What you implemented, what you tested, test results, files changed, any issues
```

**Key elements:**

- References plan file for context
- Explicit steps to follow
- Specific output format
- Working directory specified

---

### Parallel Investigation Template

```markdown
Fix the 3 failing tests in src/agents/agent-tool-abort.test.ts:

1. "should abort tool with partial output capture" - expects 'interrupted at' in message
2. "should handle mixed completed and aborted tools" - fast tool aborted instead of completed
3. "should properly track pendingToolCount" - expects 3 results but gets 0

These are timing/race condition issues. Your task:

1. Read the test file and understand what each test verifies
2. Identify root cause - timing issues or actual bugs?
3. Fix by:
   - Replacing arbitrary timeouts with event-based waiting
   - Fixing bugs in abort implementation if found
   - Adjusting test expectations if testing changed behavior

Do NOT just increase timeouts - find the real issue.

Return: Summary of what you found and what you fixed.
```

**Key elements:**

- Paste error messages and test names (full context)
- Hypothesis about root cause
- Clear fixing strategy
- Anti-pattern constraint ("Do NOT just increase timeouts")
- Expected return format

---

### Fix Subagent Template

```markdown
Fix issues from code review: [list issues]

Context: [what was just implemented]

Issues to fix:

1. [Issue from reviewer with file:line reference]
2. [Issue from reviewer with file:line reference]

Fix these issues and commit. Report what you changed.
```

**Key elements:**

- Specific issues from code review
- Context of original implementation
- Clear success criteria

---

## 4. Code Review Template Structure

### Dispatcher Side (Requesting Review)

**1. Get git SHAs:**

```bash
BASE_SHA=$(git rev-parse HEAD~1)  # or origin/main
HEAD_SHA=$(git rev-parse HEAD)
```

**2. Fill template placeholders:**

- `{WHAT_WAS_IMPLEMENTED}` - What you just built
- `{PLAN_OR_REQUIREMENTS}` - What it should do (reference plan file/section)
- `{BASE_SHA}` - Starting commit
- `{HEAD_SHA}` - Ending commit
- `{DESCRIPTION}` - Brief summary

**3. Dispatch superpowers:code-reviewer subagent** with filled template

---

### Code Reviewer Side (Template Output)

#### Strengths

[What's well done? Be specific with file:line references]

Example:

```
- Clean database schema with proper migrations (db.ts:15-42)
- Comprehensive test coverage (18 tests, all edge cases)
- Good error handling with fallbacks (summarizer.ts:85-92)
```

---

#### Issues

##### Critical (Must Fix)

[Bugs, security issues, data loss risks, broken functionality]

##### Important (Should Fix)

[Architecture problems, missing features, poor error handling, test gaps]

##### Minor (Nice to Have)

[Code style, optimization opportunities, documentation improvements]

**For each issue:**

- File:line reference
- What's wrong
- Why it matters
- How to fix (if not obvious)

Example:

```
#### Important
1. **Missing help text in CLI wrapper**
   - File: index-conversations:1-31
   - Issue: No --help flag, users won't discover --concurrency
   - Fix: Add --help case with usage examples

2. **Date validation missing**
   - File: search.ts:25-27
   - Issue: Invalid dates silently return no results
   - Fix: Validate ISO format, throw error with example
```

---

#### Recommendations

[Improvements for code quality, architecture, or process]

---

#### Assessment

**Ready to merge?** [Yes/No/With fixes]

**Reasoning:** [Technical assessment in 1-2 sentences]

Example:

```
**Ready to merge: With fixes**

**Reasoning:** Core implementation is solid with good architecture and tests.
Important issues (help text, date validation) are easily fixed and don't affect
core functionality.
```

---

### Review Checklist (Reviewer Uses This)

**Code Quality:**

- Clean separation of concerns?
- Proper error handling?
- Type safety (if applicable)?
- DRY principle followed?
- Edge cases handled?

**Architecture:**

- Sound design decisions?
- Scalability considerations?
- Performance implications?
- Security concerns?

**Testing:**

- Tests actually test logic (not mocks)?
- Edge cases covered?
- Integration tests where needed?
- All tests passing?

**Requirements:**

- All plan requirements met?
- Implementation matches spec?
- No scope creep?
- Breaking changes documented?

**Production Readiness:**

- Migration strategy (if schema changes)?
- Backward compatibility considered?
- Documentation complete?
- No obvious bugs?

---

## 5. Anti-Patterns and Red Flags

### Subagent-Driven Development

**Never:**

- ❌ Skip code review between tasks
- ❌ Proceed with unfixed Critical issues
- ❌ Dispatch multiple implementation subagents in parallel (conflicts)
- ❌ Implement without reading plan task
- ❌ Try to fix subagent failures manually (context pollution)

**If subagent fails task:**

- ✓ Dispatch fix subagent with specific instructions
- ✓ Don't try to fix manually (context pollution)

---

### Dispatching Parallel Agents

**Common mistakes:**

❌ **Too broad:** "Fix all the tests"  
✓ **Specific:** "Fix agent-tool-abort.test.ts"

❌ **No context:** "Fix the race condition"  
✓ **Context:** Paste error messages and test names

❌ **No constraints:** Agent might refactor everything  
✓ **Constraints:** "Do NOT change production code" or "Fix tests only"

❌ **Vague output:** "Fix it"  
✓ **Specific:** "Return summary of root cause and changes"

**When NOT to parallelize:**

- Related failures (fix one might fix others)
- Need full context (understanding requires seeing entire system)
- Exploratory debugging (don't know what's broken yet)
- Shared state (agents would interfere)

---

### Requesting Code Review

**Never:**

- ❌ Skip review because "it's simple"
- ❌ Ignore Critical issues
- ❌ Proceed with unfixed Important issues
- ❌ Argue with valid technical feedback

**If reviewer wrong:**

- ✓ Push back with technical reasoning
- ✓ Show code/tests that prove it works
- ✓ Request clarification

---

### Code Reviewer Anti-Patterns

**DO:**

- ✓ Categorize by actual severity (not everything is Critical)
- ✓ Be specific (file:line, not vague)
- ✓ Explain WHY issues matter
- ✓ Acknowledge strengths
- ✓ Give clear verdict

**DON'T:**

- ❌ Say "looks good" without checking
- ❌ Mark nitpicks as Critical
- ❌ Give feedback on code you didn't review
- ❌ Be vague ("improve error handling")
- ❌ Avoid giving a clear verdict

---

## 6. Integration Between Patterns

### Subagent-Driven Development Workflow

```
1. Load Plan
   └─ Read plan file, create TodoWrite with all tasks

2. For Each Task:
   ├─ Dispatch implementation subagent
   │  └─ Fresh context, follows TDD, commits work
   │
   ├─ Get git SHAs (before task, after task)
   │
   ├─ Dispatch code-reviewer subagent
   │  └─ Reviews against plan requirements
   │
   ├─ Act on review feedback
   │  ├─ Critical issues → Fix immediately
   │  ├─ Important issues → Dispatch fix subagent
   │  └─ Minor issues → Note for later
   │
   └─ Mark task complete in TodoWrite

3. After All Tasks:
   ├─ Dispatch final code-reviewer
   │  └─ Reviews entire implementation
   │
   └─ Use finishing-a-development-branch skill
      └─ Verify tests, present options, execute choice
```

---

### Parallel Investigation Workflow

```
1. Multiple Failures Detected
   └─ Identify independent problem domains

2. Group by Domain
   ├─ File A tests: Tool approval flow
   ├─ File B tests: Batch completion behavior
   └─ File C tests: Abort functionality

3. Dispatch Parallel Agents
   ├─ Agent 1: Fix File A (focused scope, specific errors)
   ├─ Agent 2: Fix File B (focused scope, specific errors)
   └─ Agent 3: Fix File C (focused scope, specific errors)

4. Review and Integrate
   ├─ Read each summary
   ├─ Verify fixes don't conflict
   ├─ Run full test suite
   └─ Integrate all changes
```

---

### Acting on Code Review Feedback

**Severity Tiers:**

**Critical (Must Fix):**

- Bugs, security issues, data loss risks, broken functionality
- **Action:** Fix immediately, re-review, don't proceed without fixing

**Important (Should Fix):**

- Architecture problems, missing features, poor error handling, test gaps
- **Action:** Dispatch fix subagent before next task

**Minor (Nice to Have):**

- Code style, optimization opportunities, documentation improvements
- **Action:** Note for later, don't block on these

**Example flow:**

```
Reviewer returns:
  Critical: None
  Important: Missing progress indicators, Date validation missing
  Minor: Magic number (100) for reporting interval

Action:
1. Dispatch fix subagent: "Fix Important issues from review: [list]"
2. Fix subagent commits changes
3. (Optional) Quick re-review if fixes were complex
4. Mark task complete, proceed to next task
5. Note Minor issues for future cleanup
```

---

## 7. Required Workflow Skills

### Subagent-Driven Development Dependencies

**REQUIRED:**

- `writing-plans` - Creates the plan that this skill executes
- `requesting-code-review` - Review after each task
- `finishing-a-development-branch` - Complete development after all tasks

**Subagents must use:**

- `test-driven-development` - Subagents follow TDD for each task

**Alternative workflow:**

- `executing-plans` - Use for parallel session instead of same-session execution

---

## 8. Real-World Examples

### Parallel Investigation (from Session 2025-10-03)

**Scenario:** 6 test failures across 3 files after major refactoring

**Failures:**

- agent-tool-abort.test.ts: 3 failures (timing issues)
- batch-completion-behavior.test.ts: 2 failures (tools not executing)
- tool-approval-race-conditions.test.ts: 1 failure (execution count = 0)

**Decision:** Independent domains - abort logic separate from batch completion separate from race conditions

**Dispatch:**

```
Agent 1 → Fix agent-tool-abort.test.ts
Agent 2 → Fix batch-completion-behavior.test.ts
Agent 3 → Fix tool-approval-race-conditions.test.ts
```

**Results:**

- Agent 1: Replaced timeouts with event-based waiting
- Agent 2: Fixed event structure bug (threadId in wrong place)
- Agent 3: Added wait for async tool execution to complete

**Integration:** All fixes independent, no conflicts, full suite green

**Time saved:** 3 problems solved in parallel vs sequentially

---

### Subagent-Driven Development Example

```
Coordinator: I'm using Subagent-Driven Development to execute this plan.

[Load plan, create TodoWrite]

Task 1: Hook installation script

[Dispatch implementation subagent]
Subagent: Implemented install-hook with tests, 5/5 passing

[Get git SHAs, dispatch code-reviewer]
Reviewer: Strengths: Good test coverage. Issues: None. Ready.

[Mark Task 1 complete]

Task 2: Recovery modes

[Dispatch implementation subagent]
Subagent: Added verify/repair, 8/8 tests passing

[Dispatch code-reviewer]
Reviewer: Strengths: Solid. Issues (Important): Missing progress reporting

[Dispatch fix subagent]
Fix subagent: Added progress every 100 conversations

[Verify fix, mark Task 2 complete]

...

[After all tasks]
[Dispatch final code-reviewer]
Final reviewer: All requirements met, ready to merge

Done!
```

---

## 9. Key Quotes Worth Preserving

> **"Fresh subagent per task + review between tasks = high quality, fast iteration"**  
> — subagent-driven-development/SKILL.md

> **"Dispatch one agent per independent problem domain. Let them work concurrently."**  
> — dispatching-parallel-agents/SKILL.md

> **"Review early, review often."**  
> — requesting-code-review/SKILL.md

> **"More subagent invocations cost tokens, but catching issues early is cheaper than debugging later."**  
> — subagent-driven-development/SKILL.md (paraphrased from "Cost" section)

> **"Do NOT just increase timeouts - find the real issue."**  
> — dispatching-parallel-agents/SKILL.md (example prompt constraint)

> **"Categorize by actual severity (not everything is Critical)"**  
> — code-reviewer.md

> **"Be specific (file:line, not vague)"**  
> — code-reviewer.md

> **"If subagent fails task: Dispatch fix subagent with specific instructions. Don't try to fix manually (context pollution)."**  
> — subagent-driven-development/SKILL.md

---

## 10. Advantages Summary

### Subagent-Driven Development

**vs. Manual execution:**

- Subagents follow TDD naturally
- Fresh context per task (no confusion)
- Parallel-safe (subagents don't interfere)

**vs. Executing Plans:**

- Same session (no handoff)
- Continuous progress (no waiting)
- Review checkpoints automatic

**Cost tradeoff:**

- More subagent invocations
- But catches issues early (cheaper than debugging later)

---

### Dispatching Parallel Agents

**Benefits:**

1. **Parallelization** - Multiple investigations happen simultaneously
2. **Focus** - Each agent has narrow scope, less context to track
3. **Independence** - Agents don't interfere with each other
4. **Speed** - 3 problems solved in time of 1

**Verification after agents return:**

1. Review each summary - Understand what changed
2. Check for conflicts - Did agents edit same code?
3. Run full suite - Verify all fixes work together
4. Spot check - Agents can make systematic errors

---

### Requesting Code Review

**Benefits:**

- Catches issues before they compound
- Fresh perspective on implementation
- Validates against requirements
- Explicit severity tiers guide priority
- Clear verdict (Yes/No/With fixes)

**Integration:**

- Subagent-Driven Development: Review after EACH task
- Executing Plans: Review after each batch (3 tasks)
- Ad-Hoc Development: Review before merge, when stuck

---

## 11. Decision Tree: Which Pattern to Use?

```
What are you doing?
├─ Executing implementation plan?
│  ├─ Yes → Subagent-Driven Development
│  │  ├─ Fresh subagent per task
│  │  ├─ Code review after each task
│  │  └─ Same session, continuous progress
│  │
│  └─ No → Continue...
│
├─ Multiple independent failures?
│  ├─ Yes (3+) → Dispatching Parallel Agents
│  │  ├─ One agent per problem domain
│  │  ├─ Focused prompts with constraints
│  │  └─ Review and integrate results
│  │
│  └─ No → Continue...
│
└─ Completed task/feature?
   └─ Yes → Requesting Code Review
      ├─ Get git SHAs
      ├─ Dispatch code-reviewer subagent
      ├─ Fix Critical/Important issues
      └─ Proceed or merge
```

---

## 12. Prompt Templates Quick Reference

### Implementation Subagent

```
You are implementing Task N from [plan-file].
Read that task carefully. Your job is to:
1. Implement exactly what the task specifies
2. Write tests (following TDD if task says to)
3. Verify implementation works
4. Commit your work
5. Report back

Work from: [directory]
Report: What you implemented, what you tested, test results, files changed, any issues
```

### Parallel Investigation Subagent

```
Fix the 3 failing tests in [test-file]:
[Paste test names and error messages]

Your task:
1. Read the test file and understand what each test verifies
2. Identify root cause
3. Fix by: [strategy]

Do NOT [anti-pattern constraint]
Return: Summary of what you found and what you fixed.
```

### Fix Subagent

```
Fix issues from code review: [list issues]
Context: [what was just implemented]
Issues to fix:
1. [Issue with file:line]
2. [Issue with file:line]

Fix these issues and commit. Report what you changed.
```

### Code Reviewer Subagent

```
Review {WHAT_WAS_IMPLEMENTED}
Compare against {PLAN_OR_REQUIREMENTS}
Git range: {BASE_SHA}..{HEAD_SHA}

Output:
- Strengths (specific, with file:line)
- Issues (Critical/Important/Minor with file:line, why, how to fix)
- Recommendations
- Assessment (Ready to merge? Yes/No/With fixes + reasoning)
```

---

## 13. Context Pollution Prevention

**Problem:** Coordinator tries to fix subagent failures manually, polluting context with failed attempts.

**Solution:** Always dispatch fix subagent instead.

**Pattern:**

```
Subagent fails task → Review failure report → Dispatch fix subagent with:
  - What failed
  - Why it failed (from report)
  - Specific fix instructions
  - Constraints to prevent same failure
```

**Why it works:**

- Fix subagent has fresh context
- Coordinator maintains high-level coordination role
- No accumulated debugging cruft in coordinator context
- Parallel-safe (fix subagent doesn't interfere with other work)

---

## 14. File Reservation (Not in Source Docs)

**Note:** The analyzed skills don't mention file reservation, but this is a common coordination primitive for multi-agent systems.

**When it would apply:**

- Parallel agents editing potentially overlapping files
- Prevention of merge conflicts
- Coordination of shared state mutations

**Integration point:**

- Would fit in "Dispatching Parallel Agents" when agents might touch overlapping code
- Verification step: "Check for conflicts - Did agents edit same code?"

**For opencode-swarm-plugin:** Agent Mail has file reservation (`agentmail_reserve`, `agentmail_release`). This pattern could enhance parallel dispatch safety.

---

## END ANALYSIS

**Key takeaways for opencode-swarm-plugin:**

1. **Adopt fresh subagent per task** - Prevents context pollution, enables TDD naturally
2. **Mandatory code review between tasks** - Catches issues early, explicit severity tiers
3. **Parallelize at 3+ independent failures** - Clear heuristic for when to dispatch concurrent agents
4. **Focused agent prompts** - Self-contained, specific output, constraints prevent scope creep
5. **Never skip review because "it's simple"** - Simple tasks can have subtle issues
6. **Fix subagents instead of manual fixes** - Preserves coordinator context clarity
7. **Explicit severity tiers guide priority** - Critical blocks, Important before next task, Minor noted
8. **Same session vs parallel session** - Subagent-driven stays in session, executing-plans spawns parallel

**Patterns to integrate:**

- ✓ Fresh subagent per task (already in swarm worker pattern)
- ✓ Code review after each task (add to swarm_complete?)
- ✓ Parallel dispatch at 3+ failures (add to debug-plus command)
- ✓ Severity-based issue triage (integrate with UBS scan results)
- ✓ Fix subagent pattern (add to swarm toolkit)
