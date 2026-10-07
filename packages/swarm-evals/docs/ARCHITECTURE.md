# Eval Infrastructure Architecture Analysis

```
┌─────────────────────────────────────────────────────────────────────┐
│                    EVAL INFRASTRUCTURE FLOW                         │
│                                                                     │
│  ┌──────────┐      ┌──────────┐      ┌──────────┐      ┌────────┐ │
│  │ CAPTURE  │─────▶│  STORE   │─────▶│  LOAD    │─────▶│  EVAL  │ │
│  └──────────┘      └──────────┘      └──────────┘      └────────┘ │
│       │                                     │                 │     │
│       │ Tool calls                          │ Data loaders   │     │
│       │ Violations                          │ Fixtures       │     │
│       │ Outcomes                            │                │     │
│       ▼                                     ▼                ▼     │
│  [sessions/*.jsonl]               [PGlite eval_records]  [Scorers]│
│  [eval-data.jsonl]                [Fixtures]              [Gates] │
│                                                                     │
│                     ┌──────────────────┐                           │
│                     │  FEEDBACK LOOP   │                           │
│                     ├──────────────────┤                           │
│                     │  Gate Check      │                           │
│                     │  Learn from Fail │                           │
│                     │  Store Memory    │                           │
│                     └──────────────────┘                           │
└─────────────────────────────────────────────────────────────────────┘
```

**Date:** 2025-12-25  
**Agent:** BlueForest  
**Cell:** opencode-swarm-plugin--ys7z8-mjlk7jsilk9

---

## Executive Summary

The eval infrastructure is a **progressive quality control system** that captures real execution data, scores it against quality criteria, and enforces adaptive gates based on data maturity. The architecture follows a clean pipeline: **CAPTURE → STORE → LOAD → EVAL → GATE → LEARN**.

**Key strengths:**
- Clear separation of concerns (loaders, scorers, evals)
- Progressive gates prevent premature failures
- Real data integration (not just synthetic fixtures)
- Learning feedback loop (regressions → semantic memory)

**Key issues identified:**
1. **Data loader abstraction leak** - Loaders know too much about storage format
2. **Scorer composition complexity** - Composite scorers have brittle async patterns
3. **Fixture vs real data switching** - Implicit fallback logic scattered in eval files
4. **Session filtering buried in loader** - Quality criteria hardcoded in data-loader.ts
5. **No eval versioning** - Schema changes could break historical data

---

## Component Architecture

### 1. Data Capture (`src/eval-capture.ts`)

**Purpose:** Automatically capture real execution data during swarm runs.

**Event Types:**
- `DECISION` - Coordinator decisions (strategy selected, worker spawned, review completed)
- `VIOLATION` - Protocol violations (edited files, ran tests, reserved files)
- `OUTCOME` - Task outcomes (success, retry, failure, epic complete)
- `COMPACTION` - Context compaction lifecycle (detection, prompt generation, resumption)

**Storage:**
- **Sessions:** `~/.config/swarm-tools/sessions/{session-id}.jsonl` (append-only JSONL)
- **Eval Records:** PGlite `eval_records` table (via swarm-mail)
- **History:** `.opencode/eval-history.jsonl` (local project)

**Schema:** Zod discriminated union (`CoordinatorEventSchema`) - type-safe with exhaustive checks.

**Capture points:**
- `swarm_decompose` - Captures strategy, decomposition
- `swarm_complete` - Captures outcomes (duration, errors, retries)
- Tool call inspection - Real-time violation detection via pattern matching
- Compaction hook - Lifecycle tracking

**Strengths:**
- Zod validation prevents garbage data
- JSONL format is append-only, fault-tolerant, streamable
- Discriminated union makes event types exhaustive

**Issues:**
- **No schema versioning** - Future schema changes could break old data
- **Session directory hardcoded** - `~/.config/swarm-tools/sessions/` not configurable per project

---

### 2. Data Loaders (`evals/lib/`)

#### `data-loader.ts` - PGlite + Session Loader

**Purpose:** Load real data from PGlite (`eval_records`) and session JSONL files.

**Key functions:**
- `loadEvalCases()` - Query PGlite for decomposition eval records
- `loadCapturedSessions()` - Read coordinator sessions from JSONL
- `hasRealEvalData()` - Check if enough data exists for real eval
- `getEvalDataSummary()` - Stats for reporting

**Session Quality Filters:**
```typescript
{
  minEvents: 3,              // Filter incomplete sessions
  requireWorkerSpawn: true,  // Ensure delegation happened
  requireReview: true,       // Ensure coordinator reviewed work
}
```

**Strengths:**
- Quality filters reduce noise (only 3/100 sessions passed in coordinator-session eval)
- Stats functions provide transparency (logs which data source is used)

**Issues:**
1. **Abstraction leak** - Loader knows about PGlite internals AND JSONL format
   - Should have separate `PGliteEvalSource` and `JsonlEvalSource` adapters
2. **Quality criteria hardcoded** - Filters baked into loader, not configurable at call site
   - `requireReview: true` prevents testing coordinators who skip reviews
3. **Transform logic mixed with loading** - `meetsQualityCriteria()` is business logic, not I/O
4. **No data versioning** - Can't handle schema evolution (what if event types change?)

