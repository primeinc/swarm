/**
 * Core path normalization module for cross-platform path handling.
 * Provides the main `normalize()` function and related utilities for
 * converting paths to a canonical format across Windows, WSL, Git Bash, and POSIX environments.
 * @module normalize
 */

import path from 'node:path';
import type { CanonicalPath, NormalizeOptions, PathInfo, PathEnvironment } from './types.js';
import { detectEnvironment } from './detect.js';
import { isAbsolute, isUNC, isWSLMount, isGitBashMount, hasDriveLetter, isDriveRelative, parseWSLUNC } from './validate.js';

/**
 * Normalize any path to a canonical cross-platform format.
 *
 * This is the primary entry point for path normalization. The canonical format ensures
 * the same physical location always produces the same string representation, regardless
 * of the environment or path style used.
 *
 * **Canonical Format Rules:**
 * - Forward slashes only (`/` instead of `\`)
 * - Lowercase entire path when drive letter present (Windows is case-insensitive)
 * - Lowercase drive letter (`c:` instead of `C:`)
 * - No trailing slash (except for root paths like `c:/` or `/`)
 * - Collapsed multiple slashes (except UNC prefix `//`)
 * - Resolved `.` and `..` segments
 * - WSL mounts converted (`/mnt/c/` becomes `c:/`)
 * - Git Bash mounts converted (`/c/` becomes `c:/`)
 *
 * **Algorithm:**
 * 1. VALIDATE: Throw TypeError if empty/null/undefined
 * 2. DETECT: Determine environment (or use options.env)
 * 3. CONVERT: Replace all `\` with `/`
 * 4. HANDLE WSL: Convert `/mnt/X/` to `X:/`
 * 5. HANDLE Git Bash: Convert `/X/` to `X:/`
 * 6. RESOLVE: Make absolute using path.resolve() with basePath or cwd
 * 7. NORMALIZE: Resolve `.` and `..` segments
 * 8. CASE NORMALIZE: Lowercase for Windows paths, preserve for POSIX
 * 9. STRIP: Remove trailing slash (unless root)
 * 10. RETURN: Cast to CanonicalPath
 *
 * @param inputPath - The path to normalize
 * @param options - Optional normalization options
 * @returns The canonical path representation
 * @throws {TypeError} If inputPath is empty, null, or undefined
 *
 * @example
 * ```ts
 * // Windows paths
 * normalize('C:\\Users\\will\\project');     // -> 'c:/users/will/project'
 * normalize('C:/Users/Will/PROJECT');        // -> 'c:/users/will/project'
 * normalize('D:\\Projects\\');               // -> 'd:/projects'
 *
 * // WSL paths
 * normalize('/mnt/c/Users/will');            // -> 'c:/users/will'
 * normalize('/mnt/d/Projects');              // -> 'd:/projects'
 *
 * // Git Bash paths
 * normalize('/c/Users/will');                // -> 'c:/users/will'
 * normalize('/d/Projects');                  // -> 'd:/projects'
 *
 * // POSIX paths (case preserved)
 * normalize('/home/Will/Project');           // -> '/home/Will/Project'
 * normalize('/etc/Config');                  // -> '/etc/Config'
 *
 * // UNC paths
 * normalize('\\\\server\\share\\path');      // -> '//server/share/path'
 * normalize('//SERVER/Share/PATH');          // -> '//server/share/path'
 *
 * // Relative paths
 * normalize('./src', { basePath: 'c:/project' });   // -> 'c:/project/src'
 * normalize('../lib', { basePath: '/home/will/app' }); // -> '/home/will/lib'
 * ```
 */
