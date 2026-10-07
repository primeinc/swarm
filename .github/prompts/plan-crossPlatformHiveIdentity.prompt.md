# Cross-Platform Path Normalization Package

## Overview

Create a standalone, production-quality npm package for cross-platform path normalization that ensures consistent path identifiers across Windows, WSL, and Linux environments.

**Package Name**: `@primeinc/cross-path`
**Location**: `packages/cross-path/`
**Purpose**: Normalize file system paths into canonical identifiers for use as database keys, cache keys, or any scenario requiring consistent path identity across platforms.

---

## Problem Statement

The same physical directory can be represented in multiple ways:

| Environment | Path Representation |
|-------------|---------------------|
| Windows CMD | `C:\Users\will\project` |
| Windows PowerShell | `C:/Users/will/project` |
| Windows (uppercase) | `C:\USERS\WILL\PROJECT` |
| WSL | `/mnt/c/Users/will/project` |
| Git Bash | `/c/Users/will/project` |

When these paths are used as database keys (e.g., `project_key` in swarm.db), they create fragmented state - the same project appears as multiple entries.

---

## Design Principles

1. **Zero runtime dependencies** - Use only Node.js built-in `path` module
2. **Deterministic output** - Same physical location always produces same canonical path
3. **Platform-aware** - Detect environment and normalize accordingly
4. **Reversible where possible** - Canonical form can be converted back to native format
5. **Fail-safe** - Invalid inputs throw descriptive errors, never silently corrupt

---

## Package Structure

```
packages/cross-path/
├── src/
│   ├── index.ts              # Public API exports
│   ├── normalize.ts          # Core normalization logic
│   ├── detect.ts             # Environment detection (WSL, Git Bash, etc.)
│   ├── convert.ts            # WSL ↔ Windows path conversion
│   ├── validate.ts           # Path validation utilities
│   └── types.ts              # TypeScript type definitions
├── src/__tests__/
│   ├── normalize.test.ts     # Unit tests for normalization
│   ├── detect.test.ts        # Environment detection tests
│   ├── convert.test.ts       # Conversion tests
│   ├── edge-cases.test.ts    # Edge case coverage
│   └── integration.test.ts   # Cross-platform integration tests
├── package.json
├── tsconfig.json
├── README.md
└── CHANGELOG.md
```

---

## Public API Specification

### Types

```typescript
/** Canonical path format: lowercase, forward slashes, no trailing slash */
export type CanonicalPath = string & { __brand: 'CanonicalPath' };

/** Detected runtime environment */
export type PathEnvironment =
  | 'windows'      // Native Windows (cmd, PowerShell)
  | 'wsl'          // Windows Subsystem for Linux
  | 'git-bash'     // Git Bash / MINGW
  | 'cygwin'       // Cygwin
  | 'linux'        // Native Linux
  | 'darwin';      // macOS

/** Options for normalization */
export interface NormalizeOptions {
  /** Override automatic environment detection */
  env?: PathEnvironment;
  /** Base directory for resolving relative paths (default: process.cwd()) */
  basePath?: string;
  /** Whether to resolve symlinks (default: false) */
  resolveSymlinks?: boolean;
}

/** Result of path analysis */
export interface PathInfo {
  canonical: CanonicalPath;
  original: string;
  environment: PathEnvironment;
  isAbsolute: boolean;
  isUNC: boolean;
  isWSLMount: boolean;
  driveLetter?: string;  // 'c', 'd', etc. (lowercase)
}
```

### Core Functions

```typescript
/**
 * Normalize any path to a canonical cross-platform format.
 * This is the primary entry point for most use cases.
 *
 * @example
 * normalize('C:\\Users\\will\\project')     // → 'c:/users/will/project'
 * normalize('/mnt/c/Users/will/project')    // → 'c:/users/will/project'
 * normalize('./src', { basePath: '/home' }) // → '/home/src'
 */
export function normalize(inputPath: string, options?: NormalizeOptions): CanonicalPath;

/**
 * Normalize a path specifically for use as a unique project identifier.
 * Handles special cases like "global" and "__global__".
 *
 * @example
 * normalizeProjectKey('/mnt/c/projects/foo') // → 'c:/projects/foo'
 * normalizeProjectKey('global')               // → 'global'
 * normalizeProjectKey()                       // → 'global'
 */
export function normalizeProjectKey(projectPath?: string): CanonicalPath;

/**
 * Analyze a path and return detailed information about it.
 *
 * @example
 * analyze('\\\\server\\share\\path')
 * // → { canonical: '//server/share/path', isUNC: true, ... }
 */
export function analyze(inputPath: string, options?: NormalizeOptions): PathInfo;
```

