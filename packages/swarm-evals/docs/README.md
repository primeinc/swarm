# Eval-Driven Development with Progressive Gates

```
┌──────────────────────────────────────────────────────────────┐
│                   EVAL PIPELINE                              │
│                                                              │
│  CAPTURE → SCORE → STORE → GATE → LEARN → IMPROVE           │
│                                                              │
│  Real execution data feeds back into prompt generation       │
└──────────────────────────────────────────────────────────────┘
```

TypeScript-native evaluation framework for testing swarm task decomposition quality and coordinator discipline. Built on [Evalite](https://evalite.dev), powered by captured real-world execution data.

---

## Quick Start

```bash
# Run all evals once
bun run eval:run

# Run specific eval suite
bun run eval:decomposition    # Task decomposition quality
bun run eval:coordinator      # Coordinator protocol compliance
bun run eval:compaction       # Compaction prompt quality

# Check eval status (progressive gates)
swarm eval status

# View eval history with trends
swarm eval history
```

---

## Architecture

### The Pipeline

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│  1. CAPTURE (Real Execution)                                    │
│     ├─ Decomposition: task, strategy, subtasks                  │
│     ├─ Outcomes: duration, errors, retries, success             │
│     ├─ Coordinator Events: decisions, violations, compaction    │
│     └─ Store to: .opencode/eval-data.jsonl, sessions/*.jsonl   │
│                                                                 │
│  2. SCORE (Quality Metrics)                                     │
│     ├─ Subtask Independence (file conflicts)                    │
│     ├─ Complexity Balance (fair work distribution)              │
│     ├─ Coverage Completeness (files + scope)                    │
│     ├─ Instruction Clarity (actionable descriptions)            │
│     └─ Coordinator Discipline (protocol adherence)              │
│                                                                 │
│  3. STORE (History Tracking)                                    │
│     ├─ Record to: .opencode/eval-history.jsonl                  │
│     ├─ Track: score, timestamp, run_count                       │
│     └─ Calculate: phase, variance, baseline                     │
│                                                                 │
│  4. GATE (Progressive Quality Control)                          │
│     ├─ Bootstrap (<10 runs): Always pass, collect data          │
│     ├─ Stabilization (10-50 runs): Warn on >10% regression      │
│     └─ Production (>50 runs, variance <0.1): Fail on >5% drop   │
│                                                                 │
│  5. LEARN (Failure Feedback)                                    │
│     ├─ Detect: Significant score drops (>15% from baseline)     │
│     ├─ Store to: Semantic memory with tags                      │
│     └─ Query: Before generating future prompts                  │
│                                                                 │
│  6. IMPROVE (Continuous Refinement)                             │
│     └─ Future prompts query past failures for context           │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Progressive Gates (Phase-Based Quality Control)

The eval system uses **progressive gates** that adapt based on data maturity:

```
Phase             Runs    Variance    Gate Behavior
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Bootstrap         <10     N/A         ✅ Always pass (collect data)
Stabilization     10-50   N/A         ⚠️  Warn on >10% regression (pass)
Production        >50     <0.1        ❌ Fail on >5% regression
(High Variance)   >50     ≥0.1        ⚠️  Stay in stabilization
```

**Why progressive?**

- **Bootstrap**: No baseline yet, focus on data collection
- **Stabilization**: Baseline forming, tolerate noise while learning
- **Production**: Stable baseline, strict quality enforcement

**Variance threshold (0.1)**: Measures score consistency. High variance = unstable eval, stays in stabilization until it settles.

**Regression calculation**:
```
baseline = mean(historical_scores)
regression = (baseline - current_score) / baseline
```

---

## Eval Suites

### Swarm Decomposition (`swarm-decomposition.eval.ts`)

**What it measures:** Quality of task decomposition into parallel subtasks

**Data sources:**
- Fixtures: `fixtures/decomposition-cases.ts`
- Real captures: `.opencode/eval-data.jsonl`

**Scorers:**

| Scorer                   | Weight | What It Checks                                          | Perfect Score                      |
| ------------------------ | ------ | ------------------------------------------------------- | ---------------------------------- |
| **Subtask Independence** | 0.25   | No file overlaps between subtasks (prevents conflicts)  | 0 files in multiple subtasks       |
| **Complexity Balance**   | 0.25   | Work distributed evenly (coefficient of variation <0.3) | CV <0.3 (max/min complexity ratio) |
| **Coverage**             | 0.25   | Required files covered, subtask count in range          | All required files + 3-6 subtasks  |
| **Instruction Clarity**  | 0.25   | Descriptions actionable, files specified, titles clear  | >20 chars, files listed, specific  |

**Example output:**
```
swarm-decomposition
├─ subtaskIndependence: 1.0 (no conflicts)
├─ complexityBalance: 0.85 (CV: 0.22)
├─ coverageCompleteness: 1.0 (all files covered)
└─ instructionClarity: 0.90 (clear, actionable)
   → Overall: 0.94 ✅ PASS (stabilization phase)
```

### Coordinator Session (`coordinator-session.eval.ts`)

**What it measures:** Coordinator protocol adherence during swarm runs

**Data sources:**
- Real sessions: `~/.config/swarm-tools/sessions/*.jsonl`
- Fixtures: `fixtures/coordinator-sessions.ts`

**Scorers:**

| Scorer                       | Weight | What It Checks                                     | Perfect Score        |
| ---------------------------- | ------ | -------------------------------------------------- | -------------------- |
| **Violation Count**          | 0.30   | Protocol violations (edit files, run tests, etc.)  | 0 violations         |
| **Spawn Efficiency**         | 0.25   | Workers spawned / subtasks planned                 | 100% (all delegated) |
| **Review Thoroughness**      | 0.25   | Reviews completed / workers finished               | 100% (all reviewed)  |
| **Time to First Spawn**      | 0.20   | Speed from decomposition to first worker spawn     | <60 seconds          |
| **Overall Discipline** (composite) | 1.00   | Weighted composite of above | 1.0 (perfect) |

**Violations tracked:**
- `coordinator_edited_file` - Coordinator should NEVER edit directly
- `coordinator_ran_tests` - Workers run tests, not coordinator
- `coordinator_reserved_files` - Only workers reserve files
- `no_worker_spawned` - Coordinator must delegate, not do work itself

**Example output:**
```
coordinator-behavior
├─ violationCount: 1.0 (0 violations)
├─ spawnEfficiency: 1.0 (3/3 workers spawned)
├─ reviewThoroughness: 0.67 (2/3 reviewed)
└─ timeToFirstSpawn: 0.90 (45 seconds)
   → overallDiscipline: 0.89 ✅ PASS (bootstrap phase, collecting data)
```

#### Coordinator Session Capture (Deep Dive)

**How it works:** Session capture is fully automatic when coordinator tools are used. No manual instrumentation needed.

**Capture flow:**

```
┌─────────────────────────────────────────────────────────────┐
│                  SESSION CAPTURE FLOW                       │
│                                                             │
│  1. Coordinator tool call detected                          │
│     ├─ swarm_decompose, hive_create_epic, etc.              │
│     └─ Tool name + args inspected in real-time              │
│                                                             │
│  2. Violation detection (planning-guardrails.ts)            │
│     ├─ detectCoordinatorViolation() checks patterns         │
│     ├─ Edit/Write tools → coordinator_edited_file           │
│     ├─ bash with test patterns → coordinator_ran_tests      │
│     └─ swarmmail_reserve → coordinator_reserved_files       │
│                                                             │
│  3. Event emission (eval-capture.ts)                        │
│     ├─ captureCoordinatorEvent() validates via Zod          │
│     ├─ Appends JSONL line to session file                   │
│     └─ ~/.config/swarm-tools/sessions/{session_id}.jsonl    │
│                                                             │
│  4. Eval consumption (coordinator-session.eval.ts)          │
│     ├─ loadCapturedSessions() reads all *.jsonl files       │
│     ├─ Parses events, reconstructs sessions                 │
│     └─ Scorers analyze event sequences                      │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

**Event types:**

| Event Type     | Subtypes                                                              | When Captured                        |
| -------------- | --------------------------------------------------------------------- | ------------------------------------ |
| `DECISION`     | strategy_selected, worker_spawned, review_completed, decomposition_complete | Coordinator makes decision           |
| `VIOLATION`    | coordinator_edited_file, coordinator_ran_tests, coordinator_reserved_files, no_worker_spawned | Protocol violation detected          |
| `OUTCOME`      | subtask_success, subtask_retry, subtask_failed, epic_complete        | Worker completes or epic finishes    |
| `COMPACTION`   | detection_complete, prompt_generated, context_injected, resumption_started, tool_call_tracked | Compaction lifecycle events          |

**Violation detection patterns** (from `planning-guardrails.ts`):

```typescript
// File modification detection
VIOLATION_PATTERNS.FILE_MODIFICATION_TOOLS = ["edit", "write"];

// Test execution detection (regex patterns in bash commands)
VIOLATION_PATTERNS.TEST_EXECUTION_PATTERNS = [
  /\bbun\s+test\b/i,
  /\bnpm\s+(run\s+)?test/i,
  /\bjest\b/i,
  /\bvitest\b/i,
  // ... and 6 more patterns
];

// File reservation detection
VIOLATION_PATTERNS.RESERVATION_TOOLS = ["swarmmail_reserve", "agentmail_reserve"];
```

**Example session file** (`~/.config/swarm-tools/sessions/session-abc123.jsonl`):

```jsonl
{"session_id":"session-abc123","epic_id":"mjkw81rkq4c","timestamp":"2025-01-01T12:00:00Z","event_type":"DECISION","decision_type":"strategy_selected","payload":{"strategy":"feature-based"}}
{"session_id":"session-abc123","epic_id":"mjkw81rkq4c","timestamp":"2025-01-01T12:01:00Z","event_type":"DECISION","decision_type":"decomposition_complete","payload":{"subtask_count":3}}
{"session_id":"session-abc123","epic_id":"mjkw81rkq4c","timestamp":"2025-01-01T12:02:00Z","event_type":"DECISION","decision_type":"worker_spawned","payload":{"worker_id":"SwiftFire","cell_id":"mjkw81rkq4c.1"}}
{"session_id":"session-abc123","epic_id":"mjkw81rkq4c","timestamp":"2025-01-01T12:05:00Z","event_type":"VIOLATION","violation_type":"coordinator_edited_file","payload":{"tool":"edit","file":"src/auth.ts"}}
{"session_id":"session-abc123","epic_id":"mjkw81rkq4c","timestamp":"2025-01-01T12:10:00Z","event_type":"OUTCOME","outcome_type":"subtask_success","payload":{"cell_id":"mjkw81rkq4c.1","duration_ms":480000}}
```

**Viewing sessions:**

```bash
# List all captured sessions (coming soon)
swarm log sessions

# View specific session events
cat ~/.config/swarm-tools/sessions/session-abc123.jsonl | jq .

# Filter to violations only
cat ~/.config/swarm-tools/sessions/*.jsonl | jq 'select(.event_type == "VIOLATION")'

# Count violations by type
cat ~/.config/swarm-tools/sessions/*.jsonl | jq -r 'select(.event_type == "VIOLATION") | .violation_type' | sort | uniq -c
```

**Why JSONL format?**

- **Append-only**: No file locking, safe for concurrent writes
- **Streamable**: Process events one-by-one without loading full file
- **Line-oriented**: Easy to `grep`, `jq`, `tail -f` for live monitoring
- **Fault-tolerant**: Corrupted line doesn't break entire file

**Integration points:**

| Where                      | What Gets Captured                        | File                    |
| -------------------------- | ----------------------------------------- | ----------------------- |
| `swarm_decompose`          | DECISION: strategy_selected, decomposition_complete | sessions/*.jsonl        |
| `swarm_spawn_subtask`      | DECISION: worker_spawned                  | sessions/*.jsonl        |
| `swarm_review`             | DECISION: review_completed                | sessions/*.jsonl        |
| `swarm_complete`           | OUTCOME: subtask_success/failed           | sessions/*.jsonl        |
| Tool call inspection       | VIOLATION: (real-time pattern matching)   | sessions/*.jsonl        |
| Compaction hook            | COMPACTION: (all lifecycle stages)        | sessions/*.jsonl        |

**Source files:**

- **Schema**: `src/eval-capture.ts` - CoordinatorEventSchema (Zod discriminated union)
- **Violation detection**: `src/planning-guardrails.ts` - detectCoordinatorViolation()
- **Capture**: `src/eval-capture.ts` - captureCoordinatorEvent()
- **Scorers**: `evals/scorers/coordinator-discipline.ts` - violationCount, spawnEfficiency, etc.
- **Eval**: `evals/coordinator-session.eval.ts` - Real sessions + fixtures

### Compaction Prompt (`compaction-prompt.eval.ts`)

**What it measures:** Quality of continuation prompts after context compaction

**Data sources:**
- Captured compaction events from session files
- Test fixtures with known-good/bad prompts

**Scorers:**

| Scorer                           | Weight | What It Checks                                            | Perfect Score                    |
| -------------------------------- | ------ | --------------------------------------------------------- | -------------------------------- |
| **Epic ID Specificity**          | 0.20   | Real IDs (mjkw...) not placeholders (<epic-id>, bd-xxx)   | Real epic ID present             |
| **Actionability**                | 0.20   | Tool calls with real values (swarm_status with epic ID)   | Actionable tool with real values |
| **Coordinator Identity**         | 0.25   | ASCII header + strong mandates (NEVER/ALWAYS)             | ASCII box + strong language      |
| **Forbidden Tools Listed**       | 0.15   | Lists Edit, Write, swarmmail_reserve, git commit by name  | 4/4 forbidden tools listed       |
| **Post-Compaction Discipline**   | 0.20   | First suggested tool is swarm_status or inbox (not Edit)  | First tool correct               |

**Why these metrics?**

Post-compaction coordinators often "wake up" confused:
- Forget they're coordinators → start editing files
- Use placeholders → can't check actual status
- Weak language → ignore mandates
- Wrong first tool → dive into code instead of checking workers

**Example output:**
```
compaction-prompt
├─ epicIdSpecificity: 1.0 (real ID: mjkw81rkq4c)
├─ actionability: 1.0 (swarm_status with real epic ID)
├─ coordinatorIdentity: 1.0 (ASCII header + NEVER/ALWAYS)
├─ forbiddenToolsPresent: 1.0 (4/4 tools listed)
└─ postCompactionDiscipline: 1.0 (first tool: swarm_status)
   → Overall: 1.0 ✅ PASS (production phase)
```

---

## Data Capture

### What Gets Captured

**Decomposition Events** (`.opencode/eval-data.jsonl`):
```jsonl
{
  "id": "mjkw81rkq4c",
  "timestamp": "2025-01-01T12:00:00Z",
  "task": "Add OAuth authentication",
  "strategy": "feature-based",
  "epic_title": "OAuth Implementation",
  "subtasks": [...],
  "outcomes": [...]
}
```

**Coordinator Sessions** (`~/.config/swarm-tools/sessions/<session-id>.jsonl`):
```jsonl
{"event_type": "DECISION", "decision_type": "strategy_selected", ...}
{"event_type": "DECISION", "decision_type": "worker_spawned", ...}
{"event_type": "VIOLATION", "violation_type": "coordinator_edited_file", ...}
{"event_type": "COMPACTION", "compaction_type": "prompt_generated", ...}
```

**Eval History** (`.opencode/eval-history.jsonl`):
```jsonl
{"timestamp": "...", "eval_name": "swarm-decomposition", "score": 0.92, "run_count": 15}
```

### Capture Points (Automatic)

| Integration Point          | What Gets Captured                    | File                    |
| -------------------------- | ------------------------------------- | ----------------------- |
| `swarm_decompose`          | Task, strategy, subtasks              | eval-data.jsonl         |
| `swarm_complete`           | Outcome signals (duration, errors)    | eval-data.jsonl         |
| `swarm_record_outcome`     | Learning signals                      | swarm-mail database     |
| Coordinator spawn          | Worker spawn event                    | sessions/*.jsonl        |
| Coordinator review         | Review decision                       | sessions/*.jsonl        |
| Compaction hook            | Prompt content, detection results     | sessions/*.jsonl        |
| Evalite runner             | Score, baseline, phase                | eval-history.jsonl      |

---

## CLI Commands

### `swarm eval status [eval-name]`

Shows current phase, gate thresholds, and recent scores with sparklines.

```bash
$ swarm eval status swarm-decomposition

┌─────────────────────────────────────────────────────────────┐
│  Eval: swarm-decomposition                                  │
│  Phase: 🚀 Production (53 runs, variance: 0.08)             │
│                                                             │
│  Gate Thresholds:                                           │
│  ├─ Stabilization: >10% regression (warn)                   │
│  └─ Production:    >5% regression (fail)                    │
│                                                             │
│  Recent Scores (last 10 runs):                              │
│  0.92 ▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇ 2025-01-01 12:00                 │
│  0.89 ▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇   2025-01-01 11:30                 │
│  0.94 ▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇ 2025-01-01 11:00                 │
│  Baseline: 0.91 | Variance: 0.08 | Trend: ↗                │
└─────────────────────────────────────────────────────────────┘
```

**Phase indicators:**
- 🌱 Bootstrap - Collecting data
- ⚙️ Stabilization - Learning baseline
- 🚀 Production - Enforcing quality

### `swarm eval history`

Shows eval run history grouped by eval name with trends and color-coded scores.

```bash
$ swarm eval history

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
swarm-decomposition (53 runs)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Run #53  0.92  2025-01-01 12:00:00  ✅ PASS
Run #52  0.89  2025-01-01 11:30:00  ✅ PASS
Run #51  0.94  2025-01-01 11:00:00  ✅ PASS
...
Sparkline: ▁▂▃▄▅▆▇█▇▆▅▄▃▂▁▂▃▄▅▆▇█
Trend: ↗ (improving)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
coordinator-behavior (8 runs)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Run #8   0.85  2025-01-01 10:00:00  ⚠️  WARN
Run #7   0.91  2025-01-01 09:30:00  ✅ PASS
...
```

**Color coding:**
- 🟢 Green: ≥0.8 (pass/high score)
- 🟡 Yellow: 0.6-0.8 (warning/medium score)
- 🔴 Red: <0.6 (fail/low score)

### `swarm eval run` (Stub)

Placeholder for future direct eval execution from CLI.

---

## CI Integration

### GitHub Actions Workflow

Progressive gates integrate with CI for PR checks:

```yaml
# .github/workflows/eval-check.yml
name: Eval Quality Gate

on:
  pull_request:
    branches: [main]

jobs:
  eval-gate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - name: Setup Bun
        uses: oven-sh/setup-bun@v1
      
      - name: Install deps
        run: bun install
      
      - name: Run evals
        run: bun run eval:run
      
      - name: Check gates
        run: |
          # Check if any eval failed production gate
          swarm eval status | grep "FAIL" && exit 1 || exit 0
      
      - name: Post PR comment
        if: failure()
        uses: actions/github-script@v7
        with:
          script: |
            // Post detailed gate failure to PR
            const status = await exec.getExecOutput('swarm eval status');
            github.rest.issues.createComment({
              issue_number: context.issue.number,
              body: `## ❌ Eval Gate Failed\n\n\`\`\`\n${status.stdout}\n\`\`\``
            });
```

**Gate behavior in CI:**
- Bootstrap: Always pass (collecting data)
- Stabilization: Pass but warn on >10% regression
- Production: **FAIL PR** on >5% regression

---

## Writing New Evals

### 1. Create Eval File

```typescript
// evals/my-feature.eval.ts
import { evalite } from "evalite";
import { createScorer } from "evalite";

// Define your scorer
const myScorer = createScorer({
  name: "My Quality Metric",
  description: "Checks if feature meets quality bar",
  scorer: async ({ output, expected, input }) => {
    // Implement scoring logic
    const score = /* calculate 0-1 score */;
    return { 
      score, 
      message: "Details about score" 
    };
  },
});

