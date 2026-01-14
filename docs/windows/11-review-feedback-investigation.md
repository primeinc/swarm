# Investigation: swarm_review_feedback JSON Parsing Issue on Windows

**Date:** 2026-01-14  
**Agent:** investigator-review-feedback  
**Status:** Complete

## Problem Statement

The `swarm_review_feedback` tool fails with "Failed to parse issues JSON" error on Windows, even when passed what appears to be valid JSON. This investigation identifies the root cause and provides working solutions for Windows.

## Tool Location & Implementation

**Source File:**  
`~/.bun/install/global/node_modules/opencode-swarm-plugin/dist/bin/swarm.js` (compiled)  
`~/.bun/install/global/node_modules/opencode-swarm-plugin/dist/index.js` (tool registry)

**Tool Definition:**
```typescript
var swarm_review_feedback = tool2({
  description: "Send review feedback to a worker. Tracks attempts (max 3). Fails task after 3 rejections.",
  args: {
    project_key: string().describe("Project path"),
    task_id: string().describe("Subtask cell ID"),
    worker_id: string().describe("Worker agent name"),
    status: enum(["approved", "needs_changes"]).describe("Review status"),
    summary: string().optional().describe("Review summary"),
    issues: string().optional().describe("JSON array of ReviewIssue objects (for needs_changes)")
  },
  async execute(args, _ctx) {
    let parsedIssues = [];
    if (args.issues) {
      try {
        parsedIssues = JSON.parse(args.issues);
      } catch {
        return JSON.stringify({
          success: false,
          error: "Failed to parse issues JSON"
        }, null, 2);
      }
    }
    // ... rest of implementation
  }
})
```

## Key Findings

### 1. Parameter Type Expectation

The `issues` parameter is defined as:
```typescript
issues: string().optional().describe("JSON array of ReviewIssue objects (for needs_changes)")
```

**Critical:** The tool expects `issues` to be a **STRING containing JSON**, not a JSON object or array directly.

### 2. Parsing Logic

```typescript
if (args.issues) {
  try {
    parsedIssues = JSON.parse(args.issues);
  } catch {
    return JSON.stringify({
      success: false,
      error: "Failed to parse issues JSON"
    }, null, 2);
  }
}
```

The tool:
1. Checks if `issues` parameter is provided
2. Attempts to parse it as JSON using `JSON.parse()`
3. If parsing fails for ANY reason, returns generic error (swallows the actual error)
4. If status is "needs_changes" and parsedIssues.length === 0, requires at least one issue

### 3. Windows Shell Escaping Issues

The problem on Windows typically stems from:

**Problem A: PowerShell String Escaping**
```powershell
# PowerShell treats quotes differently than bash
opencode ... --issues "[]"  # May pass literal "[]" with quotes included
```

**Problem B: CMD.exe Escaping**
```cmd
# CMD has its own escaping rules
opencode ... --issues []  # Brackets have special meaning
```

**Problem C: JSON in Command Line Arguments**
```
# Double-nested quoting issues
--issues "[{\"file\":\"test.ts\"}]"  # Escaping nightmare on Windows
```

## Root Cause Analysis

### Why "Failed to parse issues JSON" Error Occurs

The generic error occurs when:
1. **Windows shell mangles the string** before it reaches the tool
2. **Extra quotes** are included in the string value (e.g., `"\"[]\""`instead of `"[]"`)
3. **Escape sequences** are mishandled between shells
4. **Empty string vs undefined** - passing `--issues ""` vs omitting `--issues`

### What the Tool Actually Receives

When you pass `--issues "[]"` on Windows PowerShell:
- Best case: `args.issues = "[]"` → parses to `[]` ✓
- Common case: `args.issues = "\"[]\""`  → JSON.parse fails ✗
- Worst case: `args.issues = "["`  → truncated ✗

## Working Solutions for Windows

### Solution 1: Omit the Parameter for "approved" Status

**For approval without issues:**
```javascript
// ✓ WORKS - Don't pass issues parameter at all
swarm_review_feedback({
  project_key: "C:\\Users\\will\\dev\\swarm-tools",
  task_id: "epic-123.task-456",
  worker_id: "worker-1",
  status: "approved",
  summary: "Looks good!"
  // issues: <omitted> - tool handles undefined correctly
})
```

The tool checks `if (args.issues)` - if the parameter is undefined/omitted, it skips parsing entirely and uses `parsedIssues = []`.

### Solution 2: Use Empty String (Not Recommended but Works)

```javascript
// ✓ WORKS on Windows - but semantically wrong
swarm_review_feedback({
  status: "approved",
  issues: ""  // Empty string → if check fails → parsedIssues stays []
  // ...
})
```

**Why this works:** JavaScript's `if (args.issues)` treats empty string as falsy, skipping the parse attempt.

**Warning:** This is fragile - if the tool implementation changes to explicitly check for undefined, this will break.

### Solution 3: Pass Valid JSON String (For needs_changes)

