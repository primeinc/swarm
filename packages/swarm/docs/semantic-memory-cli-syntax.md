# Semantic Memory CLI Syntax Reference

**CRITICAL: The semantic-memory CLI has specific JSON requirements that will fail silently if violated.**

## Working Syntax

### Store Memory (via Bash)

```bash
semantic-memory store \
  --information "Your learning here with full context" \
  --metadata '{"tags": ["tag1", "tag2", "tag3"]}'
```

**Key Rules:**

- `--metadata` MUST be valid JSON with single quotes wrapping the object
- Use `{"tags": [...]}` structure, NOT comma-separated strings
- Information can be plain text (no quotes needed in bash)

### Store Memory (via MCP tool - PREFERRED)

The MCP tool `semantic-memory_store` has different syntax:

```typescript
semantic-memory_store(
  information: "Your learning here",
  metadata: "tag1, tag2, tag3"  // Comma-separated string, NOT JSON
)
```

**Use the MCP tool when available - it handles JSON serialization for you.**

## Common Mistakes

### ❌ WRONG - Comma-separated string in CLI

```bash
semantic-memory store \
  --metadata "swarm,edge-case,workaround"
# Error: Invalid JSON in --metadata
```

### ❌ WRONG - Double quotes wrapping JSON

```bash
semantic-memory store \
  --metadata "{"tags": ["swarm"]}"
# Error: Shell parsing breaks on nested quotes
```

### ❌ WRONG - No tags wrapper

```bash
semantic-memory store \
  --metadata '["swarm", "edge-case"]'
# Error: Expected object with "tags" key
```

### ✅ CORRECT - JSON object with single quotes

```bash
semantic-memory store \
  --information "swarm_complete fails when files outside project_key" \
  --metadata '{"tags": ["swarm", "edge-case", "workaround"]}'
```

## When to Use Which

| Context                     | Tool                               | Metadata Format                       |
| --------------------------- | ---------------------------------- | ------------------------------------- |
| **Inside OpenCode session** | `semantic-memory_store()` MCP tool | `"tag1, tag2, tag3"` (string)         |
| **Direct CLI / Bash tool**  | `semantic-memory store` command    | `'{"tags": ["tag1", "tag2"]}'` (JSON) |
| **Scripts / automation**    | CLI command                        | JSON object                           |

## Other Commands

### Find Memories

```bash
# CLI
semantic-memory find --query "search terms" --limit 5

# MCP tool (preferred)
semantic-memory_find(query="search terms", limit=5)
```

### Validate Memory (reset decay)

```bash
# CLI
semantic-memory validate --id "mem-uuid"

# MCP tool (preferred)
semantic-memory_validate(id="mem-uuid")
```

### List All

```bash
# CLI
semantic-memory list

# MCP tool (preferred)
semantic-memory_list()
```

## Pro Tips

1. **Prefer MCP tools in OpenCode sessions** - they handle serialization
2. **Use CLI for scripts** - more control, but requires JSON knowledge
3. **Test metadata syntax** - run `semantic-memory list` to verify storage
4. **Keep tags focused** - 3-5 tags max, use domain/tech/pattern structure
5. **Include error messages verbatim** - makes search more effective

## Debugging

If storage fails:

1. Check `--metadata` is valid JSON: `echo '{"tags": ["test"]}' | jq`
2. Verify single quotes wrap the JSON object
3. Ensure no shell escaping issues with information text
4. Try MCP tool instead of CLI if in OpenCode session
