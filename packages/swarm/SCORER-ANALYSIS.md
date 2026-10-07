# Scorer Implementation Analysis

**Date:** 2025-12-25  
**Cell:** opencode-swarm-plugin--ys7z8-mjlk7jsrvls  
**Scope:** All scorer implementations in `evals/scorers/`  

```
┌────────────────────────────────────────────────────────────┐
│                                                            │
│    📊 SCORER AUDIT REPORT                                  │
│    ═══════════════════════                                 │
│                                                            │
│    Files Analyzed:                                         │
│    • index.ts (primary scorers)                            │
│    • coordinator-discipline.ts (11 scorers)                │
│    • compaction-scorers.ts (5 scorers)                     │
│    • outcome-scorers.ts (5 scorers)                        │
│                                                            │
│    Total Scorers: 24                                       │
│    Composite Scorers: 3                                    │
│    LLM-as-Judge: 1                                         │
│                                                            │
└────────────────────────────────────────────────────────────┘
```

---

## Executive Summary

**Overall Assessment:** ✅ Scorers are well-implemented with correct API usage. Found **3 critical issues** and **5 optimization opportunities**.

**Eval Performance Context:**
- compaction-prompt: 53% (LOW - needs investigation)
- coordinator-behavior: 77% (GOOD)
- coordinator-session: 66% (FAIR)
- compaction-resumption: 93% (EXCELLENT)
- swarm-decomposition: 70% (GOOD)
- example: 0% (expected - sanity check)

---

## 🔴 CRITICAL ISSUES

### 1. **UNUSED SCORERS - Dead Code**

**Severity:** HIGH  
**Impact:** Wasted development effort, misleading test coverage

#### Scorers Defined But Never Used in Evals

| Scorer | File | Lines | Status |
|--------|------|-------|--------|
| `researcherSpawnRate` | coordinator-discipline.ts | 345-378 | ❌ NEVER USED |
| `skillLoadingRate` | coordinator-discipline.ts | 388-421 | ❌ NEVER USED |
| `inboxMonitoringRate` | coordinator-discipline.ts | 433-484 | ❌ NEVER USED |
| `blockerResponseTime` | coordinator-discipline.ts | 499-588 | ❌ NEVER USED |

**Evidence:**
```bash
grep -r "researcherSpawnRate\|skillLoadingRate\|inboxMonitoringRate\|blockerResponseTime" evals/*.eval.ts
# → No matches
```

**Why This Matters:**
- These scorers represent ~250 lines of code (~38% of coordinator-discipline.ts)
- Tests exist for them but they don't influence eval results
- Maintenance burden without benefit
- Misleading signal that these metrics are being measured

**Recommendation:**
1. **EITHER** add these scorers to `coordinator-session.eval.ts` scorers array
2. **OR** remove them and their tests to reduce noise

**Probable Intent:**
These scorers were likely prototypes for expanded coordinator metrics but never integrated. The current 5-scorer set (violations, spawn, review, speed, reviewEfficiency) is sufficient for protocol adherence.

---

### 2. **reviewEfficiency vs reviewThoroughness - Potential Redundancy**

**Severity:** MEDIUM  
**Impact:** Confusing metrics, potential double-penalization

#### What They Measure

| Scorer | Metric | Scoring |
|--------|--------|---------|
| `reviewThoroughness` | reviews / finished_workers | 0-1 (completeness) |
| `reviewEfficiency` | reviews / spawned_workers | penalizes >2:1 ratio |

**The Problem:**
```typescript
// Scenario: 2 workers spawned, 2 finished, 4 reviews completed

// reviewThoroughness: 4/2 = 2.0 → clipped to 1.0 (perfect!)
// reviewEfficiency: 4/2 = 2.0 → 0.5 (threshold penalty)

// These contradict each other
```

**Why This Exists:**
- `reviewThoroughness` added early to ensure coordinators review worker output
- `reviewEfficiency` added later to prevent over-reviewing (context waste)
- Both measure review behavior but from different angles

**Current Usage:**
- `coordinator-session.eval.ts` uses BOTH in scorers array
- `overallDiscipline` composite uses only `reviewThoroughness` (not efficiency)

