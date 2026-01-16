/**
 * Property-based and invariant tests for cross-path.
 * These tests verify that core invariants hold across many random inputs.
 * @module invariants.test
 */

import { describe, it, expect } from 'bun:test';
import { normalize, toWSL, wslToCanonical, gitBashToCanonical, toNative } from '../index.js';
import type { CanonicalPath } from '../types.js';

// Simple random string generator for testing
function randomString(length: number, chars: string): string {
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

// Generate random Windows path
function randomWindowsPath(): string {
  const drive = String.fromCharCode(65 + Math.floor(Math.random() * 26)); // A-Z
  const depth = 1 + Math.floor(Math.random() * 5);
  const segments: string[] = [];
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-';

  for (let i = 0; i < depth; i++) {
    segments.push(randomString(3 + Math.floor(Math.random() * 10), chars));
  }

  const separator = Math.random() > 0.5 ? '\\' : '/';
  return `${drive}:${separator}${segments.join(separator)}`;
}

// Generate random POSIX path
function randomPosixPath(): string {
  const depth = 1 + Math.floor(Math.random() * 5);
  const segments: string[] = [];
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-';

  for (let i = 0; i < depth; i++) {
    segments.push(randomString(3 + Math.floor(Math.random() * 10), chars));
  }

  return '/' + segments.join('/');
}

describe('Property: Idempotence', () => {
  it('normalize(normalize(path)) === normalize(path) for Windows paths', () => {
    for (let i = 0; i < 100; i++) {
      const path = randomWindowsPath();
      const once = normalize(path);
      const twice = normalize(once);
      expect(twice).toBe(once);
    }
  });

  it('normalize(normalize(path)) === normalize(path) for POSIX paths', () => {
    for (let i = 0; i < 100; i++) {
      const path = randomPosixPath();
      const once = normalize(path);
      const twice = normalize(once);
      expect(twice).toBe(once);
    }
  });
});

describe('Property: Case normalization consistency', () => {
  it('Windows paths with different case produce same canonical form', () => {
    for (let i = 0; i < 50; i++) {
      const path = randomWindowsPath();
      const upper = path.toUpperCase();
      const lower = path.toLowerCase();
      const mixed = path;

      const n1 = normalize(upper);
      const n2 = normalize(lower);
      const n3 = normalize(mixed);

      expect(n1).toBe(n2);
      expect(n2).toBe(n3);
    }
  });
});

describe('Property: Slash normalization consistency', () => {
  it('Windows paths with different slash styles produce same canonical form', () => {
    for (let i = 0; i < 50; i++) {
      const path = randomWindowsPath();
      const withBackslash = path.replace(/\//g, '\\');
      const withForwardSlash = path.replace(/\\/g, '/');

      const n1 = normalize(withBackslash);
      const n2 = normalize(withForwardSlash);

      expect(n1).toBe(n2);
    }
  });
});

describe('Property: Canonical form invariants', () => {
  it('canonical paths only contain forward slashes', () => {
    for (let i = 0; i < 100; i++) {
      const path = randomWindowsPath();
      const canonical = normalize(path);
      expect(canonical.includes('\\')).toBe(false);
    }
  });

  it('Windows canonical paths are lowercase', () => {
    for (let i = 0; i < 100; i++) {
      const path = randomWindowsPath();
      const canonical = normalize(path);
      expect(canonical).toBe(canonical.toLowerCase());
    }
  });

  it('canonical paths do not have trailing slashes (except roots)', () => {
    for (let i = 0; i < 100; i++) {
      const path = randomWindowsPath();
      const canonical = normalize(path);
      // Root paths (c:/) are allowed to have trailing slash
      if (canonical.length > 3) {
        expect(canonical.endsWith('/')).toBe(false);
      }
    }
  });
});

describe('Property: Round-trip conversions', () => {
  it('toWSL(wslToCanonical(wslPath)) produces equivalent path', () => {
    // Generate WSL-style paths
    for (let i = 0; i < 50; i++) {
      const drive = String.fromCharCode(97 + Math.floor(Math.random() * 26)); // a-z
      const posixPart = randomPosixPath();
      const wslPath = `/mnt/${drive}${posixPart}`;

      const canonical = wslToCanonical(wslPath);
      const roundTrip = toWSL(canonical);
      const backToCanonical = wslToCanonical(roundTrip);

      expect(backToCanonical).toBe(canonical);
    }
  });

  it('gitBashToCanonical produces valid canonical paths', () => {
    for (let i = 0; i < 50; i++) {
      const drive = String.fromCharCode(97 + Math.floor(Math.random() * 26)); // a-z
      const posixPart = randomPosixPath();
      const gitBashPath = `/${drive}${posixPart}`;

      const canonical = gitBashToCanonical(gitBashPath);

      // Should start with drive letter
      expect(canonical[0]).toMatch(/[a-z]/);
      expect(canonical[1]).toBe(':');
      expect(canonical[2]).toBe('/');
    }
  });
});

describe('Property: toNative produces platform-appropriate paths', () => {
  it('toNative on Windows environment produces backslashes', () => {
    for (let i = 0; i < 50; i++) {
      const path = randomWindowsPath();
      const canonical = normalize(path);
      const native = toNative(canonical);

      // On Windows, should have backslashes (unless POSIX path)
      if (canonical.match(/^[a-z]:/)) {
        expect(native.includes('\\')).toBe(true);
        expect(native.includes('/')).toBe(false);
      }
    }
  });
});

describe('Fuzz: Edge cases and special characters', () => {
  const specialPaths = [
    'C:\\',
    'C:/',
    'C:\\\\',
    'C://',
    'C:\\folder\\',
    'C:/folder/',
    'C:\\.\\folder',
    'C:/./folder',
    'C:\\..\\folder',
    'C:/../folder',
    'C:\\folder\\..',
    'C:/folder/..',
    '\\\\server\\share',
    '//server/share',
    '/mnt/c',
    '/mnt/c/',
    '/mnt/c/folder',
    '/c/folder',
    '/home/user',
    '/',
  ];

  it('handles edge case paths without throwing', () => {
    for (const path of specialPaths) {
      expect(() => normalize(path)).not.toThrow();
    }
  });

  it('edge case paths are idempotent', () => {
    for (const path of specialPaths) {
      const once = normalize(path);
      const twice = normalize(once);
      expect(twice).toBe(once);
    }
  });
});

describe('Fuzz: Invalid inputs are rejected', () => {
  it('rejects null bytes in any position', () => {
    const pathsWithNull = [
      '\x00C:\\folder',
      'C:\x00\\folder',
      'C:\\fol\x00der',
      'C:\\folder\x00',
      '/home/\x00user',
    ];

    for (const path of pathsWithNull) {
      expect(() => normalize(path)).toThrow('Path cannot contain null bytes');
    }
  });

  it('rejects empty and null inputs', () => {
    expect(() => normalize('')).toThrow();
    expect(() => normalize(null as any)).toThrow();
    expect(() => normalize(undefined as any)).toThrow();
  });
});

describe('Invariant: Trailing dots and spaces (Windows)', () => {
  it('trailing dots are stripped from Windows path segments', () => {
    const pathsWithTrailingDots = [
      ['C:\\folder.', 'c:/folder'],
      ['C:\\folder..', 'c:/folder'],
      ['C:\\folder.\\sub.', 'c:/folder/sub'],
      ['C:\\a.\\b.\\c.', 'c:/a/b/c'],
    ];

    for (const [input, expected] of pathsWithTrailingDots) {
      expect(normalize(input)).toBe(expected);
    }
  });

  it('trailing spaces are stripped from Windows path segments', () => {
    const pathsWithTrailingSpaces = [
      ['C:\\folder ', 'c:/folder'],
      ['C:\\folder  ', 'c:/folder'],
      ['C:\\folder \\sub ', 'c:/folder/sub'],
    ];

    for (const [input, expected] of pathsWithTrailingSpaces) {
      expect(normalize(input)).toBe(expected);
    }
  });
});
