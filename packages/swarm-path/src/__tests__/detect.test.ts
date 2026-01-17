import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import {
  detectEnvironment,
  isWSL,
  isGitBash,
  isCygwin,
  _clearEnvironmentCache,
} from '../detect.js';
import type { PathEnvironment } from '../types.js';

describe('detect', () => {
  describe('detectEnvironment', () => {
    beforeEach(() => {
      _clearEnvironmentCache();
    });

    afterEach(() => {
      _clearEnvironmentCache();
    });

    test('returns a valid PathEnvironment value', () => {
      const env = detectEnvironment();
      const validEnvironments: PathEnvironment[] = [
        'windows',
        'wsl',
        'git-bash',
        'cygwin',
        'linux',
        'darwin',
      ];
      expect(validEnvironments).toContain(env);
    });

    test('returns consistent results (caching)', () => {
      const first = detectEnvironment();
      const second = detectEnvironment();
      expect(first).toBe(second);
    });

    test('returns string type', () => {
      const env = detectEnvironment();
      expect(typeof env).toBe('string');
    });
  });

  describe('isWSL', () => {
    beforeEach(() => {
      _clearEnvironmentCache();
    });

    afterEach(() => {
      _clearEnvironmentCache();
    });

    test('returns a boolean', () => {
      const result = isWSL();
      expect(typeof result).toBe('boolean');
    });

    test('returns true only when environment is wsl', () => {
      const env = detectEnvironment();
      const result = isWSL();
      expect(result).toBe(env === 'wsl');
    });
  });

  describe('isGitBash', () => {
    beforeEach(() => {
      _clearEnvironmentCache();
    });

    afterEach(() => {
      _clearEnvironmentCache();
    });

    test('returns a boolean', () => {
      const result = isGitBash();
      expect(typeof result).toBe('boolean');
    });

    test('returns true only when environment is git-bash', () => {
      const env = detectEnvironment();
      const result = isGitBash();
      expect(result).toBe(env === 'git-bash');
    });
  });

  describe('isCygwin', () => {
    beforeEach(() => {
      _clearEnvironmentCache();
    });

    afterEach(() => {
      _clearEnvironmentCache();
    });

    test('returns a boolean', () => {
      const result = isCygwin();
      expect(typeof result).toBe('boolean');
    });

    test('returns true only when environment is cygwin', () => {
      const env = detectEnvironment();
      const result = isCygwin();
      expect(result).toBe(env === 'cygwin');
    });
  });

  describe('_clearEnvironmentCache', () => {
    test('clears the cached environment', () => {
      // Call detectEnvironment to populate the cache
      detectEnvironment();

      // Clear the cache
      _clearEnvironmentCache();

      // The function should not throw and detection should work again
      const env = detectEnvironment();
      const validEnvironments: PathEnvironment[] = [
        'windows',
        'wsl',
        'git-bash',
        'cygwin',
        'linux',
        'darwin',
      ];
      expect(validEnvironments).toContain(env);
    });

    test('allows re-detection after clearing', () => {
      const first = detectEnvironment();
      _clearEnvironmentCache();
      const second = detectEnvironment();
      // Both should be valid environments (same value since platform hasn't changed)
      expect(first).toBe(second);
    });
  });
});