### Environment Detection

```typescript
/**
 * Detect the current runtime environment.
 * Cached after first call for performance.
 *
 * @example
 * detectEnvironment() // → 'wsl' | 'windows' | 'linux' | ...
 */
export function detectEnvironment(): PathEnvironment;

/**
 * Check if running inside WSL.
 */
export function isWSL(): boolean;

/**
 * Check if running inside Git Bash / MINGW.
 */
export function isGitBash(): boolean;
```

### Conversion Functions

```typescript
/**
 * Convert a WSL path to Windows-style canonical path.
 *
 * @example
 * wslToCanonical('/mnt/c/Users/will') // → 'c:/users/will'
 * wslToCanonical('/home/will')        // → '/home/will' (no conversion)
 */
export function wslToCanonical(wslPath: string): CanonicalPath;

/**
 * Convert a canonical path to native format for current platform.
 *
 * @example
 * // On Windows:
 * toNative('c:/users/will') // → 'C:\\Users\\will'
 * // On Linux:
 * toNative('/home/will')    // → '/home/will'
 */
export function toNative(canonicalPath: CanonicalPath): string;

/**
 * Convert a canonical path to WSL format.
 *
 * @example
 * toWSL('c:/users/will') // → '/mnt/c/users/will'
 */
export function toWSL(canonicalPath: CanonicalPath): string;
```

### Validation Functions

```typescript
/**
 * Check if a string is a valid path for the current platform.
 */
export function isValidPath(input: string): boolean;

/**
 * Check if a path is absolute.
 * Handles Windows, POSIX, UNC, and WSL paths.
 */
export function isAbsolute(inputPath: string): boolean;

/**
 * Check if a path is a UNC path (\\server\share or //server/share).
 */
export function isUNC(inputPath: string): boolean;

/**
 * Check if a path is a WSL mount path (/mnt/X/...).
 */
export function isWSLMount(inputPath: string): boolean;
```

---

## Normalization Algorithm

### Canonical Format Definition

A **canonical path** adheres to these rules:

1. **Forward slashes only** - All `\` converted to `/`
2. **Lowercase on Windows** - Entire path lowercased when drive letter present
3. **Lowercase drive letter** - `C:` → `c:`
4. **No trailing slash** - Exception: root paths (`c:/`, `/`)
5. **Collapsed slashes** - `//` → `/` (except UNC prefix)
6. **Resolved segments** - `.` and `..` resolved
7. **Absolute paths** - Relative paths resolved against basePath
8. **WSL mounts converted** - `/mnt/c/` → `c:/`
9. **Git Bash mounts converted** - `/c/` → `c:/`

### Algorithm Pseudocode

```
function normalize(inputPath, options):
    1. VALIDATE input is non-empty string

    2. DETECT environment (or use options.env)

    3. CONVERT to intermediate format:
       - Replace all '\' with '/'
       - If WSL mount (/mnt/X/): extract drive letter, remove /mnt/ prefix
       - If Git Bash (/X/): extract drive letter, convert to X:/

    4. RESOLVE to absolute:
       - If relative: prepend basePath (default: cwd)
       - Use path.posix.resolve() for consistent handling

    5. NORMALIZE segments:
       - Resolve . and ..
       - Collapse multiple slashes (preserve UNC //)

    6. CASE NORMALIZE:
       - If has drive letter (X:/): lowercase entire path
       - If UNC path: lowercase (Windows is case-insensitive)
       - If POSIX path: preserve case (Linux is case-sensitive)

    7. STRIP trailing slash (unless root)

    8. RETURN as CanonicalPath
```

### Environment Detection Algorithm

