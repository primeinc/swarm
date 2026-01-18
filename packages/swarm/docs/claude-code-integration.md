# Claude Code Integration for Swarm

**Status**: Draft - Changes made without approval, pending review

## Summary

This document describes changes made to enable the opencode-swarm-plugin to work with Claude Code instead of (or alongside) OpenCode. Claude plugin agents now include always-on guidance in prompts and compaction resumes, with model-alignment defaults (GPT-5.2-code vs Opus 4.5) and tool-priority rules.

## Problem

The swarm plugin was built for OpenCode's plugin system which uses:
- `@opencode-ai/plugin` for tool definitions
- Async hook functions (`tool.execute.before/after`, `session.compacting`)
- Direct tool injection into the model's tool list

Claude Code uses a different extension model:
- MCP (Model Context Protocol) servers for tools
- Shell command hooks (not async functions)
- Skills (markdown files) for teaching patterns

## Changes Made

### 1. MCP Server (`bin/swarm-mcp-server.ts`)

**NEW FILE** - Creates an MCP server that exposes all swarm tools to Claude Code.

```typescript
// Key parts:
- Uses @modelcontextprotocol/sdk
- Imports allTools from src/index.ts
- Executes tools directly (no CLI spawn)
- Converts Zod schemas to JSON Schema for MCP
```

**Location**: `packages/opencode-swarm-plugin/bin/swarm-mcp-server.ts`

### 2. Skill File (`~/.claude/skills/swarm-coordination/SKILL.md`)

**NEW FILE** - Teaches Claude Code how to use swarm tools.

Contains:
- Core concepts (Hive, Swarm Mail, Cells)
- CLI usage examples (`swarm tool <name> '<json>'`)
- Coordinator and Worker workflow patterns
- When to use/not use swarm

**Location**: `~/.claude/skills/swarm-coordination/SKILL.md`

### 3. Claude Settings (`~/.claude/settings.json`)

**MODIFIED** - Added swarm MCP server config.

```json
// Added to mcpServers:
"swarm": {
  "command": "bun",
  "args": [
    "run",
    "/Users/joel/Code/joelhooks/opencode-swarm-plugin/packages/opencode-swarm-plugin/bin/swarm-mcp-server.ts"
  ]
}
```

### 4. Dependencies

**MODIFIED** `package.json` - Added MCP SDK:
```
@modelcontextprotocol/sdk@1.25.2
```

### 5. Always-On Guidance Skill

**NEW/UPDATED** - Claude plugin coordinator/worker prompts load `always-on-guidance`, and compaction resumes include it too.

Includes:
- Tool priority order (swarm plugin tools → Read/Edit → search → Bash)
- Instruction priority (system → developer → user → AGENTS)
- Model defaults (GPT-5.2-code terse checklists, Opus 4.5 brief rationale)

## What Was NOT Changed

- No changes to existing OpenCode plugin code (`src/index.ts`, `src/plugin.ts`)
- No changes to swarm-mail package
- No changes to tool implementations
- Existing hooks (`bd prime`) preserved

## How to Revert

### Revert MCP Server
```bash
rm packages/opencode-swarm-plugin/bin/swarm-mcp-server.ts
```

### Revert Skill
```bash
rm -rf ~/.claude/skills/swarm-coordination/
```

### Revert Settings
Edit `~/.claude/settings.json` and remove the `"swarm": {...}` block from `mcpServers`.

### Revert Dependencies
```bash
bun remove @modelcontextprotocol/sdk
```

## Alternative Approaches Considered

### 1. CLI-Only (No MCP Server)
- Use `swarm tool <name> '<json>'` via Bash directly
- Pros: No new code, works immediately
- Cons: Less elegant, no native tool integration

### 2. Skill + Bash Wrapper
- Create a skill that teaches Claude to use CLI
- Pros: Simpler, no MCP complexity
- Cons: Every tool call goes through Bash

### 3. Full Port (Not Done)
- Rewrite plugin using Claude Code's native patterns
- Pros: Best integration
- Cons: Significant effort, duplicates code

## Testing

The MCP server compiles and starts:
```bash
timeout 3 bun run bin/swarm-mcp-server.ts
# Output: [swarm-mcp] Server started, ready for Claude Code
```

CLI tools still work:
```bash
swarm tool hive_ready '{}'
# Returns ready tasks
```

## Open Questions

1. **Session ID handling**: Claude Code doesn't pass session ID like OpenCode. Currently using `CLAUDE_SESSION_ID` env var or generated ID.

2. **Compaction hook**: OpenCode's `session.compacting` hook preserves swarm state. Claude Code's `PreCompact` is a shell command - would need a script to replicate this.

3. **Tool context**: Some tools expect OpenCode's context object. The mock context may not cover all cases.

4. **Parallel agent spawning**: OpenCode can spawn subagents. Claude Code's Task tool is similar but may work differently.

## Recommendation

Before activating:
1. Review the MCP server code
2. Decide if you want native MCP integration or CLI-only
3. Test in a fresh Claude Code session

The safest approach is CLI-only (just use `swarm tool` via Bash) until the MCP integration is validated.
