/**
 * Path validation utilities for cross-platform path handling.
 * Provides functions to identify and validate different path formats
 * across Windows, POSIX, UNC, WSL, and Git Bash environments.
 * @module validate
 */

import path from 'node:path';

/**
 * Check if a path is absolute.
 * Handles Windows (C:\, C:/), POSIX (/path), UNC (\\server, //server), and WSL (/mnt/c/) paths.
 *
 * @param inputPath - The path to check
 * @returns True if the path is absolute, false otherwise
 *
 * @example
 * ```ts
 * isAbsolute('C:\\Users\\name'); // true
 * isAbsolute('C:/Users/name');   // true
 * isAbsolute('/home/user');      // true
 * isAbsolute('\\\\server\\share'); // true
 * isAbsolute('//server/share');  // true
 * isAbsolute('/mnt/c/Users');    // true
 * isAbsolute('./relative');      // false
 * isAbsolute('relative/path');   // false
 * ```
 */
export function isAbsolute(inputPath: string): boolean {
  // Check using both Windows and POSIX rules
  // This handles:
  // - Windows: C:\, C:/, \\server, //server
  // - POSIX: /path
  // - UNC: \\server\share, //server/share
  // - WSL: /mnt/c/ (covered by POSIX check)
  return path.win32.isAbsolute(inputPath) || path.posix.isAbsolute(inputPath);
}

/**
 * Check if a path is a UNC (Universal Naming Convention) path.
 * UNC paths start with two slashes followed by a server name.
 *
 * @param inputPath - The path to check
 * @returns True if the path is a UNC path, false otherwise
 *
 * @example
 * ```ts
 * isUNC('\\\\server\\share');    // true
 * isUNC('//server/share');       // true
 * isUNC('\\\\server\\c$\\folder'); // true
 * isUNC('///triple/slash');      // false (not valid UNC)
 * isUNC('C:\\path');             // false
 * isUNC('/unix/path');           // false
 * ```
 */
export function isUNC(inputPath: string): boolean {
  // Normalize backslashes to forward slashes for consistent checking
  const normalized = inputPath.replace(/\\/g, '/');

  // UNC paths start with // but the third character must NOT be /
  // This excludes paths like /// which are not valid UNC
  // Valid UNC requires at least //server/share format (minimum 5 chars: //a/b)
  // But we allow //server format as partial UNC (useful for completion/validation)
  if (normalized.length < 3) {
    return false;
  }

  if (!normalized.startsWith('//')) {
    return false;
  }

  // Third character must not be a slash (excludes /// patterns)
  if (normalized[2] === '/') {
    return false;
  }

  // Must have at least one non-slash character after //
  // This catches edge cases like "//" or "// " (just slashes and spaces)
  const afterPrefix = normalized.substring(2);
  const hasValidServerPart = /^[^\s\/]+/.test(afterPrefix);

  return hasValidServerPart;
}

/**
 * Check if a path is a WSL (Windows Subsystem for Linux) mount path.
 * WSL mount paths follow the pattern /mnt/[drive-letter]/
 *
 * @param inputPath - The path to check
 * @returns True if the path is a WSL mount path, false otherwise
 *
 * @example
 * ```ts
 * isWSLMount('/mnt/c/Users');    // true
 * isWSLMount('/mnt/d/');         // true
 * isWSLMount('/mnt/C/Users');    // true (case insensitive)
 * isWSLMount('/mnt/cd/path');    // false (not a single letter)
 * isWSLMount('/home/user');      // false
 * isWSLMount('C:\\path');        // false
 * ```
 */
export function isWSLMount(inputPath: string): boolean {
  // Pattern: /mnt/[a-z]/ at the start (case insensitive)
  // The drive letter must be followed by / or end of string
  const wslMountPattern = /^\/mnt\/[a-z](\/|$)/i;
  return wslMountPattern.test(inputPath);
}

/**
 * Check if a path is a Git Bash mount path.
 * Git Bash mount paths follow the pattern /[drive-letter]/
 *
 * @param inputPath - The path to check
 * @returns True if the path is a Git Bash mount path, false otherwise
 *
 * @example
 * ```ts
 * isGitBashMount('/c/Users/name');  // true
 * isGitBashMount('/d/Projects');    // true
 * isGitBashMount('/C/Users');       // true (case insensitive)
 * isGitBashMount('/home/user');     // false (not a drive letter pattern)
 * isGitBashMount('/mnt/c/');        // false (WSL pattern, not Git Bash)
 * isGitBashMount('C:\\path');       // false
 * ```
 */