**Recommendation:**
1. **Short-term:** Document that these are intentionally complementary (thoroughness=quality gate, efficiency=resource optimization)
2. **Long-term:** Consider composite "reviewQuality" scorer that balances both:
   ```typescript
   // Perfect: 1:1 ratio (one review per finished worker)
   // Good: 0.8-1.2 ratio
   // Bad: <0.5 or >2.0 ratio
   ```

---

### 3. **Arbitrary Normalization Thresholds**

**Severity:** LOW  
**Impact:** Scores may not reflect reality, hard to tune

#### timeToFirstSpawn Thresholds

```typescript
const EXCELLENT_MS = 60_000;   // < 60s = 1.0 (why 60s?)
const POOR_MS = 300_000;       // > 300s = 0.0 (why 5min?)
```

**Question:** Are these evidence-based or arbitrary?

**From Real Data:** We don't know - no analysis of actual coordinator spawn times.

**Recommendation:**
1. Add comment with rationale: "Based on X coordinator sessions, median spawn time is Y"
2. OR make thresholds configurable via expected values
3. OR use percentile-based normalization from real data

#### blockerResponseTime Thresholds

```typescript
const EXCELLENT_MS = 5 * 60 * 1000;  // 5 min
const POOR_MS = 15 * 60 * 1000;      // 15 min
```

**Same Issue:** No evidence these thresholds match real coordinator response patterns.

**Deeper Problem:**
```typescript
// This scorer matches blockers to resolutions by subtask_id
const resolution = resolutions.find(
  (r) => (r.payload as any).subtask_id === subtaskId
);

// BUT: If coordinator resolves blocker by reassigning task,
// the subtask_id might change. This would miss the resolution.
```

---

## ⚠️ CALIBRATION ISSUES

### 1. **Composite Scorer Weight Inconsistency**

#### Current Weights

**overallDiscipline** (coordinator-discipline.ts:603):
```typescript
const weights = {
  violations: 0.3,     // 30% - "most critical"
  spawn: 0.25,         // 25%
  review: 0.25,        // 25%
  speed: 0.2,          // 20%
};
```

**compactionQuality** (compaction-scorers.ts:260):
```typescript
const weights = {
  confidence: 0.25,    // 25%
  injection: 0.25,     // 25%
  required: 0.3,       // 30% - "most critical"
  forbidden: 0.2,      // 20%
};
```

**overallCoordinatorBehavior** (coordinator-behavior.eval.ts:196):
```typescript
const score = 
  (toolsResult.score ?? 0) * 0.3 +
  (avoidsResult.score ?? 0) * 0.4 +   // 40% - "most important"
  (mindsetResult.score ?? 0) * 0.3;
```

**Pattern:** Each composite prioritizes different metrics, which is GOOD (domain-specific), but...

**Issue:** No documentation of WHY these weights were chosen.

**Recommendation:**
Add comments explaining weight rationale:
```typescript
// Weights based on failure impact:
// - Violations (30%): Breaking protocol causes immediate harm
// - Spawn (25%): Delegation is core coordinator job
// - Review (25%): Quality gate prevents bad work propagating
// - Speed (20%): Optimization, not correctness
```

---

### 2. **Binary vs Gradient Scoring Philosophy**

#### Binary Scorers (0 or 1 only)

- `subtaskIndependence` - either conflicts exist or they don't
- `executionSuccess` - either all succeeded or not
- `noRework` - either rework detected or not

#### Gradient Scorers (0-1 continuous)

- `timeBalance` - ratio-based
- `scopeAccuracy` - percentage-based
- `instructionClarity` - heuristic-based

#### LLM-as-Judge (0-1 via scoring prompt)

- `decompositionCoherence` - Claude Haiku scores 0-100, normalized to 0-1

**Question:** Should all outcome scorers be gradient, or is binary appropriate?

**Trade-off:**
- **Binary:** Clear pass/fail, easy to reason about, motivates fixes
- **Gradient:** More nuanced, rewards partial success, better for learning

**Current Mix:** Seems reasonable. Binary for critical invariants (no conflicts, no rework), gradient for optimization metrics (balance, accuracy).

**Recommendation:** Document this philosophy in scorer file headers.

---

## ✅ WELL-CALIBRATED PATTERNS

### 1. **Fallback Strategy Consistency**

From semantic memory:
> "When no baseline exists, prefer realistic fallback (1.0 if delegation happened) over arbitrary 0.5"