**Recommendation:**
```typescript
// Separate concerns
interface EvalSource {
  load(filters: EvalFilters): Promise<EvalCase[]>;
  stats(): Promise<EvalStats>;
}

class PGliteEvalSource implements EvalSource { /* ... */ }
class JsonlSessionSource implements EvalSource { /* ... */ }

// Make filters first-class
type SessionFilter = (session: CoordinatorSession) => boolean;
const filters = {
  minEvents: (n: number) => (s) => s.events.length >= n,
  requireWorkerSpawn: (s) => s.events.some(e => e.decision_type === "worker_spawned"),
  compose: (...fns) => (s) => fns.every(f => f(s)),
};
```

#### `compaction-loader.ts` - COMPACTION Event Loader

**Purpose:** Load COMPACTION events from session JSONL files for compaction-prompt eval.

**Key functions:**
- `loadCompactionEvents()` - Stream COMPACTION events with early termination
- `loadCompactionSessions()` - Group events by session_id
- `loadDefaultCompaction*()` - Convenience wrappers for default session dir

**Features:**
- **Lazy loading** - Streams large files line-by-line (avoids memory bloat)
- **Early termination** - Stops reading when limit reached
- **Graceful errors** - Skips invalid lines, logs warnings

**Strengths:**
- Clean single-responsibility (only COMPACTION events)
- Performance-conscious (streaming for large datasets)
- Type-safe with discriminated union extraction

**Issues:**
1. **Streaming threshold arbitrary** - `limit < 100` triggers streaming - why 100?
   - Should stream by file size, not result limit
2. **Duplicate logic** - `parseLine()` duplicated between loaders
   - Should be shared utility in `eval-capture.ts`
3. **No pagination** - Returns all matches up to limit, can't resume
   - Real-world use case: "Load next 10 sessions" for UI

**Recommendation:**
```typescript
// Shared utilities in eval-capture.ts
export function parseEventLine(line: string): CoordinatorEvent | null;
export function* streamEvents(filePath: string): Generator<CoordinatorEvent>;

// Pagination support
interface PaginatedResult<T> {
  data: T[];
  cursor: string | null; // file:line for resumption
  hasMore: boolean;
}
```

#### `llm.ts` - LLM Client for Evals

**Purpose:** Generate decompositions via LLM for testing (swarm-decomposition eval).

**Key functions:**
- `generateDecomposition()` - Call Claude via AI SDK + Vercel Gateway
- `formatDecompositionPrompt()` - Template prompt for decomposition
- `extractJson()` - Parse JSON from LLM responses (handles markdown wrapping)

**Gateway pattern:**
```typescript
const { text } = await generateText({
  model: gateway("anthropic/claude-sonnet-4-5"),
  prompt,
  maxOutputTokens: 4096,
});
```

**Strengths:**
- Gateway abstraction hides provider details (just pass "provider/model")
- JSON extraction handles markdown code blocks (common LLM quirk)
- Prompt template matches production `swarm_plan_prompt`

**Issues:**
1. **No retry logic** - Single LLM call, no fallback on failure
   - Network errors or rate limits fail entire eval run
2. **Hardcoded model** - `DEFAULT_MODEL` not overridable at runtime
   - Can't test with different models without code change
3. **No response caching** - Repeated eval runs re-generate same decompositions
   - Wastes $ and time for deterministic inputs

**Recommendation:**
```typescript
// Retry wrapper
export async function generateWithRetry(
  prompt: string,
  options?: { model?: GatewayModelId; retries?: number; cache?: boolean }
): Promise<string>;

// Cache layer
const cacheKey = hash(prompt + model);
if (cache.has(cacheKey)) return cache.get(cacheKey);
```

---

### 3. Scorers (`evals/scorers/`)

**Purpose:** Score eval outputs against quality criteria. Return `{ score: 0-1, message: string }`.

**Evalite pattern:**
```typescript
export const myScorer = createScorer({
  name: "My Scorer",
  description: "What it measures",
  scorer: async ({ output, expected, input }) => {
    return { score: 0.8, message: "Details" };
  },
});
```

#### Scorer Categories

| File | Scorers | What They Measure |
|------|---------|-------------------|
| `index.ts` | `subtaskIndependence`, `coverageCompleteness`, `instructionClarity`, `decompositionCoherence` | Decomposition quality |
| `coordinator-discipline.ts` | `violationCount`, `spawnEfficiency`, `reviewThoroughness`, `timeToFirstSpawn`, `overallDiscipline` | Coordinator protocol adherence |
| `compaction-scorers.ts` | `confidenceAccuracy`, `contextInjectionCorrectness`, `requiredPatternsPresent`, `forbiddenPatternsAbsent`, `compactionQuality` | Compaction correctness |
| `compaction-prompt-scorers.ts` | `epicIdSpecificity`, `actionability`, `coordinatorIdentity`, `forbiddenToolsPresent`, `postCompactionDiscipline` | Continuation prompt quality |
| `outcome-scorers.ts` | `executionSuccess`, `timeBalance`, `scopeAccuracy`, `scopeDrift`, `noRework` | Real execution outcomes |

