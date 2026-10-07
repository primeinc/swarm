---
"swarm": minor
---

## 🧠 Swarm Insights: Data-Driven Decomposition

> "It should allow the learner both to reflect on the quality of found solutions so that more effective cognitive schemata can be induced (including discriminations and generalizations) or further elaborated."
> 
> — *Training Complex Cognitive Skills: A Four-Component Instructional Design Model for Technical Training*

**What changed:**

New data layer (`swarm-insights.ts`) aggregates learnings from swarm coordination events to inform future decompositions. Coordinators and workers now get concise, context-efficient summaries injected into their prompts.

**Key exports:**

- `getStrategyInsights(swarmMail, task)` - Strategy success rates and recommendations
  - Queries `subtask_outcome` events, calculates win/loss ratios
  - Returns: `{ strategy, successRate, totalAttempts, recommendation }`
  - Powers coordinator strategy selection with empirical data

- `getFileInsights(swarmMail, files)` - File-specific gotchas from past failures
  - Identifies files with high failure rates
  - Returns: `{ file, failureCount, lastFailure, gotchas[] }`
  - Workers see warnings about tricky files before touching them

- `getPatternInsights(swarmMail)` - Common failure patterns and anti-patterns
  - Detects recurring error types (type_error, timeout, conflict, test_failure)
  - Returns: `{ pattern, frequency, recommendation }`
  - Surfaces systemic issues for proactive prevention

- `formatInsightsForPrompt(bundle, options)` - Context-aware formatting
  - Token budget enforcement (default 500 tokens, ~2000 chars)
  - Prioritizes top 3 strategies, 5 files, 3 patterns
  - Clean markdown output for prompt injection

- `getCachedInsights(swarmMail, cacheKey, computeFn)` - 5-minute TTL caching
  - Prevents redundant queries during active swarms
  - Transparent cache miss fallback

**Why it matters:**

Before this, coordinators decomposed tasks blind to past failures. "Split by file type" might have failed 8 times, but the coordinator would try it again. Workers would touch `auth/tokens.ts` without knowing it caused 3 prior failures.

Now:
- **Better decomposition**: Coordinator prompts show strategy success rates (e.g., "file-based: 85% success, feature-based: 40% - avoid")
- **Fewer repeated mistakes**: Workers see file-specific warnings before editing
- **Compounding learning**: Each swarm completion feeds the insights engine, improving future decompositions
- **Context-efficient**: Hard token caps prevent insights from dominating prompt budgets

The swarm now learns from its mistakes, not just records them.

**Data sources:**
- Event store: `subtask_outcome`, `eval_finalized` events
- Semantic memory: File-specific learnings (TODO: full integration)
- Anti-pattern registry: Detection and inversion rules

**Integration points:**
- Coordinator prompts: Inject strategy insights during decomposition
- Worker prompts: Inject file insights when subtasks are spawned
- Learning layer: Confidence decay, pattern maturity, implicit feedback scoring

This is the foundation for adaptive swarm intelligence - decomposition that gets smarter with every task completed.