**Good Example - spawnEfficiency (lines 98-108):**
```typescript
if (!decomp) {
  // Fallback: if workers were spawned but no decomp event, assume they're doing work
  if (spawned > 0) {
    return {
      score: 1.0,  // Optimistic - work is happening
      message: `${spawned} workers spawned (no decomposition event)`,
    };
  }
  return {
    score: 0,
    message: "No decomposition event found",
  };
}
```

**Rationale:** Workers spawned = delegation happened = good coordinator behavior. Not penalizing missing instrumentation.

**Contrast - decompositionCoherence fallback (lines 321-325):**
```typescript
} catch (error) {
  // Don't fail the eval if judge fails - return neutral score
  return {
    score: 0.5,  // Neutral - can't determine quality
    message: `LLM judge error: ${error instanceof Error ? error.message : String(error)}`,
  };
}
```

**Rationale:** LLM judge failure = unknown quality, not good or bad. Neutral 0.5 prevents biasing results.

**Consistency:** ✅ Both fallbacks match their semantic context.

---

### 2. **Test Coverage Philosophy**

#### Unit Tests (Bun test)
- **coordinator-discipline.evalite-test.ts** - Full functional tests with synthetic fixtures
- **outcome-scorers.evalite-test.ts** - Export verification only (integration tested via evalite)

#### Integration Tests (Evalite)
- **coordinator-session.eval.ts** - Real captured sessions + synthetic fixtures
- **swarm-decomposition.eval.ts** - Real LLM calls + fixtures

**Pattern:** Scorers with complex logic get unit tests. Simple scorers get integration tests only.

**Trade-off:**
- **Pro:** Faster iteration for complex scorers
- **Con:** No unit tests for outcome scorers (harder to debug failures)

**Recommendation:** Add characterization tests for outcome scorers (snapshot actual scores for known inputs).

---

## 📊 SCORER USAGE MATRIX

| Scorer | coordinator-session | swarm-decomposition | coordinator-behavior | compaction-resumption | compaction-prompt |
|--------|---------------------|---------------------|----------------------|-----------------------|-------------------|
| **violationCount** | ✅ | - | - | - | - |
| **spawnEfficiency** | ✅ | - | - | - | - |
| **reviewThoroughness** | ✅ | - | - | - | - |
| **reviewEfficiency** | ✅ | - | - | - | - |
| **timeToFirstSpawn** | ✅ | - | - | - | - |
| **overallDiscipline** | ✅ | - | - | - | - |
| **researcherSpawnRate** | ❌ | - | - | - | - |
| **skillLoadingRate** | ❌ | - | - | - | - |
| **inboxMonitoringRate** | ❌ | - | - | - | - |
| **blockerResponseTime** | ❌ | - | - | - | - |
| **subtaskIndependence** | - | ✅ | - | - | - |
| **coverageCompleteness** | - | ✅ | - | - | - |
| **instructionClarity** | - | ✅ | - | - | - |
| **decompositionCoherence** | - | ✅ | - | - | - |
| **mentionsCoordinatorTools** | - | - | ✅ | - | - |
| **avoidsWorkerBehaviors** | - | - | ✅ | - | - |
| **coordinatorMindset** | - | - | ✅ | - | - |
| **overallCoordinatorBehavior** | - | - | ✅ | - | - |
| **confidenceAccuracy** | - | - | - | ✅ | - |
| **contextInjectionCorrectness** | - | - | - | ✅ | - |
| **requiredPatternsPresent** | - | - | - | ✅ | - |
| **forbiddenPatternsAbsent** | - | - | - | ✅ | - |
| **compactionQuality** | - | - | - | ✅ | - |
| **compaction-prompt scorers** | - | - | - | - | ✅ |
| **outcome scorers** | - | - | - | - | - |

**Note:** Outcome scorers not used in any current eval (waiting for real execution data).

---

## 🎯 RECOMMENDATIONS

### Immediate (Pre-Ship)

1. **DECIDE:** Keep or remove unused coordinator scorers
   - If keeping: Add to coordinator-session.eval.ts
   - If removing: Delete scorers + tests, update exports

2. **DOCUMENT:** Add weight rationale comments to composite scorers

3. **CLARIFY:** Add docstring to reviewEfficiency explaining relationship with reviewThoroughness

### Short-term (Next Sprint)