**Composite Scorer Pattern:**
```typescript
export const overallDiscipline = createScorer({
  name: "Overall Discipline",
  description: "Weighted composite of all discipline scorers",
  scorer: async ({ output, expected, input }) => {
    // Call child scorers
    const violations = await violationCount({ output, expected, input });
    const spawn = await spawnEfficiency({ output, expected, input });
    const review = await reviewThoroughness({ output, expected, input });
    const time = await timeToFirstSpawn({ output, expected, input });

    // Weighted average
    const score = 
      (violations.score ?? 0) * 0.30 +
      (spawn.score ?? 0) * 0.25 +
      (review.score ?? 0) * 0.25 +
      (time.score ?? 0) * 0.20;

    return { score, message: "Composite score" };
  },
});
```

**Strengths:**
- Clear single-responsibility (each scorer tests one thing)
- Composite scorers enable weighted evaluation
- Type-safe with Zod schemas for output parsing
- Null-safe scoring (`score ?? 0` handles scorer failures gracefully)

**Issues:**
1. **Async composition fragility** - Must `await` each child scorer
   - Easy to forget, causes `Promise<Score>` type errors
   - Semantic memory shows this bit TWO files recently
2. **No scorer versioning** - Scorer logic changes invalidate historical comparisons
   - Can't tell if score dropped due to regression or scorer change
3. **Hardcoded weights** - `0.30`, `0.25`, etc. not configurable
   - Can't experiment with different weight profiles
4. **LLM-as-judge cost** - `decompositionCoherence` calls Claude for each test case
   - No cost controls or budgets
   - No fallback if LLM fails

**Recommendation:**
```typescript
// Versioned scorers
export const violationCount_v1 = createScorer({ /* ... */ });
export const violationCount_v2 = createScorer({ /* ... */ });

// Configurable weights
export function createOverallDiscipline(weights: {
  violations: number;
  spawn: number;
  review: number;
  time: number;
}) { /* ... */ }

// LLM budget
const JUDGE_BUDGET = { maxCalls: 100, maxCost: 1.00 };
```

---

### 4. Eval Files (`evals/*.eval.ts`)

**Purpose:** Define eval test suites using Evalite framework.

**Pattern:**
```typescript
evalite("Eval Name", {
  data: async () => [...testCases],
  task: async (input) => /* generate output */,
  scorers: [scorer1, scorer2, ...],
});
```

#### Eval Suites

| File | Data Source | Task | Scorers |
|------|-------------|------|---------|
| `swarm-decomposition.eval.ts` | PGlite or fixtures | LLM generates decomposition | Independence, coverage, clarity, coherence |
| `coordinator-session.eval.ts` | Session JSONL or fixtures | Identity (session as JSON) | Violations, spawn, review, time, discipline |
| `compaction-prompt.eval.ts` | Fixtures only | Identity (fixture prompts) | Epic ID, actionability, identity, tools, discipline |
| `compaction-resumption.eval.ts` | Compaction events | Compaction logic | Confidence, injection, patterns, quality |

**Data Source Switching:**
```typescript
const useRealData = await hasRealEvalData(PROJECT_KEY, 5, PROJECT_PATH);
const evalCases = useRealData
  ? await loadEvalCases(PROJECT_KEY, { limit: 20, projectPath: PROJECT_PATH })
  : decompositionCases.map((testCase) => ({ input: testCase.input, expected: testCase.expected }));
```

**Strengths:**
- Progressive data source (fixtures → real data as it accumulates)
- Transparency (logs which source is used)
- Multiple test suites per eval file (edge cases, perfect vs bad, etc.)

**Issues:**
1. **Data source logic duplicated** - Every eval file has same `hasRealEvalData` check
   - Should be abstracted into data loader
2. **Hard limit of 20 cases** - `limit: 20` hardcoded
   - No way to run full dataset locally
3. **No eval parameterization** - Can't run same eval with different configs
   - E.g., "test with max_subtasks=4" vs "max_subtasks=8"
4. **Identity task for fixtures** - `task: async (input) => JSON.stringify(input)` is wasteful
   - Fixtures already have output, no need to "generate" it
   - Should have `FixtureEval` vs `GenerativeEval` types

**Recommendation:**
```typescript
// Data source abstraction
const dataSource = await selectDataSource(PROJECT_KEY, {
  preferReal: true,
  fallbackToFixtures: true,
  limit: process.env.CI ? 5 : undefined, // Full dataset locally, sample in CI
});

// Eval parameterization
evalite.parameterize("Decomposition Quality", {
  params: [
    { maxSubtasks: 4, strategy: "file-based" },
    { maxSubtasks: 8, strategy: "feature-based" },
  ],
  data: async ({ maxSubtasks, strategy }) => /* ... */,
});
```

---

### 5. Progressive Gates (`src/eval-gates.ts`)

**Purpose:** Enforce quality gates based on eval maturity phase.

**Phases:**
- **Bootstrap (<10 runs):** Always pass, collect baseline data
- **Stabilization (10-50 runs):** Warn on >10% regression (default), but pass
- **Production (>50 runs + variance <0.1):** Fail on >5% regression (default)

