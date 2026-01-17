/**
 * Path conversion utilities for cross-platform path handling.
 * Provides bidirectional conversion functions between canonical paths
 * and platform-specific formats (Windows, WSL, Git Bash).
 * @module convert
 */

import type { CanonicalPath } from './types.js';
import { detectEnvironment } from './detect.js';
import {
  isWSLMount,
  isGitBashMount,
  hasDriveLetter,
  isAbsolute,
} from './validate.js';

/**
 * Convert a WSL path to canonical format.
 *
 * Handles two types of WSL paths:
 * - WSL mount paths (/mnt/c/...) are converted to canonical Windows paths (c:/...)
 * - Native Linux paths (/home/...) are preserved as-is
 *
 * @param wslPath - The WSL path to convert (must be absolute)
 * @returns The canonical path representation
 * @throws {Error} If the path is not absolute
 *
 * @example
 * ```ts
 * // WSL mount paths are converted to canonical format
 * wslToCanonical('/mnt/c/Users/will');
 * // Returns: 'c:/users/will' as CanonicalPath
 *
 * wslToCanonical('/mnt/d/Projects/MyApp');
 * // Returns: 'd:/projects/myapp' as CanonicalPath
 *
 * // Native Linux paths are preserved (case-sensitive)
 * wslToCanonical('/home/will');
 * // Returns: '/home/will' as CanonicalPath
 *
 * wslToCanonical('/usr/local/bin');
 * // Returns: '/usr/local/bin' as CanonicalPath
 *
 * // Relative paths throw an error
 * wslToCanonical('./relative/path');
 * // Throws: Error('Path must be absolute: ./relative/path')
 * ```
 */
export function wslToCanonical(wslPath: string): CanonicalPath {
  if (!isAbsolute(wslPath)) {
    throw new Error(`Path must be absolute: ${wslPath}`);
  }

  // Normalize to forward slashes
  let normalized = wslPath.replace(/\\/g, '/');

  // Collapse multiple slashes (except for potential UNC paths)
  normalized = normalized.replace(/\/{2,}/g, '/');

  // Remove trailing slash (except for root)
  if (normalized.length > 1 && normalized.endsWith('/')) {
    normalized = normalized.slice(0, -1);
  }

  // Check if it's a WSL mount path (/mnt/x/...)
  if (isWSLMount(normalized)) {
    // Extract the drive letter (character at index 5)
    const driveLetter = normalized[5].toLowerCase();

    // Get the rest of the path after /mnt/x
    const restOfPath = normalized.slice(6); // After '/mnt/x'

    // Build canonical path: drive letter + ':' + rest of path (lowercased)
    const canonicalPath = `${driveLetter}:${restOfPath.toLowerCase() || '/'}`;

    return canonicalPath as CanonicalPath;
  }

  // Native Linux path - preserve as-is (case-sensitive)
  return normalized as CanonicalPath;
}

/**
 * Convert a canonical path to native format for the current platform.
 *
 * Platform-specific conversions:
 * - Windows: Converts to backslashes with uppercase drive letter (c:/users/will -> C:\Users\will)
 * - Linux/macOS: Returns the path unchanged
 *
 * Note: On Windows, this function restores the path to native Windows format.
 * The drive letter is uppercased and forward slashes are converted to backslashes.
 *
 * @param canonicalPath - The canonical path to convert
 * @returns The native path for the current platform
 *
 * @example
 * ```ts
 * // On Windows:
 * toNative('c:/users/will' as CanonicalPath);
 * // Returns: 'C:\\Users\\will'
 *
 * toNative('d:/projects/myapp/src' as CanonicalPath);
 * // Returns: 'D:\\Projects\\MyApp\\src'
 *
 * // On Linux/macOS:
 * toNative('/home/will' as CanonicalPath);
 * // Returns: '/home/will'
 *
 * toNative('c:/users/will' as CanonicalPath);
 * // Returns: 'c:/users/will' (unchanged on non-Windows)
 * ```
 */