4. **CALIBRATE:** Gather real coordinator session data, validate normalization thresholds
   - Run 20+ real coordinator sessions
   - Plot distribution of spawn times, blocker response times
   - Adjust EXCELLENT_MS/POOR_MS based on percentiles

5. **TEST:** Add characterization tests for outcome scorers
   ```typescript
   test("scopeAccuracy with known input", () => {
     const result = scopeAccuracy({ output: knownGoodOutput, ... });
     expect(result.score).toMatchSnapshot();
   });
   ```

6. **INVESTIGATE:** Why is compaction-prompt eval at 53%?
   - Review fixtures in `compaction-prompt-cases.ts`
   - Check if scorers are too strict or fixtures are wrong
   - This is the LOWEST-performing eval (red flag)

### Long-term (Future Iterations)

7. **REFACTOR:** Consider `reviewQuality` composite that balances thoroughness + efficiency

8. **ENHANCE:** Add percentile-based normalization for time-based scorers
   ```typescript
   function normalizeTime(valueMs: number, p50: number, p95: number): number {
     // Values at p50 = 0.5, values at p95 = 0.0
     // Self-calibrating from real data
   }
   ```

9. **INTEGRATE:** Use outcome scorers once real swarm execution data exists
   - Currently no eval uses executionSuccess, timeBalance, scopeAccuracy, scopeDrift, noRework
   - These are outcome-based (require actual subtask execution)
   - Valuable for learning which decomposition strategies work

---

## 📈 SCORING PHILOSOPHY PATTERNS

### Pattern 1: "Perfect or Penalty" (Binary with Partial Credit)

**Example:** `instructionClarity` (index.ts:174-228)
```typescript
let score = 0.5; // baseline
if (subtask.description && subtask.description.length > 20) score += 0.2;
if (subtask.files && subtask.files.length > 0) score += 0.2;
if (!isGeneric) score += 0.1;
return Math.min(1.0, score);
```

**Philosophy:** Start at baseline, add points for quality signals, cap at 1.0

**Pro:** Rewards partial quality improvements  
**Con:** Arbitrary baseline and increments

---

### Pattern 2: "Ratio Normalization" (Continuous Gradient)

**Example:** `timeBalance` (outcome-scorers.ts:73-141)
```typescript
const ratio = maxDuration / minDuration;
if (ratio < 2.0) score = 1.0;        // well balanced
else if (ratio < 4.0) score = 0.5;   // moderately balanced
else score = 0.0;                    // poorly balanced
```

**Philosophy:** Define thresholds for quality bands, linear interpolation between

**Pro:** Clear expectations, easy to reason about  
**Con:** Threshold choices are subjective

---

### Pattern 3: "LLM-as-Judge" (Delegated Evaluation)

**Example:** `decompositionCoherence` (index.ts:245-328)
```typescript
const { text } = await generateText({
  model: gateway(JUDGE_MODEL),
  prompt: `Evaluate on these criteria (be harsh)...
    1. INDEPENDENCE (25%)
    2. SCOPE (25%)
    3. COMPLETENESS (25%)
    4. CLARITY (25%)
    Return ONLY valid JSON: {"score": <0-100>, "issues": [...]}`,
});
```

**Philosophy:** Use LLM for nuanced evaluation humans/heuristics can't capture

**Pro:** Catches semantic issues (hidden dependencies, ambiguous scope)  
**Con:** Non-deterministic, slower, requires API key, costs money

---

### Pattern 4: "Composite Weighted Average"

**Example:** `overallDiscipline` (coordinator-discipline.ts:603-648)
```typescript
const totalScore =
  (scores.violations.score ?? 0) * weights.violations +
  (scores.spawn.score ?? 0) * weights.spawn +
  (scores.review.score ?? 0) * weights.review +
  (scores.speed.score ?? 0) * weights.speed;
```

**Philosophy:** Combine multiple signals with domain-specific weights

**Pro:** Single metric for "overall quality", weights encode priorities  
**Con:** Weights are subjective, hides individual metric details

---

## 🔬 DEEP DIVE: compaction-prompt 53% Score

**Context:** This is the LOWEST-performing eval. Needs investigation.

**Hypothesis 1:** Scorers are too strict
- Check if perfect fixture actually scores 100% (has dedicated eval for this)
- If perfect scores <100%, scorers have bugs