// Define the eval
evalite("My Feature Quality", {
  data: async () => {
    // Load test cases
    return [
      {
        input: "test input",
        expected: { /* expected structure */ },
      },
    ];
  },
  task: async (input) => {
    // Call your system under test
    const output = await myFeature(input);
    return output;
  },
  scorers: [myScorer],
});
```

### 2. Add to Package Scripts

```json
{
  "scripts": {
    "eval:my-feature": "bunx evalite run evals/my-feature.eval.ts"
  }
}
```

### 3. Add Capture Points

Wire your feature to capture real execution data:

```typescript
import { captureMyFeatureEvent } from "./eval-capture.js";

async function myFeature(input) {
  const startTime = Date.now();
  
  try {
    const result = await doWork(input);
    
    // Capture success
    captureMyFeatureEvent({
      input,
      output: result,
      duration_ms: Date.now() - startTime,
      success: true,
    });
    
    return result;
  } catch (error) {
    // Capture failure
    captureMyFeatureEvent({
      input,
      error: error.message,
      duration_ms: Date.now() - startTime,
      success: false,
    });
    throw error;
  }
}
```

### 4. Test Locally

```bash
# Run your eval
bun run eval:my-feature

# Check status
swarm eval status my-feature

# View history
swarm eval history
```

---

## Scorer Reference

### Scorer Pattern (Evalite v1.0)

**IMPORTANT**: Evalite scorers are **async functions**, not objects with `.scorer` property.

```typescript
import { createScorer } from "evalite";