export function toNative(canonicalPath: CanonicalPath): string {
  const env = detectEnvironment();

  if (env === 'windows') {
    // On Windows, convert to native format
    if (hasDriveLetter(canonicalPath)) {
      // Uppercase the drive letter
      const driveLetter = canonicalPath[0].toUpperCase();
      const restOfPath = canonicalPath.slice(1);

      // Convert forward slashes to backslashes
      const nativePath = `${driveLetter}${restOfPath}`.replace(/\//g, '\\');

      return nativePath;
    }

    // UNC paths or other formats - just convert slashes
    return canonicalPath.replace(/\//g, '\\');
  }

  // On Linux/macOS/WSL/Git Bash - return unchanged
  return canonicalPath;
}

/**
 * Convert a canonical path to WSL format.
 *
 * Handles two types of canonical paths:
 * - Windows paths (c:/...) are converted to WSL mount format (/mnt/c/...)
 * - POSIX paths (/home/...) are preserved as-is
 *
 * @param canonicalPath - The canonical path to convert
 * @returns The WSL-formatted path
 *
 * @example
 * ```ts
 * // Windows canonical paths are converted to WSL mount format
 * toWSL('c:/users/will' as CanonicalPath);
 * // Returns: '/mnt/c/users/will'
 *
 * toWSL('d:/projects/myapp' as CanonicalPath);
 * // Returns: '/mnt/d/projects/myapp'
 *
 * // Root drive paths
 * toWSL('c:/' as CanonicalPath);
 * // Returns: '/mnt/c'
 *
 * // POSIX paths are preserved unchanged
 * toWSL('/home/will' as CanonicalPath);
 * // Returns: '/home/will'
 *
 * toWSL('/usr/local/bin' as CanonicalPath);
 * // Returns: '/usr/local/bin'
 * ```
 */
export function toWSL(canonicalPath: CanonicalPath): string {
  // Check if it's a Windows path (has drive letter)
  if (hasDriveLetter(canonicalPath)) {
    // Extract drive letter (already lowercase in canonical form)
    const driveLetter = canonicalPath[0].toLowerCase();

    // Get the rest of the path after the colon
    let restOfPath = canonicalPath.slice(2);

    // Handle root drive case (c:/ -> /mnt/c)
    if (restOfPath === '/' || restOfPath === '') {
      return `/mnt/${driveLetter}`;
    }

    // Build WSL mount path
    return `/mnt/${driveLetter}${restOfPath}`;
  }

  // POSIX path - return unchanged
  return canonicalPath;
}

/**
 * Convert a Git Bash path to canonical format.
 *
 * Handles two types of Git Bash paths:
 * - Git Bash mount paths (/c/...) are converted to canonical Windows paths (c:/...)
 * - Native POSIX paths (/home/...) are preserved as-is
 *
 * @param gitBashPath - The Git Bash path to convert (must be absolute)
 * @returns The canonical path representation
 * @throws {Error} If the path is not absolute
 *
 * @example
 * ```ts
 * // Git Bash mount paths are converted to canonical format
 * gitBashToCanonical('/c/Users/will');
 * // Returns: 'c:/users/will' as CanonicalPath
 *
 * gitBashToCanonical('/d/Projects/MyApp');
 * // Returns: 'd:/projects/myapp' as CanonicalPath
 *
 * // Native POSIX paths are preserved (case-sensitive)
 * gitBashToCanonical('/home/will');
 * // Returns: '/home/will' as CanonicalPath
 *
 * gitBashToCanonical('/usr/local/bin');
 * // Returns: '/usr/local/bin' as CanonicalPath
 *
 * // Relative paths throw an error
 * gitBashToCanonical('./relative/path');
 * // Throws: Error('Path must be absolute: ./relative/path')
 * ```
 */
export function gitBashToCanonical(gitBashPath: string): CanonicalPath {
  if (!isAbsolute(gitBashPath)) {
    throw new Error(`Path must be absolute: ${gitBashPath}`);
  }

  // Normalize to forward slashes
  let normalized = gitBashPath.replace(/\\/g, '/');

  // Collapse multiple slashes (except for potential UNC paths)
  normalized = normalized.replace(/\/{2,}/g, '/');

  // Remove trailing slash (except for root)
  if (normalized.length > 1 && normalized.endsWith('/')) {
    normalized = normalized.slice(0, -1);
  }

  // Check if it's a Git Bash mount path (/x/...)
  if (isGitBashMount(normalized)) {
    // Extract the drive letter (character at index 1)
    const driveLetter = normalized[1].toLowerCase();

    // Get the rest of the path after /x
    const restOfPath = normalized.slice(2); // After '/x'

    // Build canonical path: drive letter + ':' + rest of path (lowercased)
    const canonicalPath = `${driveLetter}:${restOfPath.toLowerCase() || '/'}`;

    return canonicalPath as CanonicalPath;
  }

  // Native POSIX path - preserve as-is (case-sensitive)
  return normalized as CanonicalPath;
}
