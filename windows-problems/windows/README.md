# Windows Swarm Tools Testing Documentation

**Purpose:** Comprehensive testing and validation of OpenCode Swarm Tools on Windows platform

**Status:** ✅ Active Testing  
**Platform:** Windows 11  
**Node Version:** v22.21.1  
**Last Updated:** 2026-01-13

---

## Overview

This directory contains test documentation, evaluation tools, and results for the OpenCode `swarm-tools` plugin on Windows. The swarm-tools plugin enables multi-agent coordination for parallel task execution, with features like:

- File reservation (preventing edit conflicts)
- Inter-agent messaging (Swarm Mail)
- Progress tracking and reporting
- Database-backed coordination (SQLite)

**Why Windows Testing Matters:** Windows has different behaviors for paths, file locking, and process management compared to Unix systems. This testing ensures production-ready Windows compatibility.

---

## Contents

### 📚 Essential Documentation

| File | Status | Description |
|------|--------|-------------|
| **[BUG-REGISTRY.md](./BUG-REGISTRY.md)** | ✅ COMPLETE | **START HERE** - Comprehensive catalog of 7 platform-specific bugs with root causes and verified workarounds |
| **[../WINDOWS-SWARM-GUIDE.md](../WINDOWS-SWARM-GUIDE.md)** | ✅ COMPLETE | Complete guide for running swarm operations on Windows with best practices and troubleshooting |

### 📄 Test Documents

| File | Status | Coverage | Description |
|------|--------|----------|-------------|
| **01-initialization.md** | ✅ COMPLETE | 4 tools | Core initialization and health checks |
| **02-worktree-isolation.md** | ✅ COMPLETE | 5 tools | Git worktree isolation testing |
| **04-file-reservation.md** | ✅ COMPLETE | 3 tools | File reservation coordination |
| **09-session-management.md** | ✅ COMPLETE | 2 tools | Session handoff and lifecycle |
| **10-grep-fixes.md** | ✅ COMPLETE | Path utils | Windows path normalization |
| **11-review-feedback-investigation.md** | ✅ COMPLETE | Investigation | swarm_review_feedback JSON parsing |
| **hive-testing-report.md** | ✅ COMPLETE | 11 tools | Complete Hive tool suite |

### 🔧 Test Infrastructure

| File | Purpose |
|------|---------|
| **review-system.ts** | Automated test document validation and quality scoring |
| **review-system.test.ts** | Unit tests for review system |
| **test-initialization.ts** | Manual test script for initialization tools |

### 📊 Reports

| File | Description |
|------|-------------|
| **REVIEW-REPORT.md** | Auto-generated quality assessment (created by review-system) |

---

## Quick Start

### Run Test Review System

Evaluate all test documentation and generate quality report:

```bash
# Compile TypeScript
npx tsc tests/windows/review-system.ts --outDir tests/windows --module commonjs --target ES2020 --esModuleInterop --skipLibCheck

# Run review
node tests/windows/review-system.js
```

**Output:**
- Quality scores for each document
- Coverage gap analysis
- Critical issue summary
- Generates `REVIEW-REPORT.md`

### Run Manual Tests

Execute initialization tests to verify swarm tools work:

```bash
# Compile
npx tsc tests/windows/test-initialization.ts --outDir tests/windows --module commonjs --target ES2020 --esModuleInterop --skipLibCheck

# Execute
node tests/windows/test-initialization.js
```

**Output:**
- ✅ PASS/❌ FAIL for each test
- Windows-specific behavior notes
- Known issue warnings

---

## Test Review System

### Purpose

Automated validation of test documentation quality to ensure:
1. **Completeness** - All required sections present
2. **Accuracy** - Examples are verifiable and status markers correct
3. **Coverage** - Core tools are tested
4. **Clarity** - Structure is logical with clear explanations
5. **Windows-Specific** - Platform differences documented

### Quality Metrics

Each document receives scores (0-100) in five categories:

#### 1. Completeness (25% weight)
- Required metadata (platform, node version, date)
- Tools tested list
- Test results
- Windows-specific sections
- Known issues
- Recommendations

#### 2. Accuracy (20% weight)
- Proper status markers (✅ PASS / ❌ FAIL)
- Code examples present
- No placeholder content

#### 3. Coverage (25% weight)
- Core tools tested:
  - `swarmmail_init`
  - `swarm_init`
  - `swarmmail_health`
  - `swarmmail_reserve`
- Additional tool coverage

#### 4. Clarity (15% weight)
- Logical section structure
- Purpose/Why/What explanations
- Code examples
- Clear headings

#### 5. Windows-Specific (15% weight)
- Windows behaviors documented
- Known issues listed
- Recommendations provided
- Path handling discussed

