# Claude Code Instructions for swarm-cross-path

## Overview

This package provides cross-platform path normalization. It handles Windows, WSL, Git Bash, and POSIX paths.

## Security-Critical Areas

When reviewing or modifying this package, pay special attention to:

### 1. Input Validation (normalize.ts)
- **Null bytes**: Must be rejected - they can bypass path checks
- **Empty/null inputs**: Must throw TypeError
- **Trailing dots/spaces**: Windows strips these - we must normalize them for consistency

### 2. Path Traversal Prevention
- All `..` segments must be properly resolved
- No path should escape its root after normalization

### 3. Case Normalization
- Windows paths: lowercase entire path (case-insensitive filesystem)
- POSIX paths: preserve case (case-sensitive filesystem)
- Mixing these incorrectly can cause security issues

### 4. Round-trip Consistency
- `wslToCanonical(toWSL(canonical))` must equal `canonical`
- `gitBashToCanonical(normalize(gitBashPath))` must be idempotent

## Adversarial Review Checklist

Before merging any changes to this package, verify:

### Security
- [ ] Null bytes are rejected in all input paths
- [ ] Path traversal attacks are prevented
- [ ] No information disclosure through error messages
- [ ] Type checking is strict (no `any` types)

### Edge Cases
- [ ] Empty string handling
- [ ] Root paths (c:/, /, //server/share/)
- [ ] Drive-relative paths (C:folder)
- [ ] Trailing dots and spaces on Windows
- [ ] UNC paths with minimal components (//a)
- [ ] WSL UNC paths (\\wsl.localhost\distro\path)
- [ ] Very long paths (approaching OS limits)

### Invariants
- [ ] Idempotence: normalize(normalize(x)) === normalize(x)
- [ ] Case consistency: same physical path = same canonical form
- [ ] Slash consistency: no backslashes in canonical form
- [ ] No trailing slashes (except roots)

## Test Coverage Requirements

All PRs must:
1. Run `bun test` and pass all tests
2. Add tests for any new functionality
3. Add edge case tests for any bug fixes
4. Run invariant tests (src/__tests__/invariants.test.ts)

## Common Pitfalls

1. **Forgetting to lowercase Windows paths** - The canonical form must be lowercase
2. **Not handling drive-relative paths** - C:folder is different from C:\folder
3. **UNC root detection** - //server/share is a root, //server/share/path is not
4. **WSL distro matching** - Case-insensitive comparison needed
5. **Trailing slash preservation** - Only for root paths
