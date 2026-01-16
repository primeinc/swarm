# Architecture Decision Record: Hive/Cell Visualizer

**Date:** 2025-12-23  
**Status:** Draft (Pending Review)  
**Cell:** opencode-swarm-monorepo-lf2p4u-mjfzlbckh37  
**Authors:** Coordinator

---

## Context

### The Problem

The swarm plugin tracks work items (cells) in `.hive/issues.jsonl` - a git-synced event log. While this format is excellent for:
- Git-native versioning and merging
- Agent-readable structured data
- Distributed coordination

It's **terrible for human comprehension**. When you have 50+ cells across multiple epics with complex dependency chains, understanding "what's happening" requires:

1. Parsing JSONL mentally
2. Reconstructing dependency graphs in your head
3. Tracking status across multiple dimensions (open/blocked/in_progress/closed)
4. Understanding agent assignments and file reservations

**Current state:** Humans must use `hive_query` tool calls and piece together state from JSON output. This is cognitively expensive and error-prone.

### Inspiration: Existing Beads Visualizers

#### beads_viewer (Go TUI)

[beads_viewer](https://github.com/Dicklesworthstone/beads_viewer) by Jeffrey Emanuel is a TUI for Steve Yegge's Beads issue tracker. Key features:

- **Graph-first philosophy**: Treats the dependency graph as the primary view, not a list
- **9 graph-theoretic metrics**: PageRank, Betweenness, HITS, Critical Path, Eigenvector, Degree, Density, Cycles, Topo Sort
- **Multiple views**: List, Kanban, Graph, Insights Dashboard, History
- **Robot protocol**: JSON output for AI agent consumption
- **Static site export**: Self-contained HTML for sharing

beads_viewer is written in Go with Bubble Tea TUI framework. It's comprehensive (10,000+ lines) but tightly coupled to the Beads data format.

#### beads-ui (Web UI with Live Updates)

[beads-ui](https://github.com/mantoni/beads-ui) by Maximilian Antoni is a **web-based UI** with live updates:

- **Zero setup**: `bdui start --open`
- **Live updates**: Watches the beads database for changes via WebSocket
- **Multiple views**: Issues, Epics (with progress), Board (Kanban)
- **Inline editing**: Edit issues without leaving the UI
- **Keyboard navigation**: Full keyboard support

**Architecture highlights:**
- Node.js server with WebSocket for real-time updates
- File watcher (`fs.watch`) on SQLite database
- Debounced refresh (75ms) to coalesce rapid changes
- Subscription-based updates (clients subscribe to lists, server pushes deltas)

### Our Unique Advantage: Event-Sourced Data + Durable Streams Protocol

We have something neither beads_viewer nor beads-ui have: **event-sourced data** that can be exposed via the **Durable Streams protocol**.

#### What We Already Have (swarm-mail)

Our `swarm-mail` package has a rich event store with 16 event types:

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    SWARM-MAIL EVENT TYPES                               │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  AGENT EVENTS              MESSAGE EVENTS           RESERVATION EVENTS  │
│  ─────────────             ──────────────           ──────────────────  │
│  • agent_registered        • message_sent           • file_reserved     │
│  • agent_active            • message_read           • file_released     │
│                            • message_acked                              │
│                                                                         │
│  TASK EVENTS               EVAL/LEARNING EVENTS     CHECKPOINT EVENTS   │
│  ───────────               ────────────────────     ─────────────────   │
│  • task_started            • decomposition_generated • swarm_checkpointed│
│  • task_progress           • subtask_outcome         • swarm_recovered   │
│  • task_completed          • human_feedback                              │
│  • task_blocked                                                          │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

Each event has:
- `id` - Auto-generated sequence number
- `type` - Discriminated union type
- `project_key` - Project identifier
- `timestamp` - Unix ms
- `sequence` - Ordering for replay

#### What Durable Streams Adds

[Durable Streams](https://github.com/durable-streams/durable-streams) is Electric's open protocol for real-time sync:

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    DURABLE STREAMS PROTOCOL                             │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  KEY FEATURES                                                           │
│  ────────────                                                           │
│  • Offset-based resumability (refresh-safe, multi-device, multi-tab)    │
│  • Long-poll and SSE modes for live tailing                             │
│  • Catch-up reads from any offset                                       │
│  • CDN-friendly design for massive fan-out                              │
│  • HTTP-native (no WebSocket required)                                  │
│                                                                         │
│  PACKAGES                                                               │
│  ────────                                                               │
│  • @durable-streams/client - TypeScript client with auto-batching       │
│  • @durable-streams/server - Node.js reference server                   │
│  • @durable-streams/cli    - Command-line tool                          │
│                                                                         │
│  PROTOCOL                                                               │
│  ────────                                                               │
│  GET /streams/:id?offset=N&live=true                                    │
│  → Returns events from offset N, optionally tailing for new events      │
│  → Client stores offset, resumes from last position on reconnect        │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

**Why this matters for the visualizer:**

1. **Refresh-safe**: User refreshes page → picks up exactly where they left off
2. **Multi-tab**: Multiple browser tabs share the same stream without duplicating
3. **Multi-device**: Start on laptop, continue on phone, watch from shared link
4. **Never re-run**: Don't replay entire history on reconnect
5. **Massive fan-out**: One origin serves many viewers via CDN

### Our Constraints

1. **Data format**: We use `.hive/issues.jsonl` (cells) + `swarm-mail` events
2. **Ecosystem**: We're TypeScript/Bun
3. **Integration**: Must work with swarm plugin tools
4. **Realtime**: Want live updates as agents work
5. **Lightweight**: Local dev tool, not production SaaS - don't need SSR/RSC complexity

### Options Considered

| Option | Pros | Cons |
|--------|------|------|
| **A. Fork beads_viewer** | Full-featured, battle-tested | Go codebase, different data format, maintenance burden |
| **B. Build TUI from scratch** | TypeScript native, tight integration | Significant effort, reinventing wheel |
| **C. Static HTML export** | Zero dependencies, shareable, works offline | No live updates, build step required |
| **D. beads-ui style (Express + WebSocket)** | Proven architecture, live updates | Older stack, manual state management, no resumability |
| **E. TanStack Start + Durable Streams** | Modern stack, SSR, type-safe, resumable | RC framework, overkill for local tool, learning curve |
| **F. Next.js + Durable Streams** | Familiar, production-ready | Overkill for localhost, RSC complexity unnecessary |
| **G. Vite + Nitro + Durable Streams** | Bun-native, zero config, lightweight, fast | Less batteries-included than Next.js |

---

## Decision

### Build with Vite + Nitro + Durable Streams

We will build a **lightweight three-part visualizer**:

1. **CLI Query Tool** (`swarm viz`): Quick terminal-based status views
2. **Vite + Nitro Web App** (`swarm viz --serve`): Real-time visualization at **localhost:4483**
3. **Static HTML Export** (`swarm viz --export`): Self-contained snapshot for sharing

```
┌─────────────────────────────────────────────────────────────────────────┐
│                                                                         │
│     🐝  HIVE VISUALIZER                                                 │
│                                                                         │
│     swarm viz --serve                                                   │
│                                                                         │
│     → http://localhost:4483  (HIVE on a phone keypad)                   │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

**Why Vite + Nitro (not Next.js or TanStack Start)?**

This is a **local dev tool**, not a production app. We don't need:
- SSR (no SEO, no public website)
- Edge runtime (querying local SQLite)
- Image optimization
- App Router complexity
- Cache Components (local database, not remote API)

What we need:
- Query libSQL database
- Stream events via Durable Streams
- Render some graphs and tables
- That's it.

**Why Nitro?**

1. **Bun-native**: First-class Bun support
2. **Zero config**: File-based API routes, just works
3. **Battle-tested**: Same patterns as Nuxt
4. **Lightweight**: ~50 lines of config total
5. **Fast**: Vite dev server + HMR

**Why Durable Streams Protocol?**

1. **Production-proven**: 1.5 years at Electric, millions of events/day
2. **Offset-based resumability**: Survives refreshes, tab switches, network flaps
3. **HTTP-native**: No WebSocket complexity
4. **Multi-client**: Same stream serves many viewers efficiently
5. **Time-travel**: Replay from any offset for debugging

---

## UI Mockups

### Dashboard (Default View)

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│  🐝 HIVE                                    localhost:4483      opencode-swarm  │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                 │
│  ┌─ OVERVIEW ─────────────────────────────────────────────────────────────────┐ │
│  │                                                                            │ │
│  │   47 cells     12 open     3 active     2 blocked     30 done              │ │
│  │   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━             │ │
│  │   ████████████████████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  64%        │ │
│  │                                                                            │ │
│  └────────────────────────────────────────────────────────────────────────────┘ │
│                                                                                 │
│  ┌─ ACTIVE EPICS ──────────────────────────┐  ┌─ AGENTS ─────────────────────┐ │
│  │                                         │  │                              │ │
│  │  🎯 LLM-Powered Compaction              │  │  🟢 BlueLake                 │ │
│  │     ████████████████████░░░░  80%       │  │     bd-123.2 Auth service    │ │
│  │     3/4 subtasks • 1 in progress        │  │     45% ████░░░░░            │ │
│  │                                         │  │                              │ │
│  │  🎯 Hive Visualizer                     │  │  🟢 CoralReef                │ │
│  │     ██░░░░░░░░░░░░░░░░░░░░  10%         │  │     bd-123.3 Tests           │ │
│  │     1/5 subtasks • 1 in progress        │  │     20% ██░░░░░░░            │ │
│  │                                         │  │                              │ │
│  │  🎯 Observability Stack                 │  │  🟡 MintForest               │ │
│  │     ████████████████████████  100%      │  │     Idle (5m ago)            │ │
│  │     ✓ Complete                          │  │                              │ │
│  │                                         │  │                              │ │
│  └─────────────────────────────────────────┘  └──────────────────────────────┘ │
│                                                                                 │
│  ┌─ LIVE ACTIVITY ─────────────────────────────────────────────────────────────┐│
│  │                                                                             ││
│  │  12:34:56  ● task_progress   BlueLake → bd-123.2 "Implementing JWT"        ││
│  │  12:34:52  ● file_reserved   BlueLake → src/auth/**                        ││
│  │  12:34:48  ● message_sent    CoralReef → BlueLake "Need schema types"      ││
│  │  12:34:45  ● task_started    CoralReef → bd-123.3                          ││
│  │  12:34:40  ● agent_registered MintForest                                   ││
│  │                                                                             ││
│  └─────────────────────────────────────────────────────────────────────────────┘│
│                                                                                 │
│  [Dashboard]  [Graph]  [Kanban]  [Messages]  [Reservations]                     │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### Graph View (Force-Directed)

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│  🐝 HIVE › Graph                            localhost:4483      opencode-swarm  │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                 │
│  ┌─ DEPENDENCY GRAPH ──────────────────────────────────────────────────────────┐│
│  │                                                                             ││
│  │                           ┌───────────┐                                     ││
│  │                           │  bd-100   │                                     ││
│  │                           │   EPIC    │                                     ││
│  │                           │  ○ open   │                                     ││
│  │                           └─────┬─────┘                                     ││
│  │                    ┌────────────┼────────────┐                              ││
│  │                    │            │            │                              ││
│  │                    ▼            ▼            ▼                              ││
│  │              ┌─────────┐  ┌─────────┐  ┌─────────┐                          ││
│  │              │ bd-100.1│  │ bd-100.2│  │ bd-100.3│                          ││
│  │              │  task   │  │  task   │  │  task   │                          ││
│  │              │  ✓ done │  │ ● active│  │ ○ open  │                          ││
│  │              └─────────┘  └────┬────┘  └────┬────┘                          ││
│  │                                │            │                               ││
│  │                                │      ┌─────┘                               ││
│  │                                ▼      ▼                                     ││
│  │                           ┌───────────────┐                                 ││
│  │                           │   bd-100.4    │                                 ││
│  │                           │     task      │                                 ││
│  │                           │   ⊘ blocked   │◄── waiting on .2 and .3         ││
│  │                           └───────────────┘                                 ││
│  │                                                                             ││
│  │  Legend:  ○ open   ● active   ✓ done   ⊘ blocked   ◆ epic                  ││
│  │                                                                             ││
│  └─────────────────────────────────────────────────────────────────────────────┘│
│                                                                                 │
│  ┌─ SELECTED: bd-100.2 ────────────────────────────────────────────────────────┐│
│  │  Title: Implement auth service                                              ││
│  │  Status: in_progress    Priority: P1    Type: task                          ││
│  │  Agent: BlueLake        Progress: 45%                                       ││
│  │  Files: src/auth/service.ts, src/auth/types.ts                              ││
│  │  Blocks: bd-100.4                                                           ││
│  └─────────────────────────────────────────────────────────────────────────────┘│
│                                                                                 │
│  [Dashboard]  [Graph]  [Kanban]  [Messages]  [Reservations]                     │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### Kanban View

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│  🐝 HIVE › Kanban                           localhost:4483      opencode-swarm  │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                 │
│  ┌─ OPEN (12) ────────┐ ┌─ IN PROGRESS (3) ─┐ ┌─ BLOCKED (2) ──┐ ┌─ DONE (30) ─┐│
│  │                    │ │                   │ │                │ │             ││
│  │ ┌────────────────┐ │ │ ┌───────────────┐ │ │ ┌────────────┐ │ │ ┌─────────┐ ││
│  │ │ 🔴 P0 bug      │ │ │ │ bd-123.2      │ │ │ │ bd-456     │ │ │ │ bd-100  │ ││
│  │ │ Fix memory     │ │ │ │ Auth service  │ │ │ │ OAuth      │ │ │ │ ✓       │ ││
│  │ │ leak           │ │ │ │ 🤖 BlueLake   │ │ │ │ blocked by │ │ │ └─────────┘ ││
│  │ └────────────────┘ │ │ │ ████░░░ 45%   │ │ │ │ bd-123.2   │ │ │             ││
│  │                    │ │ └───────────────┘ │ │ └────────────┘ │ │ ┌─────────┐ ││
│  │ ┌────────────────┐ │ │                   │ │                │ │ │ bd-101  │ ││
│  │ │ 🟡 P1 task     │ │ │ ┌───────────────┐ │ │ ┌────────────┐ │ │ │ ✓       │ ││
│  │ │ Add retry      │ │ │ │ bd-123.3      │ │ │ │ bd-789     │ │ │ └─────────┘ ││
│  │ │ logic          │ │ │ │ Tests         │ │ │ │ Metrics    │ │ │             ││
│  │ └────────────────┘ │ │ │ 🤖 CoralReef  │ │ │ │ blocked by │ │ │ ┌─────────┐ ││
│  │                    │ │ │ ██░░░░░ 20%   │ │ │ │ bd-456     │ │ │ │ bd-102  │ ││
│  │ ┌────────────────┐ │ │ └───────────────┘ │ │ └────────────┘ │ │ │ ✓       │ ││
│  │ │ 🟢 P2 feature  │ │ │                   │ │                │ │ └─────────┘ ││
│  │ │ Dark mode      │ │ │ ┌───────────────┐ │ │                │ │             ││
│  │ │                │ │ │ │ bd-viz.1      │ │ │                │ │    ...      ││
│  │ └────────────────┘ │ │ │ ADR           │ │ │                │ │  +27 more   ││
│  │                    │ │ │ 🤖 Coordinator│ │ │                │ │             ││
│  │       ...          │ │ │ ██████░ 60%   │ │ │                │ │             ││
│  │    +9 more         │ │ └───────────────┘ │ │                │ │             ││
│  │                    │ │                   │ │                │ │             ││
│  └────────────────────┘ └───────────────────┘ └────────────────┘ └─────────────┘│
│                                                                                 │
│  [Dashboard]  [Graph]  [Kanban]  [Messages]  [Reservations]                     │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### Messages View (Swarm Mail)

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│  🐝 HIVE › Messages                         localhost:4483      opencode-swarm  │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                 │
│  ┌─ THREADS ──────────────────────┐  ┌─ THREAD: bd-123 ────────────────────────┐│
│  │                                │  │                                         ││
│  │  ● bd-123 (3 messages)         │  │  ┌─────────────────────────────────────┐││
│  │    LLM Compaction Epic         │  │  │ From: Coordinator                   │││
│  │    Last: 2m ago                │  │  │ To: BlueLake, CoralReef             │││
│  │                                │  │  │ Time: 12:30:00                      │││
│  │  ○ bd-456 (1 message)          │  │  │                                     │││
│  │    OAuth Integration           │  │  │ Starting LLM Compaction epic.       │││
│  │    Last: 15m ago               │  │  │ BlueLake: auth service (bd-123.2)   │││
│  │                                │  │  │ CoralReef: tests (bd-123.3)         │││
│  │  ○ bd-viz (2 messages)         │  │  │                                     │││
│  │    Hive Visualizer             │  │  └─────────────────────────────────────┘││
│  │    Last: 1h ago                │  │                                         ││
│  │                                │  │  ┌─────────────────────────────────────┐││
│  │                                │  │  │ From: CoralReef                     │││
│  │                                │  │  │ To: BlueLake                        │││
│  │                                │  │  │ Time: 12:34:48                      │││
│  │                                │  │  │ Importance: 🔴 HIGH                 │││
│  │                                │  │  │                                     │││
│  │                                │  │  │ Need the User type from your auth   │││
│  │                                │  │  │ schema. Can you export it from      │││
│  │                                │  │  │ src/auth/types.ts?                  │││
│  │                                │  │  │                                     │││
│  │                                │  │  └─────────────────────────────────────┘││
│  │                                │  │                                         ││
│  │                                │  │  ┌─────────────────────────────────────┐││
│  │                                │  │  │ From: BlueLake                      │││
│  │                                │  │  │ To: CoralReef                       │││
│  │                                │  │  │ Time: 12:35:12                      │││
│  │                                │  │  │                                     │││
│  │                                │  │  │ Done. Exported User, Session, and   │││
│  │                                │  │  │ AuthToken types. Import from        │││
│  │                                │  │  │ @/auth/types                        │││
│  │                                │  │  │                                     │││
│  │                                │  │  └─────────────────────────────────────┘││
│  │                                │  │                                         ││
│  └────────────────────────────────┘  └─────────────────────────────────────────┘│
│                                                                                 │
│  [Dashboard]  [Graph]  [Kanban]  [Messages]  [Reservations]                     │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### Reservations View (File Locks)

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│  🐝 HIVE › Reservations                     localhost:4483      opencode-swarm  │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                 │
│  ┌─ ACTIVE RESERVATIONS ───────────────────────────────────────────────────────┐│
│  │                                                                             ││
│  │  PATH                          AGENT         REASON              EXPIRES    ││
│  │  ─────────────────────────────────────────────────────────────────────────  ││
│  │  src/auth/**                   BlueLake      bd-123.2: Auth      45m        ││
│  │  src/auth/service.ts           BlueLake      bd-123.2: Auth      45m        ││
│  │  src/auth/types.ts             BlueLake      bd-123.2: Auth      45m        ││
│  │  src/tests/**                  CoralReef     bd-123.3: Tests     55m        ││
│  │  src/tests/auth.test.ts        CoralReef     bd-123.3: Tests     55m        ││
│  │                                                                             ││
│  └─────────────────────────────────────────────────────────────────────────────┘│
│                                                                                 │
│  ┌─ FILE TREE (with reservations) ─────────────────────────────────────────────┐│
│  │                                                                             ││
│  │  📁 src/                                                                    ││
│  │  ├── 📁 auth/                           🔒 BlueLake                         ││
│  │  │   ├── 📄 service.ts                  🔒 BlueLake                         ││
│  │  │   ├── 📄 types.ts                    🔒 BlueLake                         ││
│  │  │   └── 📄 middleware.ts                                                   ││
│  │  ├── 📁 tests/                          🔒 CoralReef                        ││
│  │  │   ├── 📄 auth.test.ts                🔒 CoralReef                        ││
│  │  │   └── 📄 utils.test.ts                                                   ││
│  │  ├── 📁 lib/                                                                ││
│  │  │   └── 📄 db.ts                                                           ││
│  │  └── 📄 index.ts                                                            ││
│  │                                                                             ││
│  └─────────────────────────────────────────────────────────────────────────────┘│
│                                                                                 │
│  ┌─ RESERVATION HISTORY ───────────────────────────────────────────────────────┐│
│  │                                                                             ││
│  │  12:34:52  🔒 reserved   BlueLake    src/auth/**                            ││
│  │  12:34:45  🔒 reserved   CoralReef   src/tests/**                           ││
│  │  12:30:00  🔓 released   Coordinator src/planning/**                        ││
│  │  12:28:15  🔒 reserved   Coordinator src/planning/**                        ││
│  │                                                                             ││
│  └─────────────────────────────────────────────────────────────────────────────┘│
│                                                                                 │
│  [Dashboard]  [Graph]  [Kanban]  [Messages]  [Reservations]                     │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### Epic Detail View

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│  🐝 HIVE › Epic: bd-123                     localhost:4483      opencode-swarm  │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                 │
│  ┌─ LLM-POWERED COMPACTION ────────────────────────────────────────────────────┐│
│  │                                                                             ││
│  │  Status: IN PROGRESS          Priority: P1          Created: 2h ago        ││
│  │  Progress: ████████████████████░░░░░░░░░░  80% (4/5 subtasks)              ││
│  │                                                                             ││
│  │  Description:                                                               ││
│  │  Implement LLM-powered context compaction using OpenCode's output.prompt   ││
│  │  API. Three-level fallback: LLM → static → detection → none.               ││
│  │                                                                             ││
│  └─────────────────────────────────────────────────────────────────────────────┘│
│                                                                                 │
│  ┌─ SUBTASKS ──────────────────────────────────────────────────────────────────┐│
│  │                                                                             ││
│  │  STATUS    ID          TITLE                    AGENT        PROGRESS       ││
│  │  ────────────────────────────────────────────────────────────────────────── ││
│  │  ✓ done    bd-123.1    ADR: Architecture        —            100%           ││
│  │  ✓ done    bd-123.2    Core implementation      —            100%           ││
│  │  ✓ done    bd-123.3    Fallback chain           —            100%           ││
│  │  ● active  bd-123.4    Integration tests        CoralReef    ██░░░░ 35%     ││
│  │  ○ open    bd-123.5    Documentation            —            0%             ││
│  │                                                                             ││
│  └─────────────────────────────────────────────────────────────────────────────┘│
│                                                                                 │
│  ┌─ DEPENDENCY GRAPH ─────────────────────┐  ┌─ ACTIVITY ─────────────────────┐│
│  │                                        │  │                                ││
│  │         ┌─────────┐                    │  │  12:35  ● test passed (3/10)   ││
│  │         │ bd-123  │                    │  │  12:34  ● file reserved        ││
│  │         │  EPIC   │                    │  │  12:33  ● task started         ││
│  │         └────┬────┘                    │  │  12:30  ✓ bd-123.3 completed   ││
│  │    ┌────┬────┼────┬────┐               │  │  12:25  ✓ bd-123.2 completed   ││
│  │    ▼    ▼    ▼    ▼    ▼               │  │  12:00  ✓ bd-123.1 completed   ││
│  │  ┌───┐┌───┐┌───┐┌───┐┌───┐             │  │  11:30  ● epic created         ││
│  │  │.1 ││.2 ││.3 ││.4 ││.5 │             │  │                                ││
│  │  │ ✓ ││ ✓ ││ ✓ ││ ● ││ ○ │             │  │                                ││
│  │  └───┘└───┘└───┘└───┘└───┘             │  │                                ││
│  │                                        │  │                                ││
│  └────────────────────────────────────────┘  └────────────────────────────────┘│
│                                                                                 │
│  [Dashboard]  [Graph]  [Kanban]  [Messages]  [Reservations]                     │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## Architecture

### High-Level Overview

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                        HIVE VISUALIZER ARCHITECTURE                             │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                 │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │                    LIBSQL DATABASE (Single Source of Truth)             │    │
│  │  ─────────────────────────────────────────────────────────────────────  │    │
│  │                                                                         │    │
│  │  HIVE TABLES                    SWARM-MAIL TABLES                       │    │
│  │  ───────────                    ─────────────────                       │    │
│  │  • beads (cells)                • events (16 types)                     │    │
│  │  • bead_dependencies            • agents                                │    │
│  │  • bead_labels                  • messages                              │    │
│  │  • bead_comments                • reservations                          │    │
│  │  • blocked_beads_cache          • locks, cursors, deferred              │    │
│  │                                                                         │    │
│  │  LEARNING TABLES                                                        │    │
│  │  ───────────────                                                        │    │
│  │  • eval_records                 • swarm_contexts                        │    │
│  │  • memories                                                             │    │
│  │                                                                         │    │
│  │  Note: .hive/issues.jsonl is just a git-friendly EXPORT for version     │    │
│  │        control. The database is the source of truth.                    │    │
│  │                                                                         │    │
│  └───────────────────────────────────┬─────────────────────────────────────┘    │
│                                      │                                          │
│                                      ▼                                          │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │                    DURABLE STREAMS SERVER                               │    │
│  │  ─────────────────────────────────────────────────────────────────────  │    │
│  │                                                                         │    │
│  │  GET /streams/:project?offset=N&live=true                               │    │
│  │                                                                         │    │
│  │  • Queries libSQL events table directly                                 │    │
│  │  • Uses event.id as offset (auto-incrementing)                          │    │
│  │  • Long-poll / SSE for live tailing                                     │    │
│  │  • CDN-friendly caching                                                 │    │
│  │                                                                         │    │
│  └───────────────────────────────────┬─────────────────────────────────────┘    │
│                                      │                                          │
│                                      ▼                                          │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │                    VITE + REACT APP (packages/swarm-dashboard)          │    │
│  │  ─────────────────────────────────────────────────────────────────────  │    │
│  │                                                                         │    │
│  │  ┌───────────────────────┐    ┌───────────────────────────────────┐     │    │
│  │  │    Data Fetching      │    │       React Components            │     │    │
│  │  │  ───────────────────  │    │  ───────────────────────────────  │     │    │
│  │  │                       │    │                                   │     │    │
│  │  │  • SSE /events stream │    │  • AgentsPane ✅                  │     │    │
│  │  │  • REST GET /cells    │    │  • EventsPane ✅                  │     │    │
│  │  │  • useEventSource()   │    │  • CellsPane ✅ (tree view)       │     │    │
│  │  │  • useSwarmEvents()   │    │  • TableView (TODO - sortable)    │     │    │
│  │  │                       │    │  • KanbanBoard (LATER - maybe)    │     │    │
│  │  │                       │    │                                   │     │    │
│  │  └───────────────────────┘    └───────────────────────────────────┘     │    │
│  │                                                                         │    │
│  │  NO SSR - This is a local dev tool, not a public website                │    │
│  │  SSE for events, REST polling for cells (5s interval)                   │    │
│  │                                                                         │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                 │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │                    CLI VIEWS                                            │    │
│  │  ─────────────────────────────────────────────────────────────────────  │    │
│  │                                                                         │    │
│  │  swarm viz           → Status table (queries beads table directly)      │    │
│  │  swarm viz --tree    → Dependency tree (queries bead_dependencies)      │    │
│  │  swarm viz --kanban  → Kanban columns                                   │    │
│  │  swarm viz --serve   → Start web server                                 │    │
│  │  swarm viz --export  → Static HTML snapshot                             │    │
│  │                                                                         │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### Database Schema (What We Query)

The libSQL database contains everything we need:

```sql
-- CELLS (work items)
SELECT * FROM beads WHERE project_key = ? AND status != 'tombstone';

-- DEPENDENCIES (who blocks whom)
SELECT * FROM bead_dependencies WHERE cell_id IN (...);

-- EVENTS (real-time activity stream)
SELECT * FROM events WHERE project_key = ? AND id > ? ORDER BY id LIMIT ?;

-- AGENTS (who's working)
SELECT * FROM agents WHERE project_key = ?;

-- MESSAGES (swarm mail)
SELECT * FROM messages WHERE project_key = ? ORDER BY created_at DESC;

-- RESERVATIONS (who owns what files)
SELECT * FROM reservations WHERE project_key = ? AND expires_at > ?;
```

The JSONL file (`.hive/issues.jsonl`) is a **git-friendly export** that gets regenerated from the database. We don't read from it - we read from libSQL directly.

### Durable Streams Adapter

The key integration point is adapting our libSQL event store to the Durable Streams protocol:

```typescript
// packages/swarm-mail/src/streams/durable-adapter.ts

import { DurableStreamServer } from '@durable-streams/server';
import { getSwarmMailLibSQL } from '../libsql';

/**
 * Adapts swarm-mail libSQL events to Durable Streams protocol
 * 
 * Events are stored with auto-incrementing `id` which serves as the offset.
 * The adapter translates between our event schema and Durable Streams format.
 */
export function createDurableStreamAdapter(projectPath: string) {
  const swarmMail = await getSwarmMailLibSQL(projectPath);
  
  return new DurableStreamServer({
    // Read events from offset
    async read(streamId: string, offset: number, limit: number) {
      const events = await swarmMail.getEventsFrom(offset, limit);
      return events.map(e => ({
        offset: e.id,
        data: JSON.stringify(e),
        timestamp: e.timestamp,
      }));
    },
    
    // Get current head offset
    async head(streamId: string) {
      const latest = await swarmMail.getLatestEvent();
      return latest?.id ?? 0;
    },
    
    // Subscribe to new events (for live tailing)
    subscribe(streamId: string, callback: (event) => void) {
      return swarmMail.onEvent(callback);
    },
  });
}
```

### Client-Side Subscription

The TanStack Start app uses `@durable-streams/client` for live updates:

```typescript
// apps/hive-viz/src/hooks/useEventStream.ts

import { DurableStreamClient } from '@durable-streams/client';
import { useEffect, useState } from 'react';

export function useEventStream(projectKey: string) {
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [offset, setOffset] = useState(0);
  
  useEffect(() => {
    const client = new DurableStreamClient({
      url: `/streams/${encodeURIComponent(projectKey)}`,
      // Resume from stored offset (survives refresh)
      initialOffset: localStorage.getItem(`offset:${projectKey}`) ?? 0,
    });
    
    client.subscribe((event) => {
      setEvents(prev => [...prev, JSON.parse(event.data)]);
      setOffset(event.offset);
      // Persist offset for resumability
      localStorage.setItem(`offset:${projectKey}`, event.offset);
    });
    
    return () => client.close();
  }, [projectKey]);
  
  return { events, offset };
}
```

### Component Overview (Original)

### Data Model Mapping

Our cells map to beads_viewer concepts:

| Hive Concept | beads_viewer Equivalent | Notes |
|--------------|-------------------------|-------|
| Cell | Bead/Issue | Work item |
| `parent_id` | `blocked_by` | Dependency relationship |
| `status` | `status` | open, in_progress, blocked, closed |
| `issue_type` | `type` | bug, feature, task, epic, chore |
| `priority` | `priority` | 0-3 (we use 0=highest, they use 0=lowest) |
| Epic + subtasks | Parent-child hierarchy | Our `parent_id` creates tree structure |

### Graph Metrics (Subset of beads_viewer)

We'll implement a **focused subset** of beads_viewer's 9 metrics:

| Metric | Priority | Rationale |
|--------|----------|-----------|
| **Dependency Graph** | P0 | Core visualization - who blocks whom |
| **Status Distribution** | P0 | How many open/blocked/done |
| **Critical Path** | P1 | What's the longest chain to completion |
| **Cycle Detection** | P1 | Circular dependencies are bugs |
| **Blocked Cascade** | P1 | What gets unblocked if X completes |
| PageRank | P2 | Nice-to-have for large projects |
| Betweenness | P2 | Nice-to-have for bottleneck detection |
| HITS | P3 | Probably overkill for our scale |

### CLI Views

#### 1. Status Table (Default)

```
$ swarm viz

┌─────────────────────────────────────────────────────────────────────────┐
│  🐝 HIVE STATUS                                    opencode-swarm-plugin │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  SUMMARY                                                                │
│  ───────                                                                │
│  Total: 47 cells    Open: 12    In Progress: 3    Blocked: 2    Done: 30│
│                                                                         │
│  ACTIVE EPICS                                                           │
│  ────────────                                                           │
│  🎯 bd-abc123 "LLM-Powered Compaction"           [████████░░] 80%       │
│     ├─ ✅ bd-abc123.1 ADR: Architecture                                 │
│     ├─ ✅ bd-abc123.2 Implementation                                    │
│     └─ 🚧 bd-abc123.3 Tests                      ← IN PROGRESS          │
│                                                                         │
│  🎯 bd-def456 "Hive Visualizer"                  [░░░░░░░░░░] 0%        │
│     └─ 📋 bd-def456.1 ADR (this document)        ← IN PROGRESS          │
│                                                                         │
│  READY TO START (unblocked, highest priority)                           │
│  ─────────────────────────────────────────────                          │
│  1. bd-xyz789 "Fix memory leak in daemon"        P0  bug                │
│  2. bd-xyz790 "Add retry logic to sync"          P1  task               │
│                                                                         │
│  BLOCKED (waiting on dependencies)                                      │
│  ─────────────────────────────────                                      │
│  ⛔ bd-xyz791 "OAuth integration"                                       │
│     └─ Blocked by: bd-xyz792 "Auth service refactor"                    │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

#### 2. Dependency Tree

```
$ swarm viz --tree

bd-abc123 "LLM-Powered Compaction" (epic)
├── bd-abc123.1 "ADR: Architecture" ✅
├── bd-abc123.2 "Implementation" ✅
│   └── depends on: bd-abc123.1
└── bd-abc123.3 "Tests" 🚧
    └── depends on: bd-abc123.2

bd-def456 "Hive Visualizer" (epic)
└── bd-def456.1 "ADR" 🚧
```

#### 3. Kanban ASCII

```
$ swarm viz --kanban

┌─────────────┬─────────────┬─────────────┬─────────────┐
│    OPEN     │ IN PROGRESS │   BLOCKED   │   CLOSED    │
│    (12)     │     (3)     │     (2)     │    (30)     │
├─────────────┼─────────────┼─────────────┼─────────────┤
│ bd-xyz789   │ bd-abc123.3 │ bd-xyz791   │ bd-abc123.1 │
│ P0 bug      │ Tests       │ OAuth       │ ADR         │
│             │             │             │             │
│ bd-xyz790   │ bd-def456.1 │ bd-xyz793   │ bd-abc123.2 │
│ P1 task     │ ADR         │ Metrics     │ Impl        │
│             │             │             │             │
│ ...+10      │ bd-ghi789   │             │ ...+28      │
│             │ Refactor    │             │             │
└─────────────┴─────────────┴─────────────┴─────────────┘
```

### HTML Export (LATER)

Static HTML export is a **nice-to-have**, not MVP. When we do it:

1. **Table view** (sortable, filterable)
2. **Tree view** (collapsible hierarchy)
3. **Filters** (status, type, priority)
4. **Search** (fuzzy match on title/description)
5. **Embedded data** (JSON blob in `<script>` tag)

**NO force-directed graphs.** Just boring, useful tables.

**File size target:** < 100KB (no heavy viz libraries).

---

## Implementation Plan

### Phase 1: Durable Streams Adapter (Week 1)

**Goal:** Expose swarm-mail events via Durable Streams protocol.

```typescript
// packages/swarm-mail/src/streams/durable-adapter.ts

interface DurableStreamConfig {
  projectPath: string;
  port?: number;
}

interface StreamEvent {
  offset: number;
  data: string;  // JSON-encoded AgentEvent
  timestamp: number;
}

/**
 * Creates a Durable Streams server that exposes swarm-mail events
 */
async function createDurableStreamServer(config: DurableStreamConfig): Promise<{
  start(): Promise<void>;
  stop(): Promise<void>;
  getUrl(): string;
}>;

/**
 * Low-level adapter for reading events with offset-based pagination
 */
interface DurableStreamAdapter {
  read(offset: number, limit: number): Promise<StreamEvent[]>;
  head(): Promise<number>;
  subscribe(callback: (event: StreamEvent) => void): () => void;
}
```

**Tasks:**
- [ ] Add `getEventsFrom(offset, limit)` method to SwarmMailAdapter
- [ ] Add `getLatestEventId()` method for head offset
- [ ] Add `onEvent(callback)` subscription for live tailing
- [ ] Create `DurableStreamAdapter` wrapping libSQL queries
- [ ] Create HTTP server using `@durable-streams/server` or custom Bun.serve
- [ ] Support both long-poll and SSE modes
- [ ] Write integration tests for offset-based reads

### Phase 2: Data Layer + CLI Views (Week 2)

**Goal:** Extract hive data and provide terminal-based visualization.

```typescript
// packages/opencode-swarm-plugin/src/viz/data.ts

interface VizCell {
  id: string;
  title: string;
  description?: string;
  status: "open" | "in_progress" | "blocked" | "closed";
  type: "bug" | "feature" | "task" | "epic" | "chore";
  priority: number;
  parent_id?: string;
  dependencies: string[];  // Cells this blocks
  dependents: string[];    // Cells blocked by this
  created_at: string;
  updated_at: string;
  closed_at?: string;
  closed_reason?: string;
}

interface VizGraph {
  cells: VizCell[];
  edges: Array<{ from: string; to: string; type: "blocks" | "parent" }>;
  metrics: {
    total: number;
    by_status: Record<string, number>;
    by_type: Record<string, number>;
    critical_path: string[];
    cycles: string[][];
  };
  generated_at: string;
}

async function buildVizGraph(projectPath: string): Promise<VizGraph>;
```

**Tasks:**
- [ ] Create `VizCell` and `VizGraph` types
- [ ] Implement `buildVizGraph()` using HiveAdapter
- [ ] Add dependency resolution (parent_id → blocks relationship)
- [ ] Implement cycle detection (Tarjan's SCC)
- [ ] Implement critical path calculation
- [ ] Implement status table with box-drawing characters
- [ ] Implement dependency tree with indentation
- [ ] Implement kanban columns
- [ ] Add color coding (picocolors)
- [ ] Add `swarm viz` CLI command

### Phase 3: Vite + React Web App (ALREADY STARTED)

**Goal:** Real-time interactive visualization.

**ACTUAL LOCATION:** `packages/swarm-dashboard/` (NOT apps/hive-viz)

```
packages/
  swarm-dashboard/
    src/
      components/
        AgentsPane.tsx      ✅ DONE - Event-driven (SSE → useMemo)
        EventsPane.tsx      ✅ DONE - Event-driven
        CellsPane.tsx       ✅ DONE - REST polling (needs /cells endpoint)
        AgentCard.tsx       ✅ DONE - Display component
        EventRow.tsx        ✅ DONE - Display component
        CellNode.tsx        ✅ DONE - Display component
        Layout.tsx          ✅ DONE - Shell
        SwarmCard.tsx       ✅ DONE
        StatsGrid.tsx       ✅ DONE
      hooks/
        useEventSource.ts   ✅ DONE - SSE connection
        useSwarmEvents.ts   ✅ DONE - Event stream processing
      lib/
        api.ts              ✅ DONE - getCells with tree building
        types.ts            ✅ DONE
      App.tsx               ❌ TODO - Wire up components (still Vite template!)
    package.json            # Vite + React 19 + Tailwind 4
```

**BLOCKED ON:**
- [ ] GET /cells endpoint in `swarm-mail/src/streams/durable-server.ts`
- [ ] Wire App.tsx to use Layout + panes

**Remaining Tasks:**
- [ ] Add GET /cells endpoint to durable-server.ts
- [ ] Wire App.tsx to use Layout, AgentsPane, EventsPane, CellsPane
- [ ] Add force-graph GraphView component
- [ ] Add KanbanBoard component
- [ ] Add `swarm viz --serve` CLI command to start both servers

### Phase 4: Static Export + Integration (LATER)

**Goal:** Self-contained HTML export. NOT MVP.

**Deferred until web dashboard is solid.**

**When we do it:**
- [ ] Create HTML template with embedded CSS
- [ ] Table view with sorting/filtering
- [ ] Tree view with collapsible nodes
- [ ] NO force-graph bullshit
- [ ] Add `swarm viz --export` CLI command

---

## Technical Decisions

### 1. Durable Streams over WebSocket

**Decision:** Use Durable Streams protocol instead of raw WebSocket.

**Rationale:**
- **Offset-based resumability**: Client stores offset, resumes from exact position on reconnect
- **Refresh-safe**: User refreshes page → no lost events, no duplicate events
- **Multi-tab friendly**: Multiple tabs can share same stream without coordination
- **CDN-friendly**: HTTP-based protocol works with edge caching
- **Production-proven**: 1.5 years at Electric, millions of events/day

**Tradeoff:**
- Slightly higher latency than raw WebSocket (~50ms for long-poll)
- Acceptable for our use case (human-readable dashboard, not trading system)

**Implementation options:**
1. Use `@durable-streams/server` reference implementation
2. Build custom adapter with Bun.serve (simpler, fewer deps)

### 2. Vite + React over Next.js/TanStack Start

**Decision:** Use plain Vite + React for the web app.

**Rationale:**
- **Local dev tool**: No SEO, no public website, no SSR needed
- **Simplicity**: Just React components + SSE, no framework overhead
- **Fast iteration**: Vite HMR is instant
- **Already started**: `packages/swarm-dashboard/` exists with working components
- **Bun-native**: Works perfectly with our Bun-based toolchain

**Why NOT TanStack Start or Next.js:**
- Overkill for localhost-only dashboard
- RSC/SSR complexity unnecessary for local SQLite queries
- Framework learning curve for simple CRUD UI
- We don't need edge runtime, image optimization, or app router

**Tradeoff:**
- No SSR (acceptable - local tool, not public website)
- Manual routing (acceptable - only 3-4 views)

### 3. No TUI Framework (Bubble Tea Alternative)

**Decision:** Use simple string rendering for CLI, not a full TUI framework.

**Rationale:**
- Bubble Tea is Go-only; TypeScript alternatives (ink, blessed) are heavy
- Our CLI views are read-only status displays, not interactive
- Simple `console.log` with ANSI codes is sufficient
- Keeps bundle size small

**Tradeoff:**
- No interactive navigation (j/k keys, etc.)
- Acceptable because we have web app for rich interaction

### 4. Boring First, Eye Candy Later

**Decision:** NO force-directed graphs. Start with tables, trees, and lists.

**Rationale:**
- Force graphs are the "word cloud" of data viz - impressive demos, useless for work
- You can't actually DO anything with a force graph except watch it wiggle
- Tables are sortable, filterable, actionable
- Trees show hierarchy clearly
- Lists show activity chronologically

**Future (MAYBE):**
- Matrix-style raw data flow visualization (when we have real needs)
- But only after boring views are rock solid

**What we're building:**
1. Tree view (cells with hierarchy) ✅ exists
2. Table view (sortable columns) - TODO
3. Activity feed (events stream) ✅ exists
4. Agent status (who's working) ✅ exists

### 5. Client-Side Projections

**Decision:** Compute projections (cells, agents, messages) on the client from events.

**Rationale:**
- Events are small (~200 bytes each)
- Client can replay from any offset
- Enables time-travel debugging
- Reduces server complexity

**Implementation:**
```typescript
// Client receives events, builds local state
function projectCells(events: AgentEvent[]): Map<string, Cell> {
  const cells = new Map();
  for (const event of events) {
    switch (event.type) {
      case 'task_started':
        cells.set(event.cell_id, { ...cells.get(event.cell_id), status: 'in_progress' });
        break;
      case 'task_completed':
        cells.set(event.cell_id, { ...cells.get(event.cell_id), status: 'closed' });
        break;
      // ...
    }
  }
  return cells;
}
```

**Tradeoff:**
- Initial load replays all events (mitigated by SSR with snapshot)
- Memory grows with event count (mitigated by compaction)

### 6. Inline Everything for Static Export

**Decision:** HTML export is a single file with no external dependencies.

**Rationale:**
- Works offline
- No CORS issues
- Easy to share (email, Slack, etc.)
- No server required

**Implementation:**
- Inline CSS (Tailwind)
- Inline JS libraries via bundled snapshot
- Inline data as JSON in `<script>` tag

### 7. Subset of Metrics

**Decision:** Implement only essential metrics, not all 9 from beads_viewer.

**Rationale:**
- Our projects are smaller (typically <100 cells)
- PageRank/Betweenness/HITS are overkill
- Focus on actionable insights: cycles, critical path, blocked cascade

**Metrics included:**
- Dependency graph (core)
- Status distribution
- Critical path
- Cycle detection
- Blocked cascade (what unblocks if X completes)

**Metrics deferred:**
- PageRank (P2)
- Betweenness centrality (P2)
- HITS hub/authority (P3)
- Eigenvector centrality (P3)

---

## Data Format

### Input: issues.jsonl

```jsonl
{"id":"bd-abc123","title":"Epic Title","status":"open","issue_type":"epic","priority":1,"created_at":"2025-12-23T..."}
{"id":"bd-abc123.1","title":"Subtask 1","status":"closed","issue_type":"task","priority":2,"parent_id":"bd-abc123","created_at":"2025-12-23T...","closed_at":"2025-12-23T...","closed_reason":"Done"}
```

### Output: VizGraph JSON

```json
{
  "cells": [
    {
      "id": "bd-abc123",
      "title": "Epic Title",
      "status": "open",
      "type": "epic",
      "priority": 1,
      "dependencies": ["bd-abc123.1", "bd-abc123.2"],
      "dependents": [],
      "created_at": "2025-12-23T..."
    }
  ],
  "edges": [
    { "from": "bd-abc123.1", "to": "bd-abc123", "type": "parent" }
  ],
  "metrics": {
    "total": 47,
    "by_status": { "open": 12, "in_progress": 3, "blocked": 2, "closed": 30 },
    "by_type": { "epic": 5, "task": 30, "bug": 10, "feature": 2 },
    "critical_path": ["bd-abc123", "bd-abc123.2", "bd-abc123.3"],
    "cycles": []
  },
  "generated_at": "2025-12-23T16:00:00.000Z"
}
```

---

## User Experience

### CLI Workflow

```bash
# Quick status check
$ swarm viz

# Dependency tree view
$ swarm viz --tree

# Kanban view
$ swarm viz --kanban

# Export to HTML
$ swarm viz --export ./hive-status.html

# Open in browser
$ open ./hive-status.html
```

### HTML Export Workflow

1. Run `swarm viz --export ./status.html`
2. Open in browser
3. Explore:
   - Click nodes to see details
   - Filter by status/type/priority
   - Search for specific cells
   - Zoom/pan the graph
4. Share the HTML file (email, Slack, etc.)

---

## Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Scope creep (fancy viz) | High | Medium | BORING FIRST. Tables and trees only. |
| CLI output ugly in non-Unicode terminals | Medium | Low | Detect and fall back to ASCII |
| SSE connection drops | Medium | Low | Auto-reconnect with backoff |

---

## Success Criteria

### MVP (What Actually Matters)

- [x] AgentsPane shows who's working ✅ DONE
- [x] EventsPane shows activity feed ✅ DONE
- [x] CellsPane shows tree view ✅ DONE
- [ ] GET /cells endpoint in durable-server.ts
- [ ] App.tsx wired to use components (not Vite template)
- [ ] `swarm viz --serve` starts the dashboard
- [ ] Dashboard loads real data from swarm-mail

### Phase 2 (Useful Additions)

- [ ] TableView with sortable columns
- [ ] Filters (status, type, priority)
- [ ] Search (fuzzy match)
- [ ] CLI `swarm viz` shows status table

### Future (Eye Candy - ONLY AFTER BORING WORKS)

- [ ] Matrix-style raw data flow visualization
- [ ] Time-travel (replay events)
- [ ] Static HTML export

---

## Alternatives Considered

### A. Fork beads_viewer

**Pros:**
- Full-featured, battle-tested
- Beautiful TUI with Bubble Tea
- All 9 metrics implemented

**Cons:**
- Go codebase (we're TypeScript)
- Different data format (beads.jsonl vs issues.jsonl)
- Maintenance burden of a fork
- Overkill for our needs

**Verdict:** Too much friction. Better to build focused tool.

### B. Use beads_viewer with adapter

**Pros:**
- No code to write
- Get all features for free

**Cons:**
- Requires Go installation
- Need to convert issues.jsonl → beads.jsonl
- Two-way sync complexity
- User must learn two tools

**Verdict:** Integration complexity not worth it.

### C. Web app with server

**Pros:**
- Rich interactivity
- Real-time updates possible
- Could integrate with swarm mail

**Cons:**
- Requires running server
- Context switch from terminal
- More infrastructure to maintain

**Verdict:** Overkill. Static HTML is sufficient.

### D. VS Code extension

**Pros:**
- Integrated into editor
- Rich UI capabilities
- Could show inline in sidebar

**Cons:**
- VS Code only (excludes Vim, Emacs, etc.)
- Extension development overhead
- Separate codebase to maintain

**Verdict:** Too narrow. CLI + HTML is more universal.

---

## References

- [beads_viewer](https://github.com/Dicklesworthstone/beads_viewer) - Inspiration (but we're simpler)
- [beads-ui](https://github.com/mantoni/beads-ui) - Web UI reference
- [Durable Streams](https://github.com/durable-streams/durable-streams) - Event streaming protocol

---

## Appendix: beads_viewer Feature Comparison

| Feature | beads_viewer | Our Visualizer | Notes |
|---------|--------------|----------------|-------|
| List view | ✅ | ✅ (tree + table) | Core |
| Kanban board | ✅ | ❌ (LATER) | Not MVP |
| Graph view | ✅ | ❌ (NEVER) | Force graphs are useless |
| Insights dashboard | ✅ | ❌ | Not needed |
| History view | ✅ | ✅ (EventsPane) | Core |
| PageRank | ✅ | ❌ | Useless metric |
| Betweenness | ✅ | ❌ | Useless metric |
| HITS | ✅ | ❌ | Useless metric |
| Critical path | ✅ | ❌ (LATER) | Nice-to-have |
| Cycle detection | ✅ | ❌ (LATER) | Nice-to-have |
| Robot JSON output | ✅ | ✅ | Via existing tools |
| Static HTML export | ✅ | ❌ (LATER) | Not MVP |
| Time-travel | ✅ | ❌ (LATER) | Future eye candy |
| Fuzzy search | ✅ | ❌ (LATER) | Phase 2 |
| Live reload | ✅ | ✅ (SSE) | Core |
| Vim keybindings | ✅ | ❌ | No TUI |

---

---

## Real-Time Features (Durable Streams)

### What Users Will See

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    LIVE ACTIVITY DASHBOARD                              │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  🟢 CONNECTED (offset: 1,247)                    Last event: 2s ago     │
│                                                                         │
│  ACTIVE AGENTS (3)                                                      │
│  ────────────────                                                       │
│  🤖 BlueLake      Working on bd-123.2 "Auth service"     45% ████░░░░░  │
│  🤖 CoralReef     Working on bd-123.3 "Tests"            20% ██░░░░░░░  │
│  🤖 MintForest    Idle (last active 5m ago)                             │
│                                                                         │
│  RECENT EVENTS                                                          │
│  ─────────────                                                          │
│  12:34:56  task_progress   BlueLake → bd-123.2 "Implementing JWT"       │
│  12:34:52  file_reserved   BlueLake → src/auth/**                       │
│  12:34:48  message_sent    CoralReef → BlueLake "Need schema types"     │
│  12:34:45  task_started    CoralReef → bd-123.3                         │
│  12:34:40  agent_registered MintForest                                  │
│                                                                         │
│  FILE RESERVATIONS                                                      │
│  ─────────────────                                                      │
│  src/auth/**        BlueLake   (expires in 45m)                         │
│  src/tests/**       CoralReef  (expires in 55m)                         │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### Resumability Demo

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    RESUMABILITY IN ACTION                               │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  1. User opens dashboard                                                │
│     → Client connects, receives events 1-100                            │
│     → Stores offset=100 in localStorage                                 │
│                                                                         │
│  2. User refreshes page (or closes tab, switches device)                │
│     → Client reconnects with offset=100                                 │
│     → Server sends only events 101-150 (not 1-150)                      │
│     → No duplicate events, no lost events                               │
│                                                                         │
│  3. Network flaps (WiFi drops, VPN reconnects)                          │
│     → Client auto-reconnects with last offset                           │
│     → Seamless recovery, user sees continuous stream                    │
│                                                                         │
│  4. Multiple tabs open same dashboard                                   │
│     → Each tab has independent offset                                   │
│     → No coordination needed, no duplicate connections                  │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### Event-to-UI Mapping

| Event Type | UI Update |
|------------|-----------|
| `agent_registered` | Add agent to "Active Agents" list |
| `agent_active` | Update agent's "last active" timestamp |
| `task_started` | Move cell to "In Progress" column, show agent assignment |
| `task_progress` | Update progress bar, show latest message |
| `task_completed` | Move cell to "Done" column, show completion summary |
| `task_blocked` | Move cell to "Blocked" column, show blocker reason |
| `message_sent` | Add to message feed, highlight if urgent |
| `file_reserved` | Add to reservations list, show owner and TTL |
| `file_released` | Remove from reservations list |
| `decomposition_generated` | Show new epic with subtasks |
| `subtask_outcome` | Update learning metrics, show success/failure |

---

## Changelog

| Date | Author | Change |
|------|--------|--------|
| 2025-12-23 | Coordinator | Initial draft |
| 2025-12-23 | Coordinator | Updated with TanStack Start + Durable Streams architecture |
| 2025-12-26 | Coordinator | MAJOR REVISION: Vite + React (not TanStack Start), NO force-graphs (useless eye candy), boring-first philosophy, documented existing packages/swarm-dashboard work |