### Scoring Verdicts

| Score Range | Verdict | Meaning |
|-------------|---------|---------|
| 90-100 | 🟢 EXCELLENT | Production-ready documentation |
| 75-89 | 🟢 GOOD | Minor improvements needed |
| 60-74 | 🟡 ACCEPTABLE | Functional but has gaps |
| 40-59 | 🟠 NEEDS_WORK | Significant improvements required |
| 0-39 | 🔴 INSUFFICIENT | Incomplete or unusable |

### Usage Examples

#### Command-Line Usage

```bash
# Review all documents
node tests/windows/review-system.js

# Output:
# 📄 Reviewing: 01-initialization.md
#    Status: PASS
#    Verdict: EXCELLENT
#    Quality Score: 92.5/100
# 
# 📊 SUMMARY
# Verdict: READY
# Avg Quality Score: 92.5/100
# Documents: 1
# Passed: 1 | Failed: 0 | Partial: 0
```

#### Programmatic Usage

```typescript
import { TestReviewer } from './review-system';

const reviewer = new TestReviewer('docs/windows');

// Review single document
const report = reviewer.reviewDocument('docs/windows/01-initialization.md');
console.log(`Quality Score: ${report.metrics.overallScore}`);
console.log(`Verdict: ${report.verdict}`);
console.log(`Gaps: ${report.gaps.length}`);

// Review all documents
const summary = reviewer.reviewAll();
console.log(`Avg Score: ${summary.avgQualityScore}`);
console.log(`Verdict: ${summary.verdict}`);

// Generate markdown report
const markdown = reviewer.generateReport(summary, [report]);
fs.writeFileSync('REVIEW-REPORT.md', markdown);
```

---

## Windows-Specific Considerations

### 🪟 Path Handling

**Issue:** Windows uses backslashes (`\`) vs Unix forward slashes (`/`)

**Best Practice:**
```typescript
import * as path from 'path';

// ✅ GOOD - normalizes to Windows format
const projectPath = path.normalize('C:/Users/will/dev/swarm-tools');
// Result: C:\Users\will\dev\swarm-tools

// ❌ BAD - mixing styles
const badPath = 'C:\\Users/will\\dev/swarm-tools';
```

**Database Storage:** Paths stored in SQLite use Windows backslashes

**Comparison:** Case-insensitive on Windows
```typescript
// These are IDENTICAL on Windows:
'C:\\Users\\Will\\Dev\\swarm-tools'
'C:\\users\\will\\dev\\swarm-tools'
```

### 🪟 Database Locking (CRITICAL)

**Issue:** SQLite is **single-writer** - parallel writes fail with `SQLITE_BUSY`

**Affected Operations:**
- `swarm_complete()`
- `hive_close()`
- `swarmmail_send()` (bulk messages)
- `swarmmail_reserve()`

**Solution:** **Sequential writes only**

```typescript
// ❌ BAD - will fail with SQLITE_BUSY
await Promise.all([
  swarm_complete(bead1),
  hive_close(bead2),
  swarmmail_send(message)
]);

// ✅ GOOD - sequential
await swarm_complete(bead1);
await hive_close(bead2);
await swarmmail_send(message);
```

**Retry Pattern:**
```typescript
async function withRetry(fn: () => Promise<any>, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      if (error.message.includes('SQLITE_BUSY') && i < maxRetries - 1) {
        await new Promise(r => setTimeout(r, 100 * Math.pow(2, i)));
        continue;
      }
      throw error;
    }
  }
}

await withRetry(() => swarm_complete(bead));
```

### 🪟 File Reservations

**Issue:** Windows file locking is more aggressive than Unix

**Behavior:**
- SQLite tracks reservations (not OS file locks)
- Exclusive locks block other agents
- Auto-released by `swarm_complete()` or TTL expiration

**Usage:**
```typescript
// Exclusive write access
await swarmmail_reserve(
  paths: ['src/file.ts'],
  exclusive: true,
  reason: 'Editing file'
);

// Shared read access
await swarmmail_reserve(
  paths: ['src/config.ts'],
  exclusive: false,
  reason: 'Reading for context'
);