export function isGitBashMount(inputPath: string): boolean {
  // Pattern: /[a-z]/ at the start (single letter followed by /)
  // Must be exactly one letter between the slashes
  const gitBashPattern = /^\/[a-z]\//i;
  return gitBashPattern.test(inputPath);
}

/**
 * Check if a path contains a Windows drive letter.
 * Drive letters follow the pattern [A-Za-z]:
 *
 * @param inputPath - The path to check
 * @returns True if the path starts with a drive letter, false otherwise
 *
 * @example
 * ```ts
 * hasDriveLetter('C:\\Users');      // true
 * hasDriveLetter('D:/Projects');    // true
 * hasDriveLetter('c:relative');     // true
 * hasDriveLetter('/unix/path');     // false
 * hasDriveLetter('//server/share'); // false
 * hasDriveLetter('relative/path');  // false
 * ```
 */
export function hasDriveLetter(inputPath: string): boolean {
  // Pattern: starts with a letter followed by colon
  const driveLetterPattern = /^[A-Za-z]:/;
  return driveLetterPattern.test(inputPath);
}

/**
 * Check if a path is a drive-relative path.
 * Drive-relative paths have a drive letter but no slash after the colon (e.g., C:folder).
 * These are relative to the current directory on the specified drive.
 *
 * @param inputPath - The path to check
 * @returns True if the path is drive-relative, false otherwise
 *
 * @example
 * ```ts
 * isDriveRelative('C:folder');        // true
 * isDriveRelative('C:relative/path'); // true
 * isDriveRelative('C:/absolute');     // false (has slash)
 * isDriveRelative('C:\\absolute');    // false (has backslash)
 * isDriveRelative('/unix/path');      // false
 * isDriveRelative('relative');        // false
 * ```
 */
/**
 * Check if a path is a WSL UNC path (\\wsl.localhost\distro\... or \\wsl$\distro\...).
 * These paths provide Windows access to WSL filesystem.
 *
 * @param inputPath - The path to check
 * @returns Object with isWSLUNC flag and parsed distro/path if match, or null if not a WSL UNC path
 *
 * @example
 * ```ts
 * parseWSLUNC('\\\\wsl.localhost\\Ubuntu\\home\\user');
 * // Returns: { distro: 'Ubuntu', path: '/home/user' }
 *
 * parseWSLUNC('\\\\wsl$\\Ubuntu\\home\\user');
 * // Returns: { distro: 'Ubuntu', path: '/home/user' }
 *
 * parseWSLUNC('\\\\server\\share');
 * // Returns: null (not a WSL UNC path)
 * ```
 */
export function parseWSLUNC(inputPath: string): { distro: string; path: string } | null {
  // Normalize backslashes to forward slashes
  const normalized = inputPath.replace(/\\/g, '/');

  // Match patterns: //wsl.localhost/<distro>/... or //wsl$/<distro>/...
  const wslUNCPattern = /^\/\/(wsl\.localhost|wsl\$)\/([^/]+)(\/.*)?$/i;
  const match = normalized.match(wslUNCPattern);

  if (!match) {
    return null;
  }

  const distro = match[2];
  // Convert the rest of the path to POSIX format, default to root if no path
  const restPath = match[3] || '/';

  return { distro, path: restPath };
}

/**
 * Check if a path is a WSL UNC path.
 *
 * @param inputPath - The path to check
 * @returns True if the path is a WSL UNC path
 */
export function isWSLUNC(inputPath: string): boolean {
  return parseWSLUNC(inputPath) !== null;
}

export function isDriveRelative(inputPath: string): boolean {
  // Pattern: starts with a letter, colon, then NOT a slash
  // Must have at least 3 characters: drive letter, colon, and something else
  if (inputPath.length < 3) {
    return false;
  }
  const hasLetter = /^[A-Za-z]$/.test(inputPath[0]);
  const hasColon = inputPath[1] === ':';
  const notSlash = inputPath[2] !== '/' && inputPath[2] !== '\\';

  return hasLetter && hasColon && notSlash;
}

/**
 * Check if a string is a valid path.
 * Performs basic validity checks: non-empty and no null bytes.
 *
 * @param input - The string to validate
 * @returns True if the string is a valid path, false otherwise
 *
 * @example
 * ```ts
 * isValidPath('/home/user');        // true
 * isValidPath('C:\\Users');         // true
 * isValidPath('relative/path');     // true
 * isValidPath('');                  // false (empty string)
 * isValidPath('path\x00with\x00null'); // false (contains null bytes)
 * ```
 */
export function isValidPath(input: string): boolean {
  // Check for non-empty string
  if (typeof input !== 'string' || input.length === 0) {
    return false;
  }

  // Check for null bytes (not allowed in paths)
  if (input.includes('\0')) {
    return false;
  }

  return true;
}
