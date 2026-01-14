/**
 * Cross-platform path normalization utilities
 * 
 * WHY THIS EXISTS:
 * Windows paths can have malformed drive letters (e.g., 'C:Users' instead of 'C:/Users')
 * which cause "file not found" errors. This module provides reliable normalization
 * for grep operations, file searches, and other path-based operations on Windows.
 * 
 * @see https://github.com/OpenCodeProject - Window path handling patterns
 */

/**
 * Normalize a file path for cross-platform compatibility
 * 
 * Handles:
 * - Backslash to forward slash conversion
 * - Drive letter normalization (C:Users -> C:/Users)
 * - UNC path preservation (//server/share)
 * - Multiple slash collapsing
 * 
 * @param inputPath - The path to normalize
 * @returns Normalized path with forward slashes and proper drive letter format
 * 
 * @example
 * ```typescript
 * normalizePath('C:\\Users\\will\\dev') // => 'C:/Users/will/dev'
 * normalizePath('C:Userswill')          // => 'C:/Userswill'  (fixes missing slash)
 * normalizePath('\\\\server\\share')    // => '//server/share' (UNC preserved)
 * normalizePath('//server/share/path')  // => '//server/share/path' (UNC preserved)
 * normalizePath('///path/to/file')      // => '/path/to/file' (triple slash normalized)
 * ```
 */
export function normalizePath(inputPath: string): string {
    if (!inputPath) {
        return '';
    }

    // Step 1: Convert backslashes to forward slashes
    let normalized = convertBackslashes(inputPath);

    // Step 2: Fix drive letter format (C:Users -> C:/Users)
    // CRITICAL: Must happen BEFORE collapsing slashes
    normalized = sanitizeDriveLetter(normalized);

    // Step 3: Collapse multiple slashes (but preserve UNC paths)
    normalized = removeDoubleSlashes(normalized);

    return normalized;
}

/**
 * Convert all backslashes to forward slashes
 * @internal
 */
function convertBackslashes(path: string): string {
    return path.replace(/\\/g, '/');
}

/**
 * Ensure drive letters have a trailing slash
 * Fixes: C:Users -> C:/Users
 * @internal
 */
function sanitizeDriveLetter(path: string): string {
    // Match drive letter followed by non-slash or end of string
    // Examples: C:Users, D:path, E:
    return path.replace(/^([A-Za-z]:)(?=[^/]|$)/, '$1/');
}

/**
 * Collapse multiple slashes to single slash
 * BUT preserve UNC paths (//server/share)
 * @internal
 */
function removeDoubleSlashes(path: string): string {
    // Check if this is a UNC path (starts with // but not ///)
    const isUncPath = path.startsWith('//') && path[2] !== '/';

    if (isUncPath) {
        // For UNC paths: preserve leading //, collapse rest
        // //server//share///path -> //server/share/path
        return '//' + path.slice(2).replace(/\/+/g, '/');
    } else {
        // For regular paths: collapse all multiple slashes
        // C://Users///will -> C:/Users/will
        // ///path/to/file -> /path/to/file
        return path.replace(/\/+/g, '/');
    }
}

/**
 * Check if a path is a UNC path
 * 
 * UNC paths start with \\\\ (Windows) or // (normalized)
 * Examples: \\\\server\\share, //server/share
 * 
 * @param path - The path to check
 * @returns true if the path is a UNC path
 * 
 * @example
 * ```typescript
 * isUncPath('\\\\server\\share')  // => true
 * isUncPath('//server/share')     // => true
 * isUncPath('C:\\Users\\will')    // => false
 * isUncPath('///path')            // => false (triple slash is not UNC)
 * ```
 */
export function isUncPath(path: string): boolean {
    const normalized = convertBackslashes(path);
    return normalized.startsWith('//') && normalized[2] !== '/';
}

/**
 * Normalize paths in grep patterns for Windows compatibility
 * 
 * This is specifically for grep operations where paths might be embedded
 * in patterns or used as file filters.
 * 
 * @param pattern - The grep pattern or file glob
 * @returns Normalized pattern safe for Windows
 * 
 * @example
 * ```typescript
 * normalizeGrepPattern('src\\**\\*.ts')     // => 'src/**\/*.ts'
 * normalizeGrepPattern('C:\\project\\src')  // => 'C:/project/src'
 * ```
 */
export function normalizeGrepPattern(pattern: string): string {
    // For grep patterns, we just need backslash -> forward slash conversion
    // Don't mess with drive letters in patterns since they're rare
    return convertBackslashes(pattern);
}

/**
 * Normalize an array of paths
 * Convenience function for batch operations
 * 
 * @param paths - Array of paths to normalize
 * @returns Array of normalized paths
 */
export function normalizePaths(paths: string[]): string[] {
    return paths.map(normalizePath);
}
