/**
 * Tests for path conversion utilities.
 * @module convert.test
 */

import { describe, it, expect } from 'bun:test';
import {
  wslToCanonical,
  toNative,
  toWSL,
  gitBashToCanonical,
} from '../convert.js';
import type { CanonicalPath } from '../types.js';

describe('wslToCanonical', () => {
  describe('WSL mount paths', () => {
    it('should convert /mnt/c/ paths to canonical format', () => {
      expect(wslToCanonical('/mnt/c/Users/will')).toBe('c:/users/will');
      expect(wslToCanonical('/mnt/d/Projects/MyApp')).toBe('d:/projects/myapp');
    });

    it('should handle root drive paths', () => {
      expect(wslToCanonical('/mnt/c')).toBe('c:/');
      expect(wslToCanonical('/mnt/c/')).toBe('c:/');
    });

    it('should lowercase the entire path for Windows mounts', () => {
      expect(wslToCanonical('/mnt/c/Users/WILL/PROJECT')).toBe('c:/users/will/project');
    });

    it('should handle uppercase drive letters', () => {
      expect(wslToCanonical('/mnt/C/Users')).toBe('c:/users');
    });
  });

  describe('Native Linux paths', () => {
    it('should preserve native Linux paths unchanged', () => {
      expect(wslToCanonical('/home/will')).toBe('/home/will');
      expect(wslToCanonical('/usr/local/bin')).toBe('/usr/local/bin');
    });

    it('should preserve case for Linux paths', () => {
      expect(wslToCanonical('/home/Will/Project')).toBe('/home/Will/Project');
    });
  });

  describe('error cases', () => {
    it('should throw for relative paths', () => {
      expect(() => wslToCanonical('./relative/path')).toThrow('Path must be absolute');
      expect(() => wslToCanonical('relative')).toThrow('Path must be absolute');
    });
  });
});

describe('toWSL', () => {
  describe('Windows canonical paths', () => {
    it('should convert Windows paths to WSL mount format', () => {
      expect(toWSL('c:/users/will' as CanonicalPath)).toBe('/mnt/c/users/will');
      expect(toWSL('d:/projects/myapp' as CanonicalPath)).toBe('/mnt/d/projects/myapp');
    });

    it('should handle root drive paths', () => {
      expect(toWSL('c:/' as CanonicalPath)).toBe('/mnt/c');
    });
  });

  describe('POSIX canonical paths', () => {
    it('should preserve POSIX paths unchanged', () => {
      expect(toWSL('/home/will' as CanonicalPath)).toBe('/home/will');
      expect(toWSL('/usr/local/bin' as CanonicalPath)).toBe('/usr/local/bin');
    });
  });
});

describe('gitBashToCanonical', () => {
  describe('Git Bash mount paths', () => {
    it('should convert /c/ paths to canonical format', () => {
      expect(gitBashToCanonical('/c/Users/will')).toBe('c:/users/will');
      expect(gitBashToCanonical('/d/Projects')).toBe('d:/projects');
    });

    it('should handle uppercase drive letters', () => {
      expect(gitBashToCanonical('/C/Users')).toBe('c:/users');
    });
  });

  describe('Native POSIX paths', () => {
    it('should preserve native POSIX paths unchanged', () => {
      expect(gitBashToCanonical('/home/will')).toBe('/home/will');
    });
  });

  describe('error cases', () => {
    it('should throw for relative paths', () => {
      expect(() => gitBashToCanonical('./relative')).toThrow('Path must be absolute');
    });
  });
});

describe('Round-trip conversions', () => {
  describe('WSL round-trip', () => {
    it('should round-trip Windows paths correctly', () => {
      const paths: CanonicalPath[] = [
        'c:/users/will' as CanonicalPath,
        'c:/' as CanonicalPath,
        'd:/projects/myapp/src' as CanonicalPath,
      ];

      for (const canonical of paths) {
        const wslPath = toWSL(canonical);
        const roundTripped = wslToCanonical(wslPath);
        expect(roundTripped).toBe(canonical);
      }
    });

    it('should round-trip root drive paths correctly', () => {
      const canonical = 'c:/' as CanonicalPath;
      const wslPath = toWSL(canonical);
      expect(wslPath).toBe('/mnt/c');
      const roundTripped = wslToCanonical(wslPath);
      expect(roundTripped).toBe(canonical);
    });
  });
});