export function normalize(inputPath: string, options?: NormalizeOptions): CanonicalPath {
  // Step 1: VALIDATE - throw TypeError if empty/null/undefined/invalid
  if (inputPath === null || inputPath === undefined) {
    throw new TypeError('Path cannot be null or undefined');
  }
  if (typeof inputPath !== 'string') {
    throw new TypeError(`Path must be a string, received ${typeof inputPath}`);
  }
  if (inputPath.length === 0) {
    throw new TypeError('Path cannot be empty');
  }
  // Check for null bytes (security vulnerability - can bypass path checks)
  if (inputPath.includes('\0')) {
    throw new TypeError('Path cannot contain null bytes');
  }

  // Step 2: DETECT environment (or use options.env)
  const env: PathEnvironment = options?.env ?? detectEnvironment();

  // Step 2b: Handle WSL UNC paths (\\wsl.localhost\distro\... or \\wsl$\distro\...)
  // When running on WSL with a matching distro, convert to native WSL path
  const wslUNCInfo = parseWSLUNC(inputPath);
  if (wslUNCInfo) {
    const currentDistro = process.env.WSL_DISTRO_NAME;
    if (env === 'wsl' && currentDistro && wslUNCInfo.distro.toLowerCase() === currentDistro.toLowerCase()) {
      // Convert to native WSL path - this IS a POSIX path, preserve case
      return path.posix.normalize(wslUNCInfo.path) as CanonicalPath;
    }
    // If not on WSL or distro doesn't match, treat as regular UNC path
    // (will be normalized as Windows UNC path below)
  }

  // Step 3: CONVERT to intermediate format - replace all '\' with '/'
  let intermediate = inputPath.replace(/\\/g, '/');

  // Track if this is a UNC path before further processing
  const originalIsUNC = isUNC(intermediate);

  // Step 4: Handle WSL mounts - /mnt/X/ -> X:/
  if (isWSLMount(intermediate)) {
    // Extract drive letter (position 5 in /mnt/X/...)
    const driveLetter = intermediate.charAt(5).toLowerCase();
    // Replace /mnt/X with X:
    intermediate = `${driveLetter}:${intermediate.substring(6)}`;
    // Ensure there's at least a / after the drive letter
    if (intermediate.length === 2) {
      intermediate = `${driveLetter}:/`;
    }
  }
  // Step 5: Handle Git Bash mounts - /X/ -> X:/
  else if (isGitBashMount(intermediate)) {
    // Extract drive letter (position 1 in /X/...)
    const driveLetter = intermediate.charAt(1).toLowerCase();
    // Replace /X with X:
    intermediate = `${driveLetter}:${intermediate.substring(2)}`;
  }

  // Step 6: RESOLVE to absolute using path.resolve() with basePath or cwd
  // Determine if we need to resolve (relative path or drive-relative path)
  const hasWindowsDrive = hasDriveLetter(intermediate);
  const isAbsolutePath = isAbsolute(intermediate);
  const driveRelative = isDriveRelative(intermediate);

  if (!isAbsolutePath && !hasWindowsDrive) {
    // Relative path (no drive letter) - resolve against basePath or cwd
    const basePath = options?.basePath ?? process.cwd();
    // Normalize the basePath first (recursively, but without options to avoid infinite loop)
    const normalizedBase = basePath.replace(/\\/g, '/');

    // Use path.posix.resolve for consistent behavior
    // But we need to handle Windows drive letters specially
    if (hasDriveLetter(normalizedBase)) {
      // Windows-style base path
      const drive = normalizedBase.substring(0, 2);
      const baseRest = normalizedBase.substring(2) || '/';
      const resolved = path.posix.resolve(baseRest, intermediate);
      intermediate = drive + resolved;
    } else {
      // POSIX-style base path
      intermediate = path.posix.resolve(normalizedBase, intermediate);
    }
  } else if (driveRelative) {
    // Drive-relative path (e.g., C:folder) - resolve against basePath if same drive,
    // otherwise resolve against the drive root
    const pathDrive = intermediate.substring(0, 2).toLowerCase();
    const pathRest = intermediate.substring(2);
    const basePath = options?.basePath ?? process.cwd();
    const normalizedBase = basePath.replace(/\\/g, '/');

    if (hasDriveLetter(normalizedBase)) {
      const baseDrive = normalizedBase.substring(0, 2).toLowerCase();
      if (baseDrive === pathDrive) {
        // Same drive - resolve relative to basePath
        const baseRest = normalizedBase.substring(2) || '/';
        const resolved = path.posix.resolve(baseRest, pathRest);
        intermediate = pathDrive + resolved;
      } else {
        // Different drive - resolve relative to drive root
        // (We can't know the CWD of a different drive in a cross-platform way)
        intermediate = pathDrive + '/' + pathRest;
      }
    } else {
      // POSIX basePath with Windows drive-relative path - resolve against drive root
      intermediate = pathDrive + '/' + pathRest;
    }
  }

  // Step 7: NORMALIZE segments with path.posix.normalize()
  // Handle UNC paths specially to preserve the // prefix
  if (originalIsUNC || isUNC(intermediate)) {
    // For UNC paths, preserve the // prefix
    const withoutPrefix = intermediate.substring(2);
    const normalizedRest = path.posix.normalize(withoutPrefix);
    intermediate = '//' + normalizedRest;
  } else if (hasWindowsDrive || hasDriveLetter(intermediate)) {
    // For Windows paths, normalize the part after the drive letter
    const drive = intermediate.substring(0, 2);
    let rest = intermediate.substring(2);
    // Ensure there's a leading slash for normalization
    if (!rest.startsWith('/')) {
      rest = '/' + rest;
    }
    const normalizedRest = path.posix.normalize(rest);
    intermediate = drive + normalizedRest;
  } else {
    // POSIX path
    intermediate = path.posix.normalize(intermediate);
  }

  // Step 8: CASE NORMALIZE
  // - If has drive letter: lowercase ENTIRE path (Windows is case-insensitive)
  // - If UNC path: lowercase entire path (Windows network shares)
  // - If POSIX path (no drive): preserve case (Linux is case-sensitive)
  const finalHasDrive = hasDriveLetter(intermediate);
  const finalIsUNC = isUNC(intermediate);

  if (finalHasDrive || finalIsUNC) {
    // Windows path (drive letter or UNC) - lowercase entire path
    intermediate = intermediate.toLowerCase();

    // Step 8b: STRIP trailing dots and spaces from each segment
    // Windows filesystem automatically strips these, so paths with/without them
    // refer to the same file. We normalize them for consistency.
    // Example: 'c:/folder./sub ' -> 'c:/folder/sub'
    const segments = intermediate.split('/');
    const normalizedSegments = segments.map((segment, index) => {
      // Don't modify the drive letter segment (e.g., 'c:') or empty segments
      if (index === 0 || segment === '') {
        return segment;
      }
      // Strip trailing dots and spaces from segment
      return segment.replace(/[\s.]+$/, '');
    });
    intermediate = normalizedSegments.join('/');
  }
  // POSIX paths: preserve case (no transformation)

  // Step 9: STRIP trailing slash (unless root like 'c:/' or '/')
  if (intermediate.length > 1 && intermediate.endsWith('/')) {
    // Check if this is a root path that should keep its trailing slash
    const isWindowsRoot = finalHasDrive && intermediate.length === 3; // e.g., 'c:/'
    const isPosixRoot = intermediate === '/';
    const isUNCRoot = finalIsUNC && intermediate.split('/').filter(Boolean).length <= 2; // e.g., '//server/share'

    if (!isWindowsRoot && !isPosixRoot && !isUNCRoot) {
      intermediate = intermediate.slice(0, -1);
    }
  }

  // Ensure Windows root paths have trailing slash
  if (finalHasDrive && intermediate.length === 2) {
    intermediate = intermediate + '/';
  }

  // Step 10: RETURN as CanonicalPath
  return intermediate as CanonicalPath;
}