// CORRECT ✅
const myScorer = createScorer({
  name: "My Scorer",
  description: "What it measures",
  scorer: async ({ output, expected, input }) => {
    return { score: 0.8, message: "Details" };
  },
});

// Use in eval
evalite("test", {
  scorers: [myScorer],  // Pass the scorer directly
});

// In composite scorers
const result = await childScorer({ output, expected, input });
const score = result.score ?? 0;
```

**WRONG ❌**:
```typescript
// Don't do this - .scorer property doesn't exist
const result = childScorer.scorer({ output, expected });  // ❌
```

### Custom Scorer Template

```typescript
export const myCustomScorer = createScorer({
  name: "My Custom Metric",
  description: "Detailed description of what this measures and why it matters",
  scorer: async ({ output, expected, input }) => {
    // 1. Parse output
    let data;
    try {
      data = typeof output === "string" ? JSON.parse(output) : output;
    } catch {
      return { score: 0, message: "Invalid output format" };
    }

    // 2. Calculate score (0-1 range)
    const score = calculateYourMetric(data, expected);

    // 3. Return with detailed message
    return {
      score,
      message: `Score: ${score.toFixed(2)} - ${getExplanation(score)}`,
    };
  },
});
```

---

## Troubleshooting

### "No eval history found"

**Cause:** Haven't run any evals yet or `.opencode/eval-history.jsonl` missing.

**Fix:**
```bash
# Run an eval to create history
bun run eval:decomposition
swarm eval status  # Should show bootstrap phase
```

### "Phase stuck in stabilization despite >50 runs"

**Cause:** High variance (≥0.1). Scores not consistent enough for production phase.

**Fix:** Investigate why scores fluctuate:
```bash
# Check variance
swarm eval status my-eval  # Shows variance value