// Manual release
await swarmmail_release(paths: ['src/file.ts']);
```

### 🪟 Isolation Modes

#### Reservation Mode (Recommended)
- SQLite-based locks only
- Works on non-git projects
- Simpler path handling
- Agents share same working directory

```typescript
await swarm_init(
  project_path: 'C:\\Users\\will\\dev\\swarm-tools',
  isolation: 'reservation'
);
```

#### Worktree Mode (Advanced)
- Git worktree per agent
- Complete filesystem isolation
- Requires git repository
- More complex path handling

```typescript
await swarm_init(
  project_path: 'C:\\Users\\will\\dev\\swarm-tools',
  isolation: 'worktree'
);
```

**Worktree Paths:**
```
Main:     C:\Users\will\dev\swarm-tools
Worker 1: C:\Users\will\dev\swarm-tools-worktree-task-abc123
Worker 2: C:\Users\will\dev\swarm-tools-worktree-task-def456
```

---

## Coverage Goals

### Phase 1: Core Initialization ✅
- [x] swarmmail_init
- [x] swarm_init
- [x] swarmmail_health
- [x] swarmmail_reserve

### Phase 2: Communication 🚧
- [ ] swarmmail_send
- [ ] swarmmail_inbox
- [ ] swarmmail_read_message
- [ ] swarmmail_ack

### Phase 3: Progress Tracking 🚧
- [ ] swarm_progress
- [ ] swarm_complete
- [ ] swarm_review

### Phase 4: Cell Management 🚧
- [ ] hive_create
- [ ] hive_update
- [ ] hive_close
- [ ] hive_cells

### Phase 5: Advanced Features 🚧
- [ ] swarm_worktree_create
- [ ] swarm_worktree_merge
- [ ] swarm_worktree_cleanup
- [ ] swarm_adversarial_review

---

## Contributing

### Adding a New Test Document

1. **Create markdown file:** `docs/windows/XX-feature-name.md`

2. **Required sections:**
```markdown
# Windows Testing: [Feature Name]

**Platform:** Windows 11  
**Node Version:** vX.X.X  
**Test Date:** YYYY-MM-DD  
**Test Status:** ✅ ALL TESTS PASSED | ❌ TESTS FAILED | 🚧 PARTIAL

---

## Overview
[Brief description]

## Tools Tested
1. ✅ **tool-name** - Description

---

## 1. tool-name - Feature Name

### Purpose
[Why this tool exists]

### Windows Test Results

#### ✅ Test: Test Name
**Status:** PASS

**Command:**
\`\`\`typescript
tool_name(param: "value")
\`\`\`

**Response:**
\`\`\`json
{ "result": "data" }
\`\`\`

### Windows-Specific Behaviors

#### 🪟 Feature Name
- Behavior 1
- Behavior 2

### Known Issues
- Issue description

---

## Summary: Windows Compatibility

### ✅ What Works
| Feature | Status | Notes |
|---------|--------|-------|
| tool | ✅ PASS | Note |

### ⚠️ Known Limitations
1. **Issue Name**
   - **Impact:** Description
   - **Severity:** CRITICAL | HIGH | MEDIUM | LOW

### 🎯 Recommendations
1. **Recommendation Title**
   - Details
```

3. **Run review system:**
```bash
node tests/windows/review-system.js
```

4. **Aim for score ≥75** (GOOD or EXCELLENT verdict)

### Document Quality Checklist

Before submitting a test document, verify:

- [ ] All metadata fields present (Platform, Node Version, Test Date, Status)
- [ ] At least 1 tool tested
- [ ] Each tool has Purpose, Test Results, and Windows-Specific sections
- [ ] Code examples use proper TypeScript/JSON formatting
- [ ] Status markers (✅/❌) match actual results
- [ ] Windows emoji (🪟) marks Windows-specific sections
- [ ] At least 1 known issue or limitation documented
- [ ] Recommendations section present
- [ ] Summary table of what works/doesn't work

---

## Known Issues (Global)

### 1. SQLite Single-Writer Constraint
**Severity:** CRITICAL  
**Impact:** Parallel swarm tool writes will fail  
**Workaround:** Serialize all write operations  
**Status:** By design (SQLite limitation)

### 2. Windows Path MAX_PATH Limit
**Severity:** LOW  
**Impact:** Paths > 260 chars may fail  
**Workaround:** Enable long path support in Windows 10+  
**Status:** Rare occurrence

### 3. File Locking Strictness
**Severity:** LOW  
**Impact:** Windows file handles persist longer than Unix  
**Workaround:** Proper cleanup in `swarm_complete()`  
**Status:** Handled by swarm tools

---

## Resources

### Documentation
- [OpenCode Swarm Tools](https://github.com/OpenCodeProject/swarm-tools)
- [SQLite on Windows](https://www.sqlite.org/windowsshm.html)
- [Node.js Path Module](https://nodejs.org/api/path.html)

### Tools
- **TypeScript:** `npx tsc --version`
- **Node.js:** `node --version`
- **Git:** `git --version`

### Project Links
- Main README: `../../README.md`
- Project AGENTS.md: `../../AGENTS.md`
- OpenCode Config: `../../opencode.json`

---

## License

Same as parent project (swarm-tools).

---

**Maintained by:** OpenCode Swarm Workers  
**Questions?** Open an issue or check the main project docs.