/**
 * Normalize a path specifically for use as a unique project identifier.
 * Handles special cases like "global" and "__global__" which represent
 * the global/system-wide context rather than a specific project path.
 *
 * **Special Values:**
 * - Empty string, undefined, null -> 'global'
 * - 'global' -> 'global'
 * - '__global__' -> 'global'
 *
 * All other values are passed through `normalize()` for standard processing.
 *
 * @param projectPath - The project path to normalize, or a special global identifier
 * @returns The canonical project key
 *
 * @example
 * ```ts
 * // Special global cases
 * normalizeProjectKey();                    // -> 'global'
 * normalizeProjectKey(undefined);           // -> 'global'
 * normalizeProjectKey('');                  // -> 'global'
 * normalizeProjectKey('global');            // -> 'global'
 * normalizeProjectKey('__global__');        // -> 'global'
 *
 * // Normal path normalization
 * normalizeProjectKey('C:\\Projects\\app'); // -> 'c:/projects/app'
 * normalizeProjectKey('/mnt/c/projects');   // -> 'c:/projects'
 * normalizeProjectKey('/home/user/app');    // -> '/home/user/app'
 * ```
 */
export function normalizeProjectKey(projectPath?: string): CanonicalPath {
  // Handle special global cases
  if (
    projectPath === undefined ||
    projectPath === null ||
    projectPath === '' ||
    projectPath === 'global' ||
    projectPath === '__global__'
  ) {
    return 'global' as CanonicalPath;
  }

  // Otherwise, normalize the path normally
  return normalize(projectPath);
}