**Gate Logic:**
```typescript
export function checkGate(
  projectPath: string,
  evalName: string,
  currentScore: number,
  config?: GateConfig
): GateResult {
  const phase = getPhase(projectPath, evalName);
  const history = getScoreHistory(projectPath, evalName);
  const baseline = calculateBaseline(history, currentScore);
  const regressionPercent = (baseline - currentScore) / baseline;

  // Phase-specific thresholds
  if (phase === "bootstrap") return { passed: true, ... };
  if (phase === "stabilization") return { passed: true, warn: regressionPercent > 0.10, ... };
  if (phase === "production") return { passed: regressionPercent <= 0.05, ... };
}
```

**Variance Threshold:**
- High variance (≥0.1) keeps eval in stabilization even with >50 runs
- Prevents premature production gates when scores unstable
- Current issue: coordinator-session has high variance (only 3/100 sessions pass filters)

**Strengths:**
- Adaptive thresholds prevent premature failures
- Variance check prevents false confidence
- Configurable thresholds per eval

**Issues:**
1. **Baseline calculation naive** - Simple mean of all scores
   - Doesn't handle outliers or trends
   - Early bad runs drag down baseline forever
2. **No time-based decay** - Old scores weighted equally with new
   - Eval improvements don't raise baseline fast enough
3. **No CI/PR integration hooks** - Gates check but don't post results
   - Documented in README but not implemented
4. **Variance threshold magic number** - 0.1 chosen arbitrarily
   - Should be configurable or derived from data

**Recommendation:**
```typescript
// Weighted baseline (recent scores matter more)
function calculateWeightedBaseline(
  history: EvalRunRecord[],
  decayFactor: number = 0.9 // Recent = 1.0, older = 0.9^n
): number;

// Outlier-resistant baseline (median or trimmed mean)
function calculateRobustBaseline(
  history: EvalRunRecord[],
  trimPercent: number = 0.1 // Trim top/bottom 10%
): number;

// CI posting
export function postGateResultToGitHub(
  result: GateResult,
  prNumber: number,
  repo: string
): Promise<void>;
```

---

### 6. Learning Feedback Loop (`src/eval-learning.ts`)

**Purpose:** Automatically store eval failures to semantic memory for learning.

**Trigger:** Score drops >15% (configurable) from rolling average baseline.

**Flow:**
```typescript
const result = await learnFromEvalFailure(
  evalName,
  currentScore,
  history,
  memoryAdapter,
  { config: { dropThreshold: 0.15, windowSize: 5 } }
);

if (result.triggered) {
  // Stored to semantic-memory with tags:
  // - "eval-failure"
  // - "{eval-name}"
  // - "regression"
}
```

**Stored Context:**
- Eval name
- Baseline score (rolling average)
- Current score
- Drop percentage
- Timestamp
- Optional scorer details (which scorer failed)

**Strengths:**
- Automatic detection (no manual annotation)
- Rolling average baseline (more stable than last-run comparison)
- Configurable sensitivity (threshold + window size)
- Structured metadata for querying

**Issues:**
1. **No retrieval integration** - Memories stored but not queried before eval runs
   - Should inject past failures into LLM prompts for context
2. **No failure analysis** - Stores "score dropped" but not "why"
   - Should include which test cases failed, what changed
3. **No auto-remediation** - Human must read memory and act
   - Could auto-generate hypotheses or suggested fixes
4. **Memory pollution risk** - Noisy evals create spam memories
   - Should require multiple consecutive drops before storing

**Recommendation:**
```typescript
// Retrieval hook
export async function queryEvalFailures(
  evalName: string,
  memoryAdapter: MemoryAdapter
): Promise<Memory[]> {
  return memoryAdapter.find({
    query: evalName,
    tags: ["eval-failure", "regression"],
    limit: 5,
  });
}

// Failure analysis
export function analyzeFailure(
  evalName: string,
  currentRun: EvalResult,
  previousRun: EvalResult
): FailureAnalysis {
  // Diff test cases, scorer outputs, etc.
}

// Spam prevention
if (recentDrops.length >= 3) {
  // Only store if consistent regression
  storeMemory();
}
```

---

## Data Flow Architecture

### Capture Flow

