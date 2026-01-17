# swarm-cross-path

Cross-platform path normalization for consistent identifiers across Windows, WSL, and Linux environments.

## Installation

```bash
npm install swarm-cross-path
# or
bun add swarm-cross-path
```

## Problem

The same physical directory can be represented in multiple ways:

| Environment | Path |
|-------------|------|
| Windows CMD | `C:\Users\will\project` |
| Windows PowerShell | `C:/Users/will/project` |
| Windows (case) | `C:\USERS\WILL\PROJECT` |
| WSL | `/mnt/c/Users/will/project` |
| Git Bash | `/c/Users/will/project` |

When these paths are used as database keys or cache keys, they create fragmented state.

## Solution

```typescript
import { normalize, normalizeProjectKey } from 'swarm-cross-path';

// All of these produce the same canonical path:
normalize('C:\\Users\\will\\project');      // → 'c:/users/will/project'
normalize('c:/Users/Will/project');         // → 'c:/users/will/project'
normalize('/mnt/c/Users/will/project');     // → 'c:/users/will/project'
normalize('/c/Users/will/project');         // → 'c:/users/will/project'

// For database keys:
normalizeProjectKey('/mnt/c/my-app');       // → 'c:/my-app'
normalizeProjectKey('global');              // → 'global'
normalizeProjectKey();                      // → 'global'
```

## API

### Core Functions

#### `normalize(inputPath, options?): CanonicalPath`

Normalize any path to a canonical cross-platform format.

```typescript
normalize('C:\\Users\\will');              // → 'c:/users/will'
normalize('/mnt/c/Users/will');            // → 'c:/users/will'
normalize('./src', { basePath: '/app' });  // → '/app/src'
```

#### `normalizeProjectKey(projectPath?): CanonicalPath`

Normalize a path for use as a unique project identifier.

```typescript
normalizeProjectKey('/mnt/c/projects/foo'); // → 'c:/projects/foo'
normalizeProjectKey('global');              // → 'global'
normalizeProjectKey();                      // → 'global'
```

#### `analyze(inputPath, options?): PathInfo`

Get detailed information about a path.

```typescript
const info = analyze('C:\\Users\\will');
// {
//   canonical: 'c:/users/will',
//   original: 'C:\\Users\\will',
//   environment: 'windows',
//   isAbsolute: true,
//   isUNC: false,
//   isWSLMount: false,
//   driveLetter: 'c'
// }
```

### Environment Detection

```typescript
import { detectEnvironment, isWSL, isGitBash } from 'swarm-cross-path';

detectEnvironment(); // → 'windows' | 'wsl' | 'git-bash' | 'linux' | 'darwin'
isWSL();            // → true/false
isGitBash();        // → true/false
```

### Path Conversion

```typescript
import { toNative, toWSL, wslToCanonical } from 'swarm-cross-path';

// Convert canonical to platform-native
toNative('c:/users/will');  // Windows: 'C:\Users\will', Linux: 'c:/users/will'

// Convert to WSL format
toWSL('c:/users/will');     // → '/mnt/c/users/will'

// Convert WSL to canonical
wslToCanonical('/mnt/c/Users/will'); // → 'c:/users/will'
```

### Validation

```typescript
import { isAbsolute, isUNC, isWSLMount, hasDriveLetter } from 'swarm-cross-path';

isAbsolute('C:\\Users');        // → true
isAbsolute('./relative');       // → false
isUNC('\\\\server\\share');     // → true
isWSLMount('/mnt/c/path');      // → true
hasDriveLetter('C:/path');      // → true
```

## Canonical Format

A canonical path follows these rules:

1. Forward slashes only (`/`)
2. Lowercase on Windows paths (entire path)
3. No trailing slash (except root)
4. Resolved `.` and `..` segments
5. WSL mounts converted (`/mnt/c/` → `c:/`)
6. Git Bash mounts converted (`/c/` → `c:/`)

## License

MIT