**When you DO need to pass issues:**
```javascript
swarm_review_feedback({
  status: "needs_changes",
  issues: JSON.stringify([
    {
      file: "src/test.ts",
      line: 42,
      severity: "error",
      message: "Type error: Expected string, got number"
    }
  ])
  // ...
})
```

**In MCP tool call context:**
```json
{
  "status": "needs_changes",
  "issues": "[{\"file\":\"src/test.ts\",\"line\":42,\"severity\":\"error\",\"message\":\"Type error\"}]"
}
```

### Solution 4: PowerShell-Specific Escaping (CLI usage)

**If calling from PowerShell command line:**
```powershell
# Use single quotes to prevent PowerShell interpolation
opencode swarm review-feedback --issues '[]'

# Or escape double quotes
opencode swarm review-feedback --issues "[]"

# For complex JSON, use here-string
$issues = @'
[]
'@
opencode swarm review-feedback --issues $issues
```

## Validation Rules

The tool enforces:
```typescript
if (args.status === "needs_changes" && parsedIssues.length === 0) {
  return JSON.stringify({
    success: false,
    error: "needs_changes status requires at least one issue"
  }, null, 2);
}
```

**Implication:**
- `status: "approved"` + empty/omitted issues → ✓ Valid
- `status: "needs_changes"` + empty array → ✗ Error
- `status: "needs_changes"` + array with items → ✓ Valid

## Recommendations

### For Tool Users (Windows)

1. **For approval:** Omit the `issues` parameter entirely
2. **For rejection:** Pass a properly stringified JSON array with at least one issue object
3. **Avoid:** Passing empty arrays or empty strings explicitly
4. **Testing:** Use Node.js REPL to validate your JSON string parses correctly:
   ```javascript
   JSON.parse('[{"file":"test.ts","severity":"error","message":"test"}]')
   ```

### For Tool Developers (Future Enhancement)

1. **Better error messages:** Log the actual parse error instead of swallowing it
   ```typescript
   } catch (error) {
     return JSON.stringify({
       success: false,
       error: `Failed to parse issues JSON: ${error.message}`,
       received: args.issues
     }, null, 2);
   }
   ```

2. **Accept both string and object:**
   ```typescript
   let parsedIssues = [];
   if (args.issues) {
     if (typeof args.issues === 'string') {
       parsedIssues = JSON.parse(args.issues);
     } else if (Array.isArray(args.issues)) {
       parsedIssues = args.issues;
     }
   }
   ```

3. **Explicit undefined check:**
   ```typescript
   if (args.issues !== undefined && args.issues !== null) {
     // parse
   }
   ```

## Test Cases

### Passing Tests
```javascript
// Test 1: Approved with omitted issues
{ status: "approved", issues: undefined } → ✓

// Test 2: Approved with properly omitted parameter in MCP call
{ status: "approved" } → ✓ (issues key not present)

// Test 3: Needs changes with valid issue
{ 
  status: "needs_changes",
  issues: '[{"file":"test.ts","severity":"error","message":"test"}]'
} → ✓

// Test 4: Empty string treated as falsy
{ status: "approved", issues: "" } → ✓ (works but bad practice)
```

### Failing Tests
```javascript
// Test 1: Needs changes with empty array
{ status: "needs_changes", issues: "[]" } 
→ ✗ "needs_changes status requires at least one issue"

// Test 2: Malformed JSON
{ status: "approved", issues: "[" }
→ ✗ "Failed to parse issues JSON"

// Test 3: Double-escaped quotes
{ status: "approved", issues: "\"[]\"" }
→ ✗ "Failed to parse issues JSON"
```

## Windows-Specific Gotchas

### PowerShell
- Backtick `` ` `` is escape character, not backslash `\`
- Single quotes `'` prevent variable expansion
- Double quotes `"` allow variable expansion
- Arrays use `@()` syntax, not `[]`

### CMD.exe
- Caret `^` is escape character
- No single-quote string literals
- Quotes nest differently than Unix shells

### Git Bash (MINGW)
- Generally works like Unix bash
- Path translation can cause issues (C:\\ vs /c/)

## Conclusion

The `swarm_review_feedback` tool expects:
- **Parameter type:** String containing JSON (not a JSON object)
- **For approval:** Best practice is to omit `issues` parameter entirely
- **For rejection:** Pass stringified JSON array with at least one issue object
- **Windows workaround:** Omitting the parameter avoids all shell escaping issues

**Recommended Pattern for Windows:**
```typescript
// Approval (no issues)
await swarm_review_feedback({
  project_key: projectPath,
  task_id: beadId,
  worker_id: workerName,
  status: "approved",
  summary: "All checks passed"
  // Do NOT include issues parameter
});

// Rejection (with issues)
await swarm_review_feedback({
  project_key: projectPath,
  task_id: beadId,
  worker_id: workerName,
  status: "needs_changes",
  summary: "Found type errors",
  issues: JSON.stringify([
    { file: "src/foo.ts", severity: "error", message: "Type mismatch" }
  ])
});
```

---

**Investigation Complete**  
For questions or issues, reference this document when debugging swarm_review_feedback errors on Windows.
