/**
 * Environment detection utilities for cross-platform path handling.
 * Provides functions to detect the runtime environment and identify
 * specific environments like WSL, Git Bash, and Cygwin.
 * @module detect
 */

import type { PathEnvironment } from './types.js';

/**
 * Module-level cache for the detected environment.
 * Avoids repeated detection calls for performance.
 */
let cachedEnvironment: PathEnvironment | null = null;

/**
 * Detect the current runtime environment.
 * Results are cached to avoid repeated detection overhead.
 *
 * Detection logic:
 * - Windows (win32 platform) → 'windows'
 * - macOS (darwin platform) → 'darwin'
 * - Linux (linux platform):
 *   - WSL_DISTRO_NAME or WSLENV env vars present → 'wsl'
 *   - MSYSTEM contains 'MINGW' or 'MSYS' → 'git-bash'
 *   - CYGWIN env var present → 'cygwin'
 *   - Otherwise → 'linux'
 *
 * @returns The detected runtime environment
 *
 * @example
 * ```ts
 * const env = detectEnvironment();
 * if (env === 'wsl') {
 *   // Handle WSL-specific path conversion
 * }
 * ```
 */
export function detectEnvironment(): PathEnvironment {
  // Return cached result if available
  if (cachedEnvironment !== null) {
    return cachedEnvironment;
  }

  const platform = process.platform;

  if (platform === 'win32') {
    cachedEnvironment = 'windows';
    return cachedEnvironment;
  }

  if (platform === 'darwin') {
    cachedEnvironment = 'darwin';
    return cachedEnvironment;
  }

  if (platform === 'linux') {
    // Check for WSL environment
    // WSL sets WSL_DISTRO_NAME (WSL 2) or WSLENV (WSL 1/2)
    if (process.env.WSL_DISTRO_NAME || process.env.WSLENV) {
      cachedEnvironment = 'wsl';
      return cachedEnvironment;
    }

    // Check for Git Bash / MINGW / MSYS environment
    // MSYSTEM is set by MSYS2/Git Bash to values like 'MINGW64', 'MINGW32', 'MSYS'
    const msystem = process.env.MSYSTEM;
    if (msystem && (msystem.includes('MINGW') || msystem.includes('MSYS'))) {
      cachedEnvironment = 'git-bash';
      return cachedEnvironment;
    }

    // Check for Cygwin environment
    // CYGWIN env var is typically set in Cygwin environments
    if (process.env.CYGWIN) {
      cachedEnvironment = 'cygwin';
      return cachedEnvironment;
    }

    // Default to standard Linux
    cachedEnvironment = 'linux';
    return cachedEnvironment;
  }

  // Fallback for unknown platforms (treat as Linux)
  cachedEnvironment = 'linux';
  return cachedEnvironment;
}

/**
 * Check if the current environment is WSL (Windows Subsystem for Linux).
 * This is a convenience wrapper around detectEnvironment().
 *
 * @returns True if running in WSL, false otherwise
 *
 * @example
 * ```ts
 * if (isWSL()) {
 *   // Convert Windows paths to /mnt/c/ format
 * }
 * ```
 */
export function isWSL(): boolean {
  return detectEnvironment() === 'wsl';
}

/**
 * Check if the current environment is Git Bash (MINGW/MSYS).
 * This includes Git for Windows, MSYS2, and similar MinGW-based environments.
 *
 * @returns True if running in Git Bash/MINGW/MSYS, false otherwise
 *
 * @example
 * ```ts
 * if (isGitBash()) {
 *   // Convert Windows paths to /c/ format
 * }
 * ```
 */
export function isGitBash(): boolean {
  return detectEnvironment() === 'git-bash';
}

/**
 * Check if the current environment is Cygwin.
 *
 * @returns True if running in Cygwin, false otherwise
 *
 * @example
 * ```ts
 * if (isCygwin()) {
 *   // Handle Cygwin-specific path conversions
 * }
 * ```
 */
export function isCygwin(): boolean {
  return detectEnvironment() === 'cygwin';
}

/**
 * Clear the cached environment detection result.
 * Useful for testing or when environment variables may have changed.
 *
 * @internal
 */
export function _clearEnvironmentCache(): void {
  cachedEnvironment = null;
}
