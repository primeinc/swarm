/**
 * Type definitions for swarm-cross-path
 *
 * This module provides TypeScript types for cross-platform path normalization,
 * ensuring consistent path identifiers across Windows, WSL, and Linux environments.
 */

/**
 * A branded string type representing a canonical path.
 *
 * Canonical paths adhere to the following rules:
 * - Forward slashes only (`/` instead of `\`)
 * - Lowercase on Windows (entire path when drive letter present)
 * - Lowercase drive letter (`c:` instead of `C:`)
 * - No trailing slash (except for root paths like `c:/` or `/`)
 * - Collapsed slashes (no `//` except UNC prefix)
 * - Resolved `.` and `..` segments
 * - WSL mounts converted (`/mnt/c/` becomes `c:/`)
 * - Git Bash mounts converted (`/c/` becomes `c:/`)
 *
 * @example
 * // Windows paths normalized to canonical form:
 * // 'C:\\Users\\will' -> 'c:/users/will'
 * // '/mnt/c/Users/will' -> 'c:/users/will'
 *
 * const canonical: CanonicalPath = normalize('C:\\Users\\will');
 */
export type CanonicalPath = string & { __brand: 'CanonicalPath' };

/**
 * Detected runtime environment for path processing.
 *
 * The environment affects how paths are interpreted and normalized:
 * - `windows`: Native Windows (cmd, PowerShell) - case-insensitive, drive letters
 * - `wsl`: Windows Subsystem for Linux - `/mnt/x/` paths map to Windows drives
 * - `git-bash`: Git Bash / MINGW - `/x/` paths map to Windows drives
 * - `cygwin`: Cygwin environment - similar to Git Bash
 * - `linux`: Native Linux - case-sensitive, no drive letters
 * - `darwin`: macOS - case-insensitive by default, no drive letters
 *
 * @example
 * const env: PathEnvironment = detectEnvironment();
 * if (env === 'wsl') {
 *   // Handle WSL-specific path conversion
 * }
 */
export type PathEnvironment =
  | 'windows'
  | 'wsl'
  | 'git-bash'
  | 'cygwin'
  | 'linux'
  | 'darwin';

/**
 * Options for path normalization operations.
 *
 * @example
 * // Override environment detection
 * normalize(path, { env: 'wsl' });
 *
 * // Resolve relative paths against a specific base
 * normalize('./src', { basePath: '/home/user/project' });
 *
 * // Resolve symlinks to their real paths
 * normalize(path, { resolveSymlinks: true });
 */
export interface NormalizeOptions {
  /**
   * Override automatic environment detection.
   *
   * Use this when you know the environment context differs from the
   * actual runtime environment (e.g., processing paths from a different system).
   */
  env?: PathEnvironment;

  /**
   * Base directory for resolving relative paths.
   *
   * When a relative path is provided, it will be resolved against this base.
   * If not specified, defaults to `process.cwd()`.
   *
   * @default process.cwd()
   *
   * @example
   * normalize('./src', { basePath: 'c:/projects/myapp' })
   * // Returns: 'c:/projects/myapp/src'
   */
  basePath?: string;

  /**
   * Whether to resolve symlinks to their real paths.
   *
   * When true, symbolic links in the path will be resolved to their
   * actual target locations using `fs.realpathSync`.
   *
   * @default false
   *
   * @example
   * // If /home/user/link -> /home/user/actual
   * normalize('/home/user/link/file', { resolveSymlinks: true })
   * // Returns: '/home/user/actual/file'
   */
  resolveSymlinks?: boolean;
}

/**
 * Result of path analysis containing detailed information about a path.
 *
 * This interface provides comprehensive metadata about a path after analysis,
 * including its canonical form, original input, detected environment, and
 * various path characteristics.
 *
 * @example
 * const info: PathInfo = analyze('\\\\server\\share\\path');
 * // info.canonical === '//server/share/path'
 * // info.isUNC === true
 * // info.isAbsolute === true
 *
 * const info2: PathInfo = analyze('/mnt/c/Users/will');
 * // info2.canonical === 'c:/users/will'
 * // info2.isWSLMount === true
 * // info2.driveLetter === 'c'
 */
export interface PathInfo {
  /**
   * The normalized canonical path.
   *
   * This is the same result as calling `normalize()` on the input path.
   */
  canonical: CanonicalPath;

  /**
   * The original input path before normalization.
   *
   * Preserved exactly as provided for reference and debugging.
   */
  original: string;

  /**
   * The detected or specified runtime environment.
   *
   * This indicates which environment's path conventions were used
   * for interpreting the input path.
   */
  environment: PathEnvironment;

  /**
   * Whether the path is absolute.
   *
   * True for paths that start from a root:
   * - Windows: `C:\`, `C:/`, `\\server\share`
   * - POSIX: `/`
   * - WSL: `/mnt/c/`, `/home/`
   * - Git Bash: `/c/`
   */
  isAbsolute: boolean;

  /**
   * Whether the path is a UNC (Universal Naming Convention) path.
   *
   * UNC paths start with `\\` or `//` and reference network shares.
   *
   * @example
   * // These are UNC paths:
   * // '\\\\server\\share\\path'
   * // '//server/share/path'
   * // '\\\\wsl$\\Ubuntu\\home'
   */
  isUNC: boolean;

  /**
   * Whether the path is a WSL mount path.
   *
   * WSL mount paths start with `/mnt/` followed by a drive letter,
   * representing Windows drives accessible from WSL.
   *
   * @example
   * // These are WSL mount paths:
   * // '/mnt/c/Users/will'
   * // '/mnt/d/Projects'
   */
  isWSLMount: boolean;

  /**
   * The Windows drive letter, if present.
   *
   * Extracted and normalized to lowercase. Present for:
   * - Windows paths (`C:\Users` -> `'c'`)
   * - WSL mount paths (`/mnt/c/Users` -> `'c'`)
   * - Git Bash paths (`/c/Users` -> `'c'`)
   *
   * Undefined for paths without a drive letter (e.g., pure Linux paths).
   *
   * @example
   * analyze('C:\\Users').driveLetter    // 'c'
   * analyze('/mnt/d/Projects').driveLetter  // 'd'
   * analyze('/home/user').driveLetter   // undefined
   */
  driveLetter?: string;
}
