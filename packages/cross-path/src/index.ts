/**
 * @primeinc/cross-path
 *
 * Cross-platform path normalization for consistent identifiers
 * across Windows, WSL, and Linux environments.
 *
 * @packageDocumentation
 */

// Types
export type {
  CanonicalPath,
  PathEnvironment,
  NormalizeOptions,
  PathInfo,
} from './types.js';

// Core normalization functions
export {
  normalize,
  normalizePaths,
  normalizeProjectKey,
  analyze,
} from './normalize.js';

// Environment detection
export {
  detectEnvironment,
  isWSL,
  isGitBash,
  isCygwin,
} from './detect.js';

// Path conversion utilities
export {
  wslToCanonical,
  toNative,
  toWSL,
  gitBashToCanonical,
} from './convert.js';

// Validation utilities
export {
  isAbsolute,
  isUNC,
  isWSLMount,
  isGitBashMount,
  hasDriveLetter,
  isDriveRelative,
  isWSLUNC,
  parseWSLUNC,
  isValidPath,
} from './validate.js';