```
┌─────────────────────────────────────────────────────────────┐
│                   REAL-TIME CAPTURE                         │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  1. Coordinator calls swarm tool                            │
│     ├─ swarm_decompose(task="Add auth")                     │
│     ├─ swarm_spawn_subtask(cell_id="bd-123.1")              │
│     └─ swarm_review(task_id="bd-123.1")                     │
│                                                             │
│  2. Tool execution                                          │
│     ├─ planning-guardrails.ts detects violations            │
│     │  (pattern matching on tool name + args)               │
│     └─ eval-capture.ts emits events                         │
│                                                             │
│  3. Event storage                                           │
│     ├─ Session JSONL: ~/.config/swarm-tools/sessions/...    │
│     ├─ PGlite: eval_records table                           │
│     └─ History: .opencode/eval-history.jsonl                │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

**Key characteristic:** Capture is **passive** - no manual instrumentation needed. Tool calls are inspected in real-time.

### Load → Eval Flow

```
┌─────────────────────────────────────────────────────────────┐
│                      EVAL EXECUTION                         │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  1. Data Loading                                            │
│     ├─ Check: hasRealEvalData(projectKey, minRecords=5)    │
│     ├─ If true: loadEvalCases(projectKey, limit=20)        │
│     └─ If false: Use fixtures (decomposition-cases.ts)     │
│                                                             │
│  2. Task Execution                                          │
│     ├─ Generative: LLM generates decomposition              │
│     └─ Identity: Fixture data as-is (JSON.stringify)       │
│                                                             │
│  3. Scoring                                                 │
│     ├─ Parse output (JSON, Zod validation)                  │
│     ├─ Run scorers in parallel (async composition)          │
│     └─ Composite scorer: weighted average                   │
│                                                             │
│  4. Gate Check                                              │
│     ├─ getPhase(projectPath, evalName)                      │
│     ├─ calculateBaseline(history)                           │
│     ├─ calculateRegression(baseline, currentScore)          │
│     └─ Return GateResult { passed, phase, message }         │
│                                                             │
│  5. Learning                                                │
│     ├─ isSignificantDrop(current, baseline, threshold)      │
│     ├─ If true: storeMemory(evalName, context, tags)        │
│     └─ Return LearningResult { triggered, memory_id }       │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

**Key characteristic:** Load flow has **implicit fallback** (real data → fixtures). This is scattered across eval files, not centralized.

---

## Structural Issues & Recommendations

### Issue 1: Data Loader Abstraction Leak

**Problem:** `data-loader.ts` knows about PGlite internals AND JSONL format. Violates single-responsibility.

**Impact:**
- Hard to test (mocking requires PGlite + file I/O)
- Hard to extend (adding CSV source requires modifying data-loader.ts)
- Tight coupling to storage format

**Solution:**
```typescript
// Define source interface
interface EvalSource<T> {
  load(filters: FilterSpec): Promise<T[]>;
  stats(): Promise<SourceStats>;
}

// Implement sources
class PGliteDecompositionSource implements EvalSource<EvalCase> { /* ... */ }
class JsonlSessionSource implements EvalSource<CoordinatorSession> { /* ... */ }
class FixtureSource<T> implements EvalSource<T> { /* ... */ }

// Compose in eval files
const source = await selectSource<EvalCase>({
  preferReal: new PGliteDecompositionSource(projectKey),
  fallback: new FixtureSource(decompositionCases),
  minRecords: 5,
});

const data = await source.load({ limit: 20 });
```

**Benefits:**
- Sources testable in isolation
- Easy to add new sources (S3, API, etc.)
- Explicit fallback strategy (not hardcoded)

### Issue 2: Session Quality Filters Hardcoded

**Problem:** Quality criteria baked into `loadCapturedSessions()` - can't test coordinators who skip reviews.

