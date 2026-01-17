# swarm-cross-path

## 1.1.0

### Minor Changes

- 96aea82: Initial release of swarm-cross-path - cross-platform path normalization

  **Features:**

  - Cross-platform path normalization (Windows, WSL, Git Bash, POSIX)
  - WSL UNC path support (`\\wsl.localhost\distro\path` and `\\wsl$\distro\path`)
  - Drive-relative path handling (`C:folder`)
  - Round-trip conversions between path formats

  **Security:**

  - Null byte validation to prevent path injection attacks
  - Trailing dots/spaces normalization for Windows paths
  - Improved UNC path validation

  **Testing:**

  - 222 tests with 1275 assertions
  - Property-based/fuzz testing for invariants
  - Comprehensive edge case coverage