# View score history to spot outliers
swarm eval history

# Common causes:
# - Eval depends on external state (network, filesystem)
# - Non-deterministic scoring logic
# - Input data changing between runs
```

### "Gate failing on minor changes"

**Cause:** Production phase threshold (5%) too strict for your use case.

**Fix:** Adjust threshold in eval code:
```typescript
import { checkGate } from "../src/eval-gates.js";

const result = checkGate(projectPath, evalName, score, {
  productionThreshold: 0.10,  // 10% instead of 5%
});
```

### "Evalite not finding my eval file"

**Cause:** File not matching `*.eval.ts` pattern or not in `evals/` directory.

**Fix:**
```bash
# Ensure file is named correctly
mv evals/my-test.ts evals/my-test.eval.ts

# Verify discovery
bunx evalite run evals/  # Should list your eval
```

### "Scorers returning undefined"

**Cause:** Forgot to `await` async scorers or accessing `.scorer` property (doesn't exist).

**Fix:**
```typescript
// CORRECT ✅
const result = await myScorer({ output, expected, input });
const score = result.score ?? 0;

// WRONG ❌
const result = myScorer.scorer({ output, expected });  // .scorer doesn't exist
```

---

## File Structure

```
evals/
├── README.md                         # This file
├── evalite.config.ts                 # Evalite configuration
│
├── fixtures/
│   ├── decomposition-cases.ts        # Test cases for decomposition
│   ├── coordinator-sessions.ts       # Known good/bad coordinator sessions
│   └── compaction-prompts.ts         # Sample compaction prompts
│
├── lib/
│   ├── data-loader.ts                # Load eval data from JSONL files
│   └── test-helpers.ts               # Shared test utilities
│
├── scorers/
│   ├── decomposition-scorers.ts      # Subtask quality scorers
│   ├── coordinator-scorers.ts        # Protocol adherence scorers
│   └── compaction-prompt-scorers.ts  # Prompt quality scorers
│
├── swarm-decomposition.eval.ts       # Decomposition quality eval
├── coordinator-session.eval.ts       # Coordinator discipline eval
├── compaction-prompt.eval.ts         # Compaction prompt quality eval
└── example.eval.ts                   # Sanity check / template
```

**Data locations:**
- `.opencode/eval-data.jsonl` - Decomposition captures
- `.opencode/eval-history.jsonl` - Score history
- `~/.config/swarm-tools/sessions/*.jsonl` - Coordinator sessions

---

## Further Reading

- **[Evalite Docs](https://evalite.dev)** - Evaluation framework
- **[Progressive Gates Implementation](../src/eval-gates.ts)** - Phase-based quality control
- **[Learning Feedback Loop](../src/eval-learning.ts)** - Auto-store failures to memory
- **[Data Capture](../src/eval-capture.ts)** - Real execution tracking
- **[Compaction Scorers](../src/compaction-prompt-scoring.ts)** - Pure scoring functions

> _"Measure outcomes, not outputs. The system that learns from failure beats the system that avoids it."_  
> — Inspired by Site Reliability Engineering principles