```
function detectEnvironment():
    if process.platform === 'win32':
        return 'windows'

    if process.platform === 'darwin':
        return 'darwin'

    if process.platform === 'linux':
        if process.env.WSL_DISTRO_NAME OR process.env.WSLENV:
            return 'wsl'
        if process.env.MSYSTEM (contains 'MINGW' or 'MSYS'):
            return 'git-bash'
        if process.env.CYGWIN:
            return 'cygwin'
        return 'linux'

    return 'linux'  # fallback
```

---

## Edge Cases & Test Requirements

### Must-Pass Test Cases

#### Drive Letters
```typescript
// Standard Windows paths
normalize('C:\\Users\\will')           // → 'c:/users/will'
normalize('c:/Users/Will')             // → 'c:/users/will'
normalize('D:\\Projects\\')            // → 'd:/projects'

// Malformed drive letters (missing slash)
normalize('C:Users\\will')             // → 'c:/users/will'
normalize('c:projects')                // → 'c:/projects' (relative to C: cwd)

// All valid drive letters
normalize('Z:\\path')                  // → 'z:/path'
```

#### WSL Paths
```typescript
// Standard WSL mounts
normalize('/mnt/c/Users/will')         // → 'c:/users/will'
normalize('/mnt/d/Projects')           // → 'd:/projects'

// Non-mount WSL paths (Linux native)
normalize('/home/will/project')        // → '/home/will/project' (case preserved)
normalize('/etc/config')               // → '/etc/config'

// Edge: uppercase in /mnt path
normalize('/mnt/C/Users')              // → 'c:/users'
```

#### Git Bash / MINGW Paths
```typescript
normalize('/c/Users/will')             // → 'c:/users/will'
normalize('/d/Projects')               // → 'd:/projects'
```

#### UNC Paths
```typescript
// Server shares
normalize('\\\\server\\share\\path')   // → '//server/share/path'
normalize('//server/share/path')       // → '//server/share/path'

// localhost references
normalize('\\\\localhost\\c$\\Users')  // → '//localhost/c$/users'
normalize('\\\\wsl$\\Ubuntu\\home')    // → '//wsl$/ubuntu/home'

// With authentication
normalize('\\\\user:pass@server\\share') // → '//user:pass@server/share'
```

#### Relative Paths
```typescript
// With explicit basePath
normalize('./src', { basePath: 'c:/project' })     // → 'c:/project/src'
normalize('../lib', { basePath: '/home/will/app' }) // → '/home/will/lib'

// Without basePath (uses cwd)
// If cwd is C:\Users\will:
normalize('.')                         // → 'c:/users/will'
normalize('./project')                 // → 'c:/users/will/project'
```

#### Slash Handling
```typescript
// Multiple slashes
normalize('C:\\\\Users\\\\will')       // → 'c:/users/will'
normalize('c:///users///will')         // → 'c:/users/will'

// Trailing slashes
normalize('c:/users/will/')            // → 'c:/users/will'
normalize('c:/')                       // → 'c:/' (root preserved)
normalize('/')                         // → '/'
```

#### Special Characters
```typescript
// Spaces
normalize('C:\\Program Files\\App')    // → 'c:/program files/app'

// Unicode
normalize('C:\\用户\\文档')             // → 'c:/用户/文档'

// Special but valid characters
normalize('C:\\my-project_v2.0\\src')  // → 'c:/my-project_v2.0/src'
```

#### Error Cases
```typescript
// Empty/null
normalize('')                          // throws TypeError
normalize(null)                        // throws TypeError

// Invalid characters (Windows)
normalize('C:\\path<>|name')           // throws Error (invalid chars)

// Reserved names (Windows)
normalize('C:\\CON\\file')             // ⚠️ Warning or error? (CON is reserved)
```

#### Project Key Special Cases
```typescript
normalizeProjectKey('global')          // → 'global'
normalizeProjectKey('__global__')      // → 'global'
normalizeProjectKey('')                // → 'global'
normalizeProjectKey(undefined)         // → 'global'
normalizeProjectKey()                  // → 'global'
```

---

## Integration with Swarm Tools

### Phase 1: Create Package

1. Create `packages/cross-path/` with structure above
2. Implement core `normalize()` and `normalizeProjectKey()`
3. Add comprehensive test suite
4. Add to workspace in root `package.json`

