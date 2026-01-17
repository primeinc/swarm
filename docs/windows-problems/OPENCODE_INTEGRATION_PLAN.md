# OpenCode Integration Plan for swarm-tools

**Created:** 2026-01-11
**Status:** Planning
**Author:** AI Assistant + Will

---

## Executive Summary

This document describes how to make swarm-tools' Meteor DDP inspection capabilities available to OpenCode (the AI coding assistant) as native custom tools. The goal is feature parity with—or exceeding—the VS Code extension's Copilot integration.

**Key Decision:** Native OpenCode tools over MCP integration.

**Rationale:**
- Auth tokens stay local (no network boundary)
- Module-scope state enables persistent WebSocket connections without a daemon
- Simpler architecture than HTTP/RPC service
- Tighter integration with OpenCode's agentic workflows

---

## Table of Contents

1. [Background & Context](#1-background--context)
2. [Current Architecture](#2-current-architecture)
3. [Target Architecture](#3-target-architecture)
4. [Why These Decisions](#4-why-these-decisions)
5. [Implementation Phases](#5-implementation-phases)
6. [Tool Specifications](#6-tool-specifications)
7. [Skill Specifications](#7-skill-specifications)
8. [Testing Strategy](#8-testing-strategy)
9. [Migration & Compatibility](#9-migration--compatibility)
10. [Open Questions](#10-open-questions)
11. [Appendix](#11-appendix)

---

## 1. Background & Context

### 1.1 What is swarm-tools?

swarm-tools is a VS Code extension for inspecting Meteor DDP (Distributed Data Protocol) WebSocket traffic. It provides:

- **DDP Client**: Connect to Meteor apps via SockJS or raw WebSocket
- **Traffic Logging**: Capture all DDP messages (methods, subscriptions, collection updates)
- **Collection Store**: In-memory cache of MongoDB documents received via DDP
- **Browser Discovery**: Playwright-based automation to discover API surface by intercepting real browser traffic
- **AI Tools**: VS Code Language Model tools for Copilot Chat integration

### 1.2 What is OpenCode?

OpenCode is an open-source AI coding agent that runs in the terminal, as a desktop app, or as an IDE extension. It supports:

- **Custom Tools**: TypeScript/JavaScript functions the LLM can invoke
- **Plugins**: Event hooks for customizing behavior
- **Skills**: Markdown documents that teach the agent workflows
- **Agents**: Specialized AI assistants with custom prompts and tool access

### 1.3 Why Integrate?

The VS Code extension exposes DDP capabilities to GitHub Copilot via Language Model tools. We want OpenCode to have the same (or better) capabilities:

- Connect to Meteor apps
- Call methods, manage subscriptions
- Inspect collections and infer schemas
- Monitor traffic in real-time
- Discover API surface via browser automation

### 1.4 Design Constraints

1. **Single-user MVP**: One operator, one Meteor site at a time
2. **Local-only auth**: Tokens/passwords never leave the machine
3. **No network services**: Avoid HTTP daemons if possible
4. **Stateful connections**: DDP is WebSocket-based, requires persistent connection
5. **TypeScript strict mode**: No `any` escape hatches

---

## 2. Current Architecture

### 2.1 Component Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                     VS Code Extension                           │
├─────────────────────────────────────────────────────────────────┤
│  extension.ts                                                   │
│  ├── Instantiates DDPClient, CollectionStore, DiscoverySession │
│  ├── Registers VS Code commands (connect, disconnect, etc.)     │
│  ├── Registers Language Model tools via vscode.lm.registerTool │
│  ├── Manages secrets via context.secrets                        │
│  └── Coordinates UI providers (webviews, tree views)            │
├─────────────────────────────────────────────────────────────────┤
│  src/ddp/DDPClient.ts          [VS Code FREE]                   │
│  ├── WebSocket client (ws package)                              │
│  ├── SockJS + raw transport detection                           │
│  ├── DDP message parsing (connect, method, sub, added, etc.)    │
│  ├── Auth helpers (loginWithToken, loginWithPassword)           │
│  └── Heartbeat tracking (ping/pong, RTT)                        │
├─────────────────────────────────────────────────────────────────┤
│  src/data/CollectionStore.ts   [VS Code FREE]                   │
│  ├── In-memory document cache                                   │
│  ├── Handles added/changed/removed messages                     │
│  └── Query methods (getAll, getCollection, getSample)           │
├─────────────────────────────────────────────────────────────────┤
│  src/discovery/DiscoverySession.ts  [VS Code FREE]              │
│  ├── Playwright browser orchestration                           │
│  ├── DDP traffic interception via injected scripts              │
│  ├── Schema discovery from Meteor.Collection instances          │
│  └── Route discovery from client-side router                    │
├─────────────────────────────────────────────────────────────────┤
│  src/tools/ToolManager.ts      [MINIMAL VS Code dependency]     │
│  ├── Tool registration and execution                            │
│  ├── Dependency injection via ToolManagerDeps                   │
│  └── Uses vscode.CancellationToken (easily replaceable)         │
├─────────────────────────────────────────────────────────────────┤
│  src/tools/impl/*.ts           [VS Code FREE via abstraction]   │
│  ├── CallMethodTool, SubscribeTool, UnsubscribeTool             │
│  ├── InspectCollectionTool, DiscoverSchemaTool                  │
│  ├── GetDiscoveredApiTool, GetRoutesTool, NavigateTool          │
│  └── All access services via context.deps (no direct vscode)    │
├─────────────────────────────────────────────────────────────────┤
│  src/ui/*.ts                   [VS Code DEPENDENT]              │
│  ├── SetupViewProvider (webview)                                │
│  ├── TraceViewProvider (webview)                                │
│  ├── ConnectionsProvider (tree view)                            │
│  └── LogManager (output channel)                                │
└─────────────────────────────────────────────────────────────────┘
```

### 2.2 VS Code Dependency Analysis

| Component | Imports vscode? | Reason | Effort to Decouple |
|-----------|-----------------|--------|-------------------|
| DDPClient | NO | Pure Node.js (ws, events, crypto) | None |
| CollectionStore | NO | Pure TypeScript | None |
| DiscoverySession | NO | Playwright only | None |
| ToolManager | YES | `vscode.CancellationToken` type only | Trivial (use AbortSignal) |
| Tool implementations | NO | Access deps via abstraction | None |
| extension.ts | YES | Orchestration, secrets, commands | N/A (VS Code entry point) |
| UI providers | YES | Webviews, tree views | N/A (VS Code UI) |

**Key Insight:** The core capabilities (DDPClient, CollectionStore, DiscoverySession) are already VS Code-free. Only the orchestration layer depends on VS Code.

### 2.3 Current Tool Interface

```typescript
// src/tools/ToolManager.ts
export interface Tool {
    readonly name: string;
    execute(input: any, context: ToolContext): Promise<ToolResult>;
}

export interface ToolContext {
    deps: ToolManagerDeps;
    token: vscode.CancellationToken;  // <-- Only VS Code dependency
}

export interface ToolManagerDeps {
    getClient: () => DDPClient | null;
    getTargetUrl: () => string;
    getDiscoveryHistoryForTarget: (targetUrl: string) => DiscoveryHistory | undefined;
    getCollectionStore: () => CollectionStore;
    subscribe: (name: string, params: unknown[]) => Promise<string>;
    unsubscribe: (id: string) => Promise<void>;
    discoverRoutes: () => Promise<any>;
    navigate: (url: string) => Promise<void>;
}
```

### 2.4 Current Tool List

| Tool Name | Purpose | Requires Connection | Requires Discovery |
|-----------|---------|--------------------|--------------------|
| `swarm-tools_call_method` | Execute DDP method | YES | NO |
| `swarm-tools_subscribe` | Start DDP subscription | YES | NO |
| `swarm-tools_unsubscribe` | Stop DDP subscription | YES | NO |
| `swarm-tools_inspect_collection` | Query cached documents | YES | NO |
| `swarm-tools_discover_schema` | Extract schemas from browser | NO | YES |
| `swarm-tools_get_discovered_api` | List methods/subs seen | NO | NO (uses history) |
| `swarm-tools_get_routes` | Get client routes | NO | YES |
| `swarm-tools_navigate` | Navigate browser | NO | YES |

---

## 3. Target Architecture

### 3.1 OpenCode Custom Tools Structure

```
.opencode/
├── tool/
│   └── swarm-tools.ts              # All swarm-tools tools (multiple exports)
└── skill/
    └── swarm-tools-inspect/
        └── SKILL.md           # Workflow guidance for inspecting Meteor apps
```

### 3.2 Module-Scope State Pattern

OpenCode tools are loaded as ES modules. The module stays in memory across tool invocations, enabling persistent state:

```typescript
// .opencode/tool/swarm-tools.ts

import { tool } from "@opencode-ai/plugin"
import { DDPClient } from "../../src/engine"
import { CollectionStore } from "../../src/engine"

// ============================================================
// MODULE-SCOPE STATE
// These variables persist across tool invocations!
// ============================================================

let client: DDPClient | null = null;
let store: CollectionStore = new CollectionStore();
let targetUrl: string = "";
let eventLog: DDPEvent[] = [];

// ============================================================
// TOOLS (exported functions become callable by LLM)
// ============================================================

export const connect = tool({ ... });
export const disconnect = tool({ ... });
export const call_method = tool({ ... });
// etc.
```

**Why this works:**
1. OpenCode loads the tool module once
2. Module-scope variables (`client`, `store`, etc.) persist
3. Each tool invocation accesses the same state
4. No daemon/service needed - the OpenCode runtime IS the host process

### 3.3 Engine Extraction

Create a thin barrel export for the VS Code-free components:

```
src/
├── engine/
│   ├── index.ts               # Re-exports DDPClient, CollectionStore, etc.
│   └── types.ts               # Shared types without vscode dependencies
├── ddp/
│   └── DDPClient.ts           # (unchanged)
├── data/
│   └── CollectionStore.ts     # (unchanged)
└── discovery/
    └── DiscoverySession.ts    # (unchanged)
```

**Why extract?**
- Clean import path for OpenCode tools: `import { DDPClient } from "../../src/engine"`
- Explicit boundary between "engine" (VS Code-free) and "extension" (VS Code-dependent)
- Future-proofs for CLI tool, other integrations

### 3.4 Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                        OpenCode Runtime                         │
├─────────────────────────────────────────────────────────────────┤
│  .opencode/tool/swarm-tools.ts                                       │
│  ├── Module-scope state (client, store, eventLog)               │
│  ├── connect, disconnect                                        │
│  ├── call_method, subscribe, unsubscribe                        │
│  ├── inspect_collection, list_collections                       │
│  ├── tail_events, get_status                                    │
│  └── discovery_start, discovery_stop, etc. (Phase 2)            │
│                           │                                     │
│                           ▼                                     │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                    src/engine/                           │   │
│  │  ├── DDPClient (WebSocket, DDP protocol)                 │   │
│  │  ├── CollectionStore (document cache)                    │   │
│  │  └── DiscoverySession (Playwright, Phase 2)              │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                     VS Code Extension                           │
│  (continues to work independently, same engine)                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 4. Why These Decisions

### 4.1 Why Native Tools over MCP?

| Factor | Native Tools | MCP |
|--------|--------------|-----|
| Auth handling | Tokens stay in-process | Would require secure transport |
| State management | Module scope = free | Need external daemon |
| Complexity | Single file | Server + protocol + client |
| Debugging | Standard Node.js | Network boundary adds friction |
| Performance | Direct function call | HTTP/WebSocket overhead |

**Decision:** Native tools. The auth concern alone is decisive—we don't want resume tokens crossing a network boundary, even localhost.

### 4.2 Why Module-Scope State over Daemon?

Original plan proposed an HTTP daemon (`swarm-toolsd`) for persistent state. Discovery:

1. OpenCode tool modules are **persistent** - they stay loaded across invocations
2. Module-scope variables work like "static" class members
3. The OpenCode runtime itself is the "daemon"

**Decision:** Module-scope state. Eliminates an entire subsystem (daemon), reduces moving parts.

**Caveat:** If OpenCode reloads modules frequently (e.g., on file change), connections would drop. Testing required. Fallback: minimal daemon if needed.

### 4.3 Why Extract an Engine vs. Direct Imports?

Could import `src/ddp/DDPClient.ts` directly. Why create `src/engine/`?

1. **Explicit API boundary**: What's safe to use outside VS Code
2. **Single import path**: `from "../../src/engine"` vs. multiple deep imports
3. **Future flexibility**: CLI tool, test harness, other integrations
4. **Documentation**: Engine = stable public API

**Decision:** Create engine barrel. Minimal effort, significant clarity.

### 4.4 Why Phase Discovery Separately?

Browser automation (Playwright) is more complex:
- Requires system Chrome/Edge/Brave
- Headless browser process management
- More failure modes (browser crashes, navigation timeouts)

**Decision:** Phase 1 = DDP core (connect/call/subscribe/inspect). Phase 2 = Discovery. Get the basics working first.

---

## 5. Implementation Phases

### Phase 1: Core DDP Tools (MVP)

**Goal:** Connect to Meteor, call methods, manage subscriptions, inspect data.

**Scope:**
- Engine extraction (`src/engine/`)
- OpenCode tools for DDP operations
- Basic skill for inspection workflow

**Deliverables:**

| Step | Description | Files | Effort |
|------|-------------|-------|--------|
| 1.1 | Decouple ToolManager from vscode.CancellationToken | `src/tools/ToolManager.ts` | 15 min |
| 1.2 | Create engine barrel export | `src/engine/index.ts`, `src/engine/types.ts` | 30 min |
| 1.3 | Create OpenCode tool file | `.opencode/tool/swarm-tools.ts` | 2 hr |
| 1.4 | Manual testing in OpenCode | - | 1 hr |
| 1.5 | Create basic skill | `.opencode/skill/swarm-tools-inspect/SKILL.md` | 30 min |

**Tools to implement:**
- `swarm-tools_connect`
- `swarm-tools_disconnect`
- `swarm-tools_status`
- `swarm-tools_call_method`
- `swarm-tools_subscribe`
- `swarm-tools_unsubscribe`
- `swarm-tools_list_collections`
- `swarm-tools_inspect_collection`
- `swarm-tools_tail_events`

### Phase 2: Browser Discovery

**Goal:** Playwright-based API discovery, schema extraction, route enumeration.

**Scope:**
- Discovery tools
- Extended skills for exploration workflow

**Deliverables:**

| Step | Description | Files | Effort |
|------|-------------|-------|--------|
| 2.1 | Add discovery tools | `.opencode/tool/swarm-tools.ts` (extend) | 2 hr |
| 2.2 | Test browser automation | - | 1 hr |
| 2.3 | Create exploration skill | `.opencode/skill/swarm-tools-explore/SKILL.md` | 30 min |

**Tools to implement:**
- `swarm-tools_discovery_start`
- `swarm-tools_discovery_stop`
- `swarm-tools_discovery_status`
- `swarm-tools_get_discovered_api`
- `swarm-tools_discover_schema`
- `swarm-tools_get_routes`
- `swarm-tools_navigate`

### Phase 3: Advanced Features

**Goal:** Parity with VS Code extension, plus OpenCode-specific enhancements.

**Scope:**
- History persistence
- Event filtering
- Schema diffing
- Agent definitions

**Deliverables:**
- Persistent discovery history (file-based)
- Advanced skills for debugging workflows
- Custom agent (`swarm-tools-debugger`)

---

## 6. Tool Specifications

### 6.1 swarm-tools_connect

**Purpose:** Establish DDP WebSocket connection to a Meteor server.

**Arguments:**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| url | string | YES | WebSocket URL (wss://... or ws://...) |
| useSockJs | boolean | NO | Force SockJS framing (auto-detected if omitted) |
| resumeToken | string | NO | Meteor login token for authentication |
| username | string | NO | Username for password auth (requires password) |
| password | string | NO | Password for auth (requires username) |

**Returns:**
```typescript
{
  ok: true,
  data: {
    sessionId: string,      // DDP session ID from server
    connected: true,
    authenticated: boolean, // Whether login succeeded
    userId?: string,        // Meteor user ID if authenticated
  }
}
// OR
{
  ok: false,
  error: { code: string, message: string }
}
```

**Behavior:**
1. Disconnect existing connection if any
2. Create new DDPClient with URL
3. Wait for `connected` DDP message
4. If auth credentials provided, attempt login
5. Start event logging
6. Return connection status

**Error codes:**
- `INVALID_URL`: Malformed WebSocket URL
- `CONNECTION_FAILED`: WebSocket handshake failed
- `DDP_REJECTED`: Server rejected DDP version
- `AUTH_FAILED`: Login method returned error

---

### 6.2 swarm-tools_disconnect

**Purpose:** Close the DDP connection.

**Arguments:** None

**Returns:**
```typescript
{ ok: true, data: { disconnected: true } }
```

**Behavior:**
1. If connected, close WebSocket
2. Clear module state (client, store, events)
3. Always succeeds (idempotent)

---

### 6.3 swarm-tools_status

**Purpose:** Get current connection status and health metrics.

**Arguments:** None

**Returns:**
```typescript
{
  ok: true,
  data: {
    connected: boolean,
    url: string | null,
    sessionId: string | null,
    authenticated: boolean,
    userId: string | null,
    heartbeat: {
      lastPingAt: number | null,
      lastPongAt: number | null,
      rttMs: number | null,
    },
    collections: string[],      // Names of collections with cached data
    activeSubscriptions: number,
    eventCount: number,         // Total events logged
  }
}
```

---

### 6.4 swarm-tools_call_method

**Purpose:** Invoke a Meteor method via DDP.

**Arguments:**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| method | string | YES | Method name |
| params | any[] | NO | Method arguments (default: []) |
| timeoutMs | number | NO | Timeout in milliseconds (default: 30000) |

**Returns:**
```typescript
{
  ok: true,
  data: {
    result: any,  // Method return value
  }
}
// OR
{
  ok: false,
  error: {
    code: "METHOD_ERROR" | "TIMEOUT" | "NOT_CONNECTED",
    message: string,
    details?: {
      meteorError?: { error: string, reason: string, details?: string }
    }
  }
}
```

**Behavior:**
1. Check connection exists
2. Send DDP `method` message
3. Wait for `result` message with matching ID
4. Return result or error

---

### 6.5 swarm-tools_subscribe

**Purpose:** Subscribe to a Meteor publication.

**Arguments:**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| name | string | YES | Publication name |
| params | any[] | NO | Subscription arguments (default: []) |

**Returns:**
```typescript
{
  ok: true,
  data: {
    subId: string,  // Subscription ID for unsubscribe
    name: string,
  }
}
```

**Behavior:**
1. Check connection exists
2. Send DDP `sub` message
3. Return subscription ID immediately (don't wait for ready)
4. Documents will arrive via `added` messages and populate CollectionStore

---

### 6.6 swarm-tools_unsubscribe

**Purpose:** Stop a subscription.

**Arguments:**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| subId | string | YES | Subscription ID from subscribe |

**Returns:**
```typescript
{ ok: true, data: { unsubscribed: true } }
```

---

### 6.7 swarm-tools_list_collections

**Purpose:** List all collections that have cached documents.

**Arguments:** None

**Returns:**
```typescript
{
  ok: true,
  data: {
    collections: Array<{
      name: string,
      documentCount: number,
    }>
  }
}
```

---

### 6.8 swarm-tools_inspect_collection

**Purpose:** Query documents from a cached collection.

**Arguments:**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| collection | string | YES | Collection name |
| limit | number | NO | Max documents to return (default: 10) |
| fields | string[] | NO | Project only these fields |

**Returns:**
```typescript
{
  ok: true,
  data: {
    collection: string,
    count: number,        // Total docs in cache
    returned: number,     // Docs in this response
    documents: object[],
  }
}
```

---

### 6.9 swarm-tools_tail_events

**Purpose:** Get recent DDP traffic events.

**Arguments:**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| limit | number | NO | Max events (default: 50) |
| since | number | NO | Timestamp (ms) - only events after this |
| filter | string | NO | Message type filter (e.g., "method", "added") |

**Returns:**
```typescript
{
  ok: true,
  data: {
    events: Array<{
      timestamp: number,
      direction: "sent" | "received",
      msg: string,        // DDP message type
      method?: string,    // For method calls
      collection?: string,// For added/changed/removed
      id?: string,
      summary: string,    // Human-readable summary
    }>,
    hasMore: boolean,
  }
}
```

---

## 7. Skill Specifications

### 7.1 swarm-tools-inspect Skill

**Location:** `.opencode/skill/swarm-tools-inspect/SKILL.md`

**Purpose:** Guide the agent through inspecting a Meteor application's data layer.

**Content outline:**
```markdown
# swarm-tools-inspect

Inspect a Meteor application via DDP WebSocket.

## When to use
- User wants to explore a Meteor app's data
- Need to understand what collections/methods exist
- Debugging data flow issues

## Workflow

1. **Connect** - Use swarm-tools_connect with the WebSocket URL
2. **Check status** - Verify connection with swarm-tools_status
3. **List collections** - See what data is cached with swarm-tools_list_collections
4. **Inspect data** - Sample documents with swarm-tools_inspect_collection
5. **Call methods** - Test API with swarm-tools_call_method
6. **Monitor** - Watch traffic with swarm-tools_tail_events

## Tips
- Always check swarm-tools_status before operations
- Start with small limits when inspecting large collections
- Use tail_events to see what subscriptions/methods the app uses
```

---

## 8. Testing Strategy

### 8.1 Unit Tests

| Component | Test File | Coverage |
|-----------|-----------|----------|
| DDPClient | `src/ddp/__tests__/DDPClient.test.ts` | Protocol parsing, auth flows |
| CollectionStore | `src/data/__tests__/CollectionStore.test.ts` | CRUD operations |
| Engine exports | `src/engine/__tests__/index.test.ts` | Export availability |

### 8.2 Integration Tests

| Scenario | Description |
|----------|-------------|
| Connect to local Meteor | Spin up test Meteor app, verify connection |
| Method call round-trip | Call method, verify result |
| Subscription data flow | Subscribe, verify documents arrive in store |

### 8.3 OpenCode Tool Tests

Manual testing workflow:
1. Start OpenCode in swarm-tools directory
2. Ask: "Connect to wss://example.com/websocket"
3. Verify: Tool executes, connection established
4. Ask: "What collections are available?"
5. Verify: Tool lists collections from cache

### 8.4 Test Meteor App

For integration testing, use a minimal Meteor app:

```javascript
// server/main.js
Meteor.methods({
  'test.echo': (msg) => msg,
  'test.add': (a, b) => a + b,
});

Meteor.publish('test.items', function() {
  return TestItems.find({});
});
```

---

## 9. Migration & Compatibility

### 9.1 VS Code Extension Unchanged

The VS Code extension continues to work. Engine extraction doesn't break it:
- Extension still imports from `src/ddp/DDPClient.ts` etc.
- Or can switch to `src/engine/` imports (optional)

### 9.2 Shared Codebase

Both VS Code and OpenCode use the same engine:
- Bug fixes benefit both
- Features can be added once
- Single source of truth for DDP protocol handling

### 9.3 No Breaking Changes

This is additive:
- New files: `.opencode/tool/`, `.opencode/skill/`, `src/engine/`
- Modified: `src/tools/ToolManager.ts` (minor - CancellationToken)
- Unchanged: All existing functionality

---

## 10. Open Questions

### 10.1 Module Reload Behavior

**Question:** Does OpenCode reload tool modules on file change? If so, connections would drop.

**Impact:** If yes, need to either:
- Accept reconnection on tool file edit
- Implement minimal daemon after all
- Cache connection params for auto-reconnect

**Action:** Test during Phase 1 implementation.

### 10.2 Secret Storage

**Question:** How should OpenCode tools store/retrieve auth tokens?

**Options:**
1. Require user to pass token every time (annoying)
2. Store in `.opencode/secrets/` (security concern?)
3. Use system keychain via Node.js package
4. Environment variables

**Action:** Research OpenCode's recommended approach; implement in Phase 1.

### 10.3 Discovery Browser Visibility

**Question:** Should Playwright run headless or visible in OpenCode context?

**Consideration:** VS Code extension runs visible browser for user interaction. OpenCode is terminal-based—visible browser may be unexpected.

**Options:**
1. Always headless
2. Configurable via tool argument
3. Environment variable

**Action:** Decide during Phase 2.

### 10.4 Concurrent Connections

**Question:** Should we support multiple simultaneous DDP connections?

**Current scope:** Single connection (MVP).

**Future:** Could use `sessionId` pattern with Map of connections.

**Action:** Defer to post-MVP.

---

## 11. Appendix

### 11.1 Reference: OpenCode Tool API

```typescript
import { tool } from "@opencode-ai/plugin"

export default tool({
  description: "Tool description for LLM",
  args: {
    param: tool.schema.string().describe("Parameter description"),
    optional: tool.schema.number().optional(),
  },
  async execute(args, context) {
    // args: validated arguments
    // context: { agent, sessionID, messageID }
    return "result" // or object, will be JSON-serialized
  },
})

// Multiple tools per file:
export const tool_one = tool({ ... })
export const tool_two = tool({ ... })
// Creates: filename_tool_one, filename_tool_two
```

### 11.2 Reference: DDP Protocol Messages

| Message | Direction | Purpose |
|---------|-----------|---------|
| connect | client->server | Initiate handshake |
| connected | server->client | Handshake complete |
| ping/pong | bidirectional | Keepalive |
| method | client->server | Call server method |
| result | server->client | Method return value |
| sub | client->server | Start subscription |
| ready | server->client | Subscription data sent |
| nosub | server->client | Subscription error |
| unsub | client->server | Stop subscription |
| added | server->client | Document inserted |
| changed | server->client | Document updated |
| removed | server->client | Document deleted |

### 11.3 Reference: File Structure After Implementation

```
swarm-tools/
├── .opencode/
│   ├── tool/
│   │   └── swarm-tools.ts           # OpenCode tools
│   └── skill/
│       └── swarm-tools-inspect/
│           └── SKILL.md        # Inspection workflow
├── src/
│   ├── engine/
│   │   ├── index.ts            # Barrel export
│   │   └── types.ts            # Shared types
│   ├── ddp/
│   │   └── DDPClient.ts        # (unchanged)
│   ├── data/
│   │   └── CollectionStore.ts  # (unchanged)
│   ├── discovery/
│   │   └── DiscoverySession.ts # (unchanged)
│   ├── tools/
│   │   ├── ToolManager.ts      # (minor change: AbortSignal)
│   │   └── impl/               # (unchanged)
│   └── extension.ts            # (unchanged)
├── docs/
│   └── OPENCODE_INTEGRATION_PLAN.md  # This document
└── opencode.json               # (may add tool config)
```

---

## Changelog

| Date | Author | Change |
|------|--------|--------|
| 2026-01-11 | AI + Will | Initial plan |