/**
 * Analyze a path and return detailed information about it.
 * This function provides comprehensive metadata about a path including its
 * canonical form, original input, detected environment, and various characteristics.
 *
 * @param inputPath - The path to analyze
 * @param options - Optional normalization options
 * @returns A PathInfo object containing detailed path analysis
 * @throws {TypeError} If inputPath is empty, null, or undefined
 *
 * @example
 * ```ts
 * // Analyze a UNC path
 * const uncInfo = analyze('\\\\server\\share\\path');
 * // {
 * //   canonical: '//server/share/path',
 * //   original: '\\\\server\\share\\path',
 * //   environment: 'windows',
 * //   isAbsolute: true,
 * //   isUNC: true,
 * //   isWSLMount: false,
 * //   driveLetter: undefined
 * // }
 *
 * // Analyze a WSL mount path
 * const wslInfo = analyze('/mnt/c/Users/will');
 * // {
 * //   canonical: 'c:/users/will',
 * //   original: '/mnt/c/Users/will',
 * //   environment: 'linux',
 * //   isAbsolute: true,
 * //   isUNC: false,
 * //   isWSLMount: true,
 * //   driveLetter: 'c'
 * // }
 *
 * // Analyze a standard Windows path
 * const winInfo = analyze('D:\\Projects\\MyApp');
 * // {
 * //   canonical: 'd:/projects/myapp',
 * //   original: 'D:\\Projects\\MyApp',
 * //   environment: 'windows',
 * //   isAbsolute: true,
 * //   isUNC: false,
 * //   isWSLMount: false,
 * //   driveLetter: 'd'
 * // }
 *
 * // Analyze a POSIX path
 * const posixInfo = analyze('/home/user/project');
 * // {
 * //   canonical: '/home/user/project',
 * //   original: '/home/user/project',
 * //   environment: 'linux',
 * //   isAbsolute: true,
 * //   isUNC: false,
 * //   isWSLMount: false,
 * //   driveLetter: undefined
 * // }
 * ```
 */
export function analyze(inputPath: string, options?: NormalizeOptions): PathInfo {
  // Validate input (normalize will throw if invalid)
  const canonical = normalize(inputPath, options);

  // Determine environment
  const environment: PathEnvironment = options?.env ?? detectEnvironment();

  // Analyze the original input for characteristics
  const normalizedInput = inputPath.replace(/\\/g, '/');

  // Check if original was absolute
  const originalIsAbsolute = isAbsolute(inputPath);

  // Check if original was UNC
  const originalIsUNC = isUNC(inputPath);

  // Check if original was WSL mount
  const originalIsWSLMount = isWSLMount(normalizedInput);

  // Extract drive letter from canonical form
  let driveLetter: string | undefined;
  if (hasDriveLetter(canonical)) {
    driveLetter = canonical.charAt(0).toLowerCase();
  }

  return {
    canonical,
    original: inputPath,
    environment,
    isAbsolute: originalIsAbsolute,
    isUNC: originalIsUNC,
    isWSLMount: originalIsWSLMount,
    driveLetter,
  };
}