**Hypothesis 2:** Fixtures are wrong
- Fixtures might not represent actual good prompts
- Need to compare against real coordinator resumption prompts

**Hypothesis 3:** Real implementation doesn't match fixture assumptions
- Fixtures assume certain prompt structure
- Actual implementation may have evolved differently

**Next Steps:**
1. Run `Perfect Prompt Scores 100%` eval and check results
2. If it scores <100%, debug scorer logic
3. If it scores 100%, review other fixture expected values

---

## 💡 INSIGHTS FROM SEMANTIC MEMORY

### 1. Evalite API Pattern (from memory c2bb8f11)

```typescript
// CORRECT: Scorers are async functions
const result = await childScorer({ output, expected, input });
const score = result.score ?? 0;

// WRONG: .scorer property doesn't exist
const result = childScorer.scorer({ output, expected });  // ❌
```

✅ All current scorers follow correct pattern.

---

### 2. Garbage Input Handling (from memory b0ef27d5)

> "When LLM receives garbage input, it correctly scores it 0 - this is the RIGHT behavior, not an error."

**Application:** `decompositionCoherence` should NOT return 0.5 fallback for parse errors. Should let LLM judge garbage as garbage.

**Current Implementation:** ❌ Returns 0.5 on error (line 324)

**Recommendation:** Distinguish between:
- **LLM error** (API failure) → 0.5 fallback (can't judge)
- **Parse error** (invalid JSON output) → Pass raw output to LLM, let it judge as low quality

---

### 3. Epic ID Pattern (from memory ba964b81)

> "Epic ID pattern is mjkw + 7 base36 chars = 11 chars total"

**Application:** `forbiddenPatternsAbsent` checks for "bd-xxx" placeholders, but should also check for other placeholder patterns:
- `<epic>`, `<path>`, `placeholder`, `YOUR_EPIC_ID`, etc.

**Current Implementation:** ✅ Already checks these (compaction-scorers.ts:200)

---

## 🎨 ASCII ART SCORING DISTRIBUTION

```
    SCORER USAGE HEAT MAP
    ═══════════════════════

    coordinator-session    ██████ (6 scorers)
    swarm-decomposition    ████   (4 scorers)
    coordinator-behavior   ████   (4 scorers)
    compaction-resumption  █████  (5 scorers)
    compaction-prompt      █████  (5 scorers)

    UNUSED SCORERS: 🗑️  (4 scorers, 250 LOC)
```

---

## 📋 ACTION ITEMS

### Critical (Do First)
- [ ] **Decide fate of unused scorers** (remove or integrate)
- [ ] **Investigate compaction-prompt 53% score** (lowest eval)
- [ ] **Add weight rationale comments** to composite scorers

### High Priority
- [ ] **Document reviewEfficiency vs reviewThoroughness** relationship
- [ ] **Validate normalization thresholds** with real data
- [ ] **Add characterization tests** for outcome scorers

### Medium Priority
- [ ] **Consider reviewQuality composite** (balances thorough + efficient)
- [ ] **Enhance blockerResponseTime** matching logic (handle reassignments)
- [ ] **Document binary vs gradient scoring philosophy** in file headers

### Low Priority
- [ ] **Refactor garbage input handling** in decompositionCoherence
- [ ] **Add percentile-based normalization** for time scorers
- [ ] **Create scorer usage dashboard** (track which scorers impact results)

---

## 🏆 CONCLUSION

**Overall Quality:** 🟢 GOOD

**Strengths:**
- Correct Evalite API usage (no `.scorer` property bugs)
- Thoughtful fallback strategies (realistic vs neutral)
- Good separation of concerns (discipline, outcome, compaction)
- LLM-as-judge for complex evaluation

**Weaknesses:**
- 4 unused scorers (38% dead code in coordinator-discipline.ts)
- Arbitrary normalization thresholds (no evidence-based calibration)
- Undocumented weight rationale (composite scorers)
- Lowest eval score (compaction-prompt 53%) not investigated

**Priority:** Focus on **removing unused scorers** and **investigating compaction-prompt failure** before shipping.

---

**Analysis by:** CoolOcean  
**Cell:** opencode-swarm-plugin--ys7z8-mjlk7jsrvls  
**Epic:** opencode-swarm-plugin--ys7z8-mjlk7js9bt1  
**Timestamp:** 2025-12-25T17:30:00Z