**Impact:**
- Only 3/100 sessions passed filters in coordinator-session eval
- Can't experiment with different filter profiles
- Hidden filtering (caller doesn't control criteria)

**Solution:**
```typescript
// Make filters first-class, composable
type SessionFilter = (session: CoordinatorSession) => boolean;

const filters = {
  minEvents: (n: number): SessionFilter => (s) => s.events.length >= n,
  requireWorkerSpawn: (s) => s.events.some(e => e.decision_type === "worker_spawned"),
  requireReview: (s) => s.events.some(e => e.decision_type === "review_completed"),
  compose: (...fns: SessionFilter[]): SessionFilter => (s) => fns.every(f => f(s)),
};

// Explicit filtering at call site
const sessions = await loadCapturedSessions({
  filter: filters.compose(
    filters.minEvents(3),
    filters.requireWorkerSpawn
    // Note: NOT requiring review for this test
  ),
  limit: 20,
});
```

**Benefits:**
- Caller controls filtering (explicit, testable)
- Easy to add new filters (no loader modification)
- Can test partial compliance (e.g., "spawn but no review")

### Issue 3: No Scorer Versioning

**Problem:** Scorer logic changes invalidate historical comparisons. Can't tell if score dropped due to regression or scorer change.

**Impact:**
- "Score dropped 15%" - was it code regression or stricter scoring?
- Can't experiment with scorer improvements (breaks history)
- No rollback if new scorer is too strict

**Solution:**
```typescript
// Version scorers with metadata
export const subtaskIndependence_v1 = createScorer({
  name: "Subtask Independence",
  version: "1.0.0",
  description: "...",
  scorer: ({ output }) => { /* original logic */ },
});

export const subtaskIndependence_v2 = createScorer({
  name: "Subtask Independence",
  version: "2.0.0",
  description: "...",
  changes: "Added semantic file conflict detection",
  scorer: ({ output }) => { /* improved logic */ },
});

// Track scorer version in history
interface EvalRunRecord {
  timestamp: string;
  eval_name: string;
  score: number;
  scorer_versions: Record<string, string>; // { "subtaskIndependence": "2.0.0" }
}

// Baseline calculation only uses compatible runs
function calculateBaseline(history: EvalRunRecord[], scorerVersions: Record<string, string>): number {
  const compatible = history.filter(run => 
    Object.entries(scorerVersions).every(([name, version]) =>
      run.scorer_versions[name] === version
    )
  );
  return mean(compatible.map(r => r.score));
}
```

**Benefits:**
- Can improve scorers without breaking history
- Clear attribution of score changes
- Can A/B test new scorers against old

### Issue 4: LLM-as-Judge Has No Budget

**Problem:** `decompositionCoherence` calls Claude for every test case. No cost controls.

**Impact:**
- Eval run cost unbounded (20 cases × $0.01/call = $0.20+)
- Network failures fail entire eval
- Slow eval runs (LLM latency)

**Solution:**
```typescript
// Budget enforcement
const JUDGE_BUDGET = {
  maxCalls: 100,
  maxCost: 1.00, // USD
  maxLatency: 5000, // ms per call
};

let usedCalls = 0;
let usedCost = 0;

export const decompositionCoherence = createScorer({
  scorer: async ({ output, input }) => {
    // Check budget
    if (usedCalls >= JUDGE_BUDGET.maxCalls) {
      return { score: null, message: "Budget exhausted (max calls)" };
    }
    if (usedCost >= JUDGE_BUDGET.maxCost) {
      return { score: null, message: "Budget exhausted (max cost)" };
    }

    try {
      const { text, usage } = await generateText({ /* ... */ });
      
      // Track usage
      usedCalls++;
      usedCost += estimateCost(usage);

      // ... scoring logic
    } catch (error) {
      // Fallback to heuristic score
      return { score: 0.5, message: "LLM judge failed, using fallback" };
    }
  },
});
```

**Benefits:**
- Predictable costs (budget enforced)
- Graceful degradation (fallback on failure)
- Fast feedback (skip LLM in CI, use for deep analysis locally)

### Issue 5: Baseline Calculation Too Naive

**Problem:** Simple mean of all scores. Early bad runs drag down baseline forever. No time-based decay.

**Impact:**
- Baseline stagnates (old scores weighted equally with new)
- Improvements don't raise baseline fast enough
- Outliers distort baseline

**Solution:**
```typescript
// Exponential moving average (recent scores matter more)
function calculateEMA(
  history: EvalRunRecord[],
  alpha: number = 0.2 // Smoothing factor (0.2 = 20% weight to new value)
): number {
  if (history.length === 0) return 0;
  
  let ema = history[0].score;
  for (let i = 1; i < history.length; i++) {
    ema = alpha * history[i].score + (1 - alpha) * ema;
  }
  return ema;
}

// Trimmed mean (remove outliers)
function calculateTrimmedMean(
  history: EvalRunRecord[],
  trimPercent: number = 0.1 // Trim top/bottom 10%
): number {
  const sorted = history.map(r => r.score).sort((a, b) => a - b);
  const trimCount = Math.floor(sorted.length * trimPercent);
  const trimmed = sorted.slice(trimCount, sorted.length - trimCount);
  return mean(trimmed);
}

// Let caller choose baseline strategy
type BaselineStrategy = "mean" | "ema" | "trimmed-mean" | "median";

function calculateBaseline(
  history: EvalRunRecord[],
  strategy: BaselineStrategy = "ema"
): number {
  switch (strategy) {
    case "mean": return mean(history.map(r => r.score));
    case "ema": return calculateEMA(history);
    case "trimmed-mean": return calculateTrimmedMean(history);
    case "median": return median(history.map(r => r.score));
  }
}
```

**Benefits:**
- Baseline adapts to improvements (EMA)
- Robust to outliers (trimmed mean, median)
- Configurable per eval (some need stability, others need responsiveness)

### Issue 6: No Eval Parameterization

**Problem:** Can't run same eval with different configs (e.g., max_subtasks=4 vs max_subtasks=8). Must copy-paste eval file.

**Impact:**
- Duplication (multiple eval files for slight variations)
- Can't grid search optimal params
- Hard to compare strategies side-by-side

**Solution:**
```typescript
// Parameterized evals
evalite.parameterize("Decomposition Quality", {
  params: [
    { maxSubtasks: 4, strategy: "file-based" },
    { maxSubtasks: 4, strategy: "feature-based" },
    { maxSubtasks: 8, strategy: "file-based" },
    { maxSubtasks: 8, strategy: "feature-based" },
  ],
  data: async ({ maxSubtasks, strategy }) => 
    loadEvalCases(PROJECT_KEY, { strategy, limit: 20 }),
  task: async (input, { maxSubtasks }) => {
    const prompt = formatDecompositionPrompt(input.task, input.context, maxSubtasks);
    return await generateDecomposition(prompt);
  },
  scorers: [subtaskIndependence, coverageCompleteness],
});
```

**Benefits:**
- Single source of truth (DRY)
- Easy to add new params (no file duplication)
- Results grouped for comparison

---

## Performance Characteristics

### Eval Execution Times (Estimated)

| Eval | Data Source | Task | Scorers | Time/Case | Total (20 cases) |
|------|-------------|------|---------|-----------|------------------|
| `swarm-decomposition` | PGlite | LLM call | 4 (1 LLM judge) | ~3-5s | ~60-100s |
| `coordinator-session` | JSONL | Identity | 5 | ~10ms | ~200ms |
| `compaction-prompt` | Fixtures | Identity | 5 | ~5ms | ~100ms |
| `compaction-resumption` | JSONL | Logic | 4 | ~20ms | ~400ms |

**Bottlenecks:**
1. **LLM calls** - `decompositionCoherence` dominates swarm-decomposition time
2. **PGlite queries** - Network RTT if using remote DB
3. **JSONL parsing** - Linear scan of all session files (could be indexed)

**Optimization opportunities:**
1. **Parallel LLM calls** - Run test cases concurrently (10 parallel = 10x faster)
2. **Response caching** - Cache LLM responses by prompt hash
3. **Session indexing** - SQLite index on session_id, epic_id for fast lookup
4. **Incremental evals** - Only test changed cases (git diff → affected evals)

---

## Integration Points

### 1. Swarm Tools → Capture

**File:** `src/eval-capture.ts`

**Hook points:**
- `swarm_decompose()` → `captureDecompositionEvent()`
- `swarm_complete()` → `captureOutcomeEvent()`
- Tool call inspection → `detectCoordinatorViolation()` → `captureViolationEvent()`
- Compaction hook → `captureCompactionEvent()`

**Data validation:** Zod schemas ensure type safety at capture time.

### 2. Evalite → Loaders

**File:** `evals/lib/data-loader.ts`, `evals/lib/compaction-loader.ts`

**Pattern:**
```typescript
evalite("Test Name", {
  data: async () => {
    const realData = await hasRealEvalData(PROJECT_KEY, 5);
    return realData
      ? await loadEvalCases(PROJECT_KEY, { limit: 20 })
      : fixtures;
  },
  // ...
});
```

**Issue:** Fallback logic duplicated across eval files. Should be abstracted.

### 3. Evalite → Gates

**File:** `src/eval-gates.ts`

**Pattern:**
```typescript
import { checkGate } from "../src/eval-gates.js";

evalite("Test", {
  // ... data, task, scorers
  onComplete: ({ score }) => {
    const gate = checkGate(PROJECT_PATH, "test-name", score);
    if (!gate.passed) {
      console.error(`❌ Gate failed: ${gate.message}`);
      process.exit(1); // Fail CI
    }
  },
});
```

**Issue:** No built-in integration. Must manually wire `onComplete` hook in each eval file.

### 4. Gates → Learning

**File:** `src/eval-learning.ts`

**Pattern:**
```typescript
import { learnFromEvalFailure } from "../src/eval-learning.js";

const result = await learnFromEvalFailure(
  evalName,
  currentScore,
  history,
  memoryAdapter
);

if (result.triggered) {
  console.log(`📉 Stored failure to memory: ${result.memory_id}`);
}
```

**Issue:** No automatic execution. Must manually call after gate check.

### 5. Learning → Prompts (Missing)

**Expected flow:**
```typescript
// Query failures before generating prompts
const failures = await queryEvalFailures(evalName, memoryAdapter);

// Inject into LLM prompt
const prompt = `
${basePrompt}

PAST FAILURES:
${failures.map(f => `- ${f.information}`).join("\n")}

Avoid these patterns.
`;
```

**Status:** Not implemented. Learning loop stores but doesn't retrieve.

---

## Testing Strategy

### Current Coverage

| Component | Unit Tests | Integration Tests | E2E Tests |
|-----------|------------|-------------------|-----------|
| Data loaders | ✅ `data-loader.test.ts` | ✅ `data-loader.evalite-test.ts` | ❌ |
| Scorers | ✅ `scorers/*.evalite-test.ts` | ❌ | ❌ |
| Gates | ✅ `eval-gates.test.ts` | ❌ | ❌ |
| Learning | ✅ `eval-learning.test.ts` | ❌ | ❌ |
| Capture | ❌ | ✅ `eval-capture.integration.test.ts` | ❌ |

**Gaps:**
- No E2E tests (full CAPTURE → EVAL → GATE → LEARN flow)
- No scorer integration tests (composition logic)
- No error path tests (what if LLM fails? PGlite down? JSONL corrupt?)

**Recommendation:**
```typescript
// E2E test skeleton
describe("Eval Pipeline E2E", () => {
  it("should capture → load → eval → gate → learn", async () => {
    // 1. Trigger capture
    await swarm_decompose(task, context);
    
    // 2. Load data
    const cases = await loadEvalCases(PROJECT_KEY);
    expect(cases.length).toBeGreaterThan(0);
    
    // 3. Run eval
    const score = await runEval(cases);
    
    // 4. Check gate
    const gate = checkGate(PROJECT_PATH, "test", score);
    expect(gate.passed).toBe(true);
    
    // 5. Learn from failure (if any)
    const learned = await learnFromEvalFailure("test", score, history, memory);
    // ... assertions
  });
});
```

---

## Improvement Roadmap

### Phase 1: Foundation (1-2 weeks)

1. **Extract data source interface** (`EvalSource<T>`)
   - Refactor `data-loader.ts` into `PGliteSource`, `JsonlSource`, `FixtureSource`
   - Add source selection logic to shared utility
   - Update all eval files to use new interface

2. **Make filters first-class**
   - Extract `SessionFilter` type and filter library
   - Move quality criteria out of loader, into eval files
   - Add filter composition utilities

3. **Add scorer versioning**
   - Add `version` field to scorer metadata
   - Track scorer versions in eval history
   - Update baseline calculation to only use compatible runs

### Phase 2: Robustness (2-3 weeks)

4. **LLM judge improvements**
   - Add budget enforcement (max calls, max cost)
   - Add response caching (hash prompt → cache result)
   - Add fallback scoring (heuristic if LLM fails)

5. **Baseline improvements**
   - Implement EMA, trimmed mean, median strategies
   - Add `BaselineStrategy` config to eval-gates
   - A/B test strategies against real data

6. **Error handling**
   - Add retry logic to LLM calls
   - Graceful degradation for missing data
   - Corrupt JSONL line handling (currently silent skip)

### Phase 3: Intelligence (3-4 weeks)

7. **Learning loop completion**
   - Query eval failures before generating prompts
   - Inject past failures into LLM context
   - Auto-generate hypotheses for regressions

8. **Failure analysis**
   - Diff scorer outputs between runs
   - Identify which test cases regressed
   - Surface root cause signals (scorer, data, code change)

9. **CI/PR integration**
   - Post gate results to GitHub PR comments
   - Block merge on production gate failures
   - Add `swarm eval status` badge to PRs

### Phase 4: Scale (4-6 weeks)

10. **Performance optimization**
    - Parallel LLM calls for test cases
    - Session indexing (SQLite for fast lookup)
    - Incremental evals (only run affected tests)

11. **Eval parameterization**
    - Add `evalite.parameterize()` support
    - Grid search optimal params (max_subtasks, strategy combos)
    - Compare strategies side-by-side

12. **Observability**
    - Real-time eval dashboards (Grafana + Prometheus)
    - Eval run traces (OpenTelemetry)
    - Cost tracking (LLM usage, storage growth)

---

## Conclusion

The eval infrastructure is **well-designed at the macro level** (clear pipeline, progressive gates, learning loop), but has **tactical issues** that impact usability and maintainability:

**Key strengths to preserve:**
- Progressive gates prevent premature failures
- Real data integration grounds evals in reality
- Learning loop closes the feedback cycle
- Type-safe schemas prevent garbage data

**Critical improvements needed:**
- **Abstraction:** Extract data source interface (reduce coupling)
- **Configurability:** Make filters, baselines, budgets first-class (not hardcoded)
- **Versioning:** Track scorer versions (enable safe improvements)
- **Robustness:** Add retries, fallbacks, error handling (production-grade)

**Impact of improvements:**
- **Developer experience:** Easier to add new evals (less boilerplate)
- **Reliability:** Evals don't fail due to transient issues (network, LLM)
- **Trust:** Score changes attributable to code (not scorer drift)
- **Cost control:** LLM budgets prevent runaway spend

**Next steps:** Start with Phase 1 (foundation) to unblock future improvements. The architecture is sound - just needs tactical refactoring.

---

## Appendix: File Inventory

```
evals/
├── README.md                         # User-facing docs (comprehensive)
├── ARCHITECTURE.md                   # This document
├── evalite.config.ts.bak             # Minimal config (mostly defaults)
│
├── fixtures/                         # Synthetic test data
│   ├── decomposition-cases.ts        # Decomposition test cases
│   ├── coordinator-sessions.ts       # Perfect/bad coordinator examples
│   ├── compaction-cases.ts           # Compaction logic test cases
│   └── compaction-prompt-cases.ts    # Continuation prompt examples
│
├── lib/                              # Data loading utilities
│   ├── data-loader.ts                # PGlite + JSONL session loader
│   ├── data-loader.test.ts           # Unit tests
│   ├── data-loader.evalite-test.ts   # Integration tests
│   ├── compaction-loader.ts          # COMPACTION event loader
│   ├── compaction-loader.test.ts     # Unit tests
│   └── llm.ts                        # LLM client (AI SDK + Gateway)
│
├── scorers/                          # Quality metric implementations
│   ├── index.ts                      # Decomposition scorers + exports
│   ├── index.test.ts                 # Unit tests
│   ├── coordinator-discipline.ts     # Protocol adherence scorers
│   ├── coordinator-discipline.evalite-test.ts
│   ├── compaction-scorers.ts         # Compaction correctness
│   ├── compaction-prompt-scorers.ts  # Prompt quality
│   ├── outcome-scorers.ts            # Real execution outcomes
│   └── outcome-scorers.evalite-test.ts
│
├── swarm-decomposition.eval.ts       # Decomposition quality eval
├── coordinator-session.eval.ts       # Coordinator discipline eval
├── compaction-prompt.eval.ts         # Continuation prompt quality
├── compaction-resumption.eval.ts     # Compaction correctness eval
└── example.eval.ts                   # Sanity check / template

Total: 24 TypeScript files (8 evals, 8 loaders/utils, 8 scorers)
```

---

**Generated by:** BlueForest (swarm worker)  
**Cell:** opencode-swarm-plugin--ys7z8-mjlk7jsilk9  
**Epic:** opencode-swarm-plugin--ys7z8-mjlk7js9bt1  
**Date:** 2025-12-25