### Phase 2: Migrate swarm-mail

1. Add `@primeinc/cross-path` as dependency to `swarm-mail`
2. Update `packages/swarm-mail/src/utils/normalize-path.ts`:
   ```typescript
   // Re-export from cross-path for backward compatibility
   export { normalize, normalizeProjectKey } from '@primeinc/cross-path';
   // Deprecated alias
   export const standardizePath = normalize;
   ```
3. Update `packages/swarm-mail/src/libsql.convenience.ts`:
   - Import `normalizeProjectKey` from `@primeinc/cross-path`
   - Apply at entry points: `getSwarmMailLibSQL()`, `closeSwarmMailLibSQL()`
4. Update `packages/swarm-mail/src/index.ts`:
   - Re-export normalization functions

### Phase 3: Migrate opencode-swarm-plugin

1. Add `@primeinc/cross-path` as dependency
2. Remove `packages/opencode-swarm-plugin/src/utils/normalize-path.ts`
3. Update imports in:
   - `packages/opencode-swarm-plugin/src/hive.ts`
   - `packages/opencode-swarm-plugin/src/dashboard.ts`
   - `packages/opencode-swarm-plugin/src/swarm-mail.ts`
   - `packages/opencode-swarm-plugin/src/swarm-worktree.ts`
4. Move/adapt tests from `normalize-path.test.ts` to cross-path package

### Phase 4: Migration CLI

Add command to `swarm` CLI (`packages/opencode-swarm-plugin/bin/swarm.ts`):

```bash
swarm db normalize-keys [--dry-run]
```

Implementation:
1. Query distinct `project_key` values from `events` table
2. Group keys that normalize to the same canonical path
3. Display migration plan (which keys will be merged)
4. With `--dry-run`: show plan only
5. Without flag: UPDATE keys to canonical form

---

## Package Configuration

### package.json

```json
{
  "name": "@primeinc/cross-path",
  "version": "1.0.0",
  "description": "Cross-platform path normalization for consistent identifiers across Windows, WSL, and Linux",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "import": "./dist/index.js",
      "types": "./dist/index.d.ts"
    }
  },
  "files": ["dist", "README.md"],
  "publishConfig": {
    "access": "public",
    "registry": "https://registry.npmjs.org/"
  },
  "repository": {
    "type": "git",
    "url": "https://github.com/primeinc/swarm-tools"
  },
  "keywords": [
    "path",
    "normalize",
    "cross-platform",
    "wsl",
    "windows",
    "linux"
  ],
  "author": "Prime Inc",
  "license": "MIT",
  "scripts": {
    "build": "tsc",
    "test": "bun test src/__tests__/*.test.ts",
    "test:watch": "bun test --watch",
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "@types/node": "^22.19.3",
    "bun-types": "^1.3.4",
    "typescript": "^5.7.2"
  },
  "engines": {
    "node": ">=18.0.0"
  }
}
```

---

## References

### Research Sources

- [Node.js Path Module](https://nodejs.org/api/path.html) - Official documentation for `path.posix` and `path.win32`
- [Cross-Platform Node Guide](https://github.com/ehmicky/cross-platform-node-guide/blob/main/docs/3_filesystem/file_paths.md) - Best practices for file paths
- [Microsoft WSL Case Sensitivity](https://learn.microsoft.com/en-us/windows/wsl/case-sensitivity) - Windows/Linux case handling
- [MySQL lower_case_table_names](https://www.skeema.io/blog/2022/06/07/lower-case-table-names/) - Cross-platform identifier normalization patterns
- [@endevr-io/wsl-path](https://github.com/endevr-io/wsl-path) - Reference implementation for WSL path conversion

### Key Insights from Research

1. **Use `path.posix` for consistent output** - `path.normalize()` is platform-specific
2. **Lowercase entire path on Windows** - Windows FS is case-insensitive; MySQL uses this pattern
3. **WSL detection**: `process.env.WSL_DISTRO_NAME` or `process.env.WSLENV`
4. **Git Bash detection**: `process.env.MSYSTEM` contains 'MINGW'
5. **Zero dependencies is achievable** - Only need Node's built-in `path` module
