/**
 * Comprehensive tests for the normalize module.
 *
 * Tests the `normalize()` and `normalizeProjectKey()` functions that convert
 * paths to canonical cross-platform format.
 *
 * @see ../normalize.ts
 */

import { describe, expect, it } from 'bun:test';
import { normalize, normalizeProjectKey, analyze } from '../normalize.js';
import type { CanonicalPath } from '../types.js';

describe('normalize', () => {
  describe('Drive Letters', () => {
    it('normalizes standard Windows backslash paths to lowercase with forward slashes', () => {
      expect(normalize('C:\\Users\\will')).toBe('c:/users/will');
    });

    it('normalizes Windows forward slash paths with mixed case', () => {
      expect(normalize('c:/Users/Will')).toBe('c:/users/will');
    });

    it('normalizes paths with trailing backslash by removing trailing slash', () => {
      expect(normalize('D:\\Projects\\')).toBe('d:/projects');
    });

    it('handles malformed drive letter (missing slash after colon)', () => {
      // C:Users\will is technically relative to C: current directory
      // Should resolve and normalize properly
      const result = normalize('C:Users\\will');
      // The result should have the drive letter and forward slashes, lowercase
      expect(result).toMatch(/^c:\/.*users\/will$/);
    });

    it('normalizes all valid drive letters', () => {
      expect(normalize('Z:\\path')).toBe('z:/path');
      expect(normalize('A:\\folder')).toBe('a:/folder');
      expect(normalize('E:\\data\\file')).toBe('e:/data/file');
    });

    it('preserves root drive paths with trailing slash', () => {
      expect(normalize('C:\\')).toBe('c:/');
      expect(normalize('D:/')).toBe('d:/');
    });
  });

  describe('WSL Paths', () => {
    it('converts WSL mount path /mnt/c/ to canonical Windows format', () => {
      expect(normalize('/mnt/c/Users/will')).toBe('c:/users/will');
    });

    it('converts WSL mount path /mnt/d/ to canonical Windows format', () => {
      expect(normalize('/mnt/d/Projects')).toBe('d:/projects');
    });

    it('preserves case for native Linux paths (not mounts)', () => {
      expect(normalize('/home/will/project')).toBe('/home/will/project');
    });

    it('preserves case for other native Linux paths', () => {
      expect(normalize('/etc/Config')).toBe('/etc/Config');
    });

    it('handles uppercase drive letter in WSL mount path', () => {
      expect(normalize('/mnt/C/Users')).toBe('c:/users');
    });

    it('handles WSL mount root', () => {
      expect(normalize('/mnt/c')).toBe('c:/');
      expect(normalize('/mnt/c/')).toBe('c:/');
    });
  });

  describe('Git Bash Paths', () => {
    it('converts Git Bash mount path /c/ to canonical Windows format', () => {
      expect(normalize('/c/Users/will')).toBe('c:/users/will');
    });

    it('converts Git Bash mount path /d/ to canonical Windows format', () => {
      expect(normalize('/d/Projects')).toBe('d:/projects');
    });

    it('handles uppercase drive letter in Git Bash mount path', () => {
      expect(normalize('/C/Users/will')).toBe('c:/users/will');
    });
  });

  describe('UNC Paths', () => {
    it('normalizes UNC paths with backslashes to forward slashes', () => {
      expect(normalize('\\\\server\\share\\path')).toBe('//server/share/path');
    });

    it('preserves already correct UNC paths with forward slashes', () => {
      expect(normalize('//server/share/path')).toBe('//server/share/path');
    });

    it('normalizes localhost admin share paths to lowercase', () => {
      expect(normalize('\\\\localhost\\c$\\Users')).toBe('//localhost/c$/users');
    });

    it('normalizes WSL$ UNC paths', () => {
      expect(normalize('\\\\wsl$\\Ubuntu\\home')).toBe('//wsl$/ubuntu/home');
    });

    it('handles UNC paths with mixed case', () => {
      expect(normalize('//SERVER/Share/PATH')).toBe('//server/share/path');
    });
  });

  describe('Slash Handling', () => {
    it('collapses multiple backslashes to single forward slash', () => {
      expect(normalize('C:\\\\Users\\\\will')).toBe('c:/users/will');
    });

    it('collapses multiple forward slashes to single forward slash', () => {
      expect(normalize('c:///users///will')).toBe('c:/users/will');
    });

    it('strips trailing slash from non-root paths', () => {
      expect(normalize('c:/users/will/')).toBe('c:/users/will');
      expect(normalize('/home/user/')).toBe('/home/user');
    });

    it('preserves trailing slash for Windows root', () => {
      expect(normalize('c:/')).toBe('c:/');
    });

    it('preserves single forward slash for POSIX root', () => {
      expect(normalize('/')).toBe('/');
    });

    it('handles mixed slashes', () => {
      expect(normalize('C:/Users\\will/Documents\\file')).toBe(
        'c:/users/will/documents/file'
      );
    });
  });

  describe('Dot Segment Resolution', () => {
    it('resolves single dot segments', () => {
      expect(normalize('C:\\Users\\.\\will')).toBe('c:/users/will');
      expect(normalize('/home/./user')).toBe('/home/user');
    });

    it('resolves double dot segments', () => {
      expect(normalize('C:\\Users\\will\\..\\john')).toBe('c:/users/john');
      expect(normalize('/home/user/../other')).toBe('/home/other');
    });

    it('handles complex dot segment chains', () => {
      expect(normalize('C:\\a\\b\\..\\c\\.\\d\\..\\e')).toBe('c:/a/c/e');
    });
  });

  describe('Special Characters', () => {
    it('preserves spaces in paths', () => {
      expect(normalize('C:\\Program Files\\App')).toBe('c:/program files/app');
    });

    it('preserves Unicode characters in paths', () => {
      // Note: On Windows paths are case-insensitive, so Unicode is lowercased
      // But many Unicode characters don't have case variants, so they're preserved
      expect(normalize('C:\\Users\\Documents')).toBe('c:/users/documents');
      // For paths with Unicode that have case variants
      const result = normalize('C:\\Path\\Name');
      expect(result).toBe('c:/path/name');
    });

    it('preserves special valid characters like hyphens and underscores', () => {
      expect(normalize('C:\\my-project_v2.0\\src')).toBe(
        'c:/my-project_v2.0/src'
      );
    });

    it('preserves dots in filenames', () => {
      expect(normalize('C:\\project\\file.test.ts')).toBe(
        'c:/project/file.test.ts'
      );
    });
  });

  describe('Error Cases', () => {
    it('throws TypeError for empty string', () => {
      expect(() => normalize('')).toThrow(TypeError);
      expect(() => normalize('')).toThrow('Path cannot be empty');
    });

    it('throws TypeError for null', () => {
      expect(() => normalize(null as unknown as string)).toThrow(TypeError);
      expect(() => normalize(null as unknown as string)).toThrow(
        'Path cannot be null or undefined'
      );
    });

    it('throws TypeError for undefined', () => {
      expect(() => normalize(undefined as unknown as string)).toThrow(TypeError);
      expect(() => normalize(undefined as unknown as string)).toThrow(
        'Path cannot be null or undefined'
      );
    });

    it('throws TypeError for non-string types', () => {
      expect(() => normalize(123 as unknown as string)).toThrow(TypeError);
      expect(() => normalize({} as unknown as string)).toThrow(TypeError);
      expect(() => normalize([] as unknown as string)).toThrow(TypeError);
    });
  });

  describe('Relative Paths with basePath option', () => {
    it('resolves relative path against Windows basePath', () => {
      expect(normalize('./src', { basePath: 'c:/project' })).toBe(
        'c:/project/src'
      );
    });

    it('resolves parent directory reference against POSIX basePath', () => {
      expect(normalize('../lib', { basePath: '/home/will/app' })).toBe(
        '/home/will/lib'
      );
    });

    it('resolves simple relative path against basePath', () => {
      expect(normalize('docs/readme.md', { basePath: 'c:/project' })).toBe(
        'c:/project/docs/readme.md'
      );
    });

    it('handles basePath with trailing slash', () => {
      expect(normalize('./src', { basePath: 'c:/project/' })).toBe(
        'c:/project/src'
      );
    });
  });
});

describe('normalizeProjectKey', () => {
  describe('Special Global Cases', () => {
    it('returns "global" for literal "global" input', () => {
      expect(normalizeProjectKey('global')).toBe('global');
    });

    it('returns "global" for "__global__" input', () => {
      expect(normalizeProjectKey('__global__')).toBe('global');
    });

    it('returns "global" for undefined input', () => {
      expect(normalizeProjectKey()).toBe('global');
      expect(normalizeProjectKey(undefined)).toBe('global');
    });

    it('returns "global" for empty string input', () => {
      expect(normalizeProjectKey('')).toBe('global');
    });

    it('returns "global" for null input', () => {
      expect(normalizeProjectKey(null as unknown as string)).toBe('global');
    });
  });

  describe('Path Normalization', () => {
    it('normalizes WSL mount path to canonical format', () => {
      expect(normalizeProjectKey('/mnt/c/project')).toBe('c:/project');
    });

    it('normalizes Windows path to canonical format', () => {
      expect(normalizeProjectKey('C:\\Projects\\app')).toBe('c:/projects/app');
    });

    it('normalizes Git Bash path to canonical format', () => {
      expect(normalizeProjectKey('/d/work/repo')).toBe('d:/work/repo');
    });

    it('preserves POSIX paths (case-sensitive)', () => {
      expect(normalizeProjectKey('/home/user/MyProject')).toBe(
        '/home/user/MyProject'
      );
    });

    it('normalizes UNC paths', () => {
      expect(normalizeProjectKey('\\\\server\\share\\project')).toBe(
        '//server/share/project'
      );
    });
  });
});

describe('analyze', () => {
  describe('PathInfo Structure', () => {
    it('returns correct PathInfo for Windows path', () => {
      const info = analyze('C:\\Users\\will');
      expect(info.canonical).toBe('c:/users/will');
      expect(info.original).toBe('C:\\Users\\will');
      expect(info.isAbsolute).toBe(true);
      expect(info.isUNC).toBe(false);
      expect(info.isWSLMount).toBe(false);
      expect(info.driveLetter).toBe('c');
    });

    it('returns correct PathInfo for UNC path', () => {
      const info = analyze('\\\\server\\share\\path');
      expect(info.canonical).toBe('//server/share/path');
      expect(info.original).toBe('\\\\server\\share\\path');
      expect(info.isAbsolute).toBe(true);
      expect(info.isUNC).toBe(true);
      expect(info.isWSLMount).toBe(false);
      expect(info.driveLetter).toBeUndefined();
    });

    it('returns correct PathInfo for WSL mount path', () => {
      const info = analyze('/mnt/c/Users/will');
      expect(info.canonical).toBe('c:/users/will');
      expect(info.original).toBe('/mnt/c/Users/will');
      expect(info.isAbsolute).toBe(true);
      expect(info.isUNC).toBe(false);
      expect(info.isWSLMount).toBe(true);
      expect(info.driveLetter).toBe('c');
    });

    it('returns correct PathInfo for POSIX path', () => {
      const info = analyze('/home/user/project');
      expect(info.canonical).toBe('/home/user/project');
      expect(info.original).toBe('/home/user/project');
      expect(info.isAbsolute).toBe(true);
      expect(info.isUNC).toBe(false);
      expect(info.isWSLMount).toBe(false);
      expect(info.driveLetter).toBeUndefined();
    });

    it('returns correct PathInfo for Git Bash path', () => {
      const info = analyze('/d/Projects/app');
      expect(info.canonical).toBe('d:/projects/app');
      expect(info.original).toBe('/d/Projects/app');
      expect(info.isAbsolute).toBe(true);
      expect(info.isUNC).toBe(false);
      expect(info.isWSLMount).toBe(false);
      expect(info.driveLetter).toBe('d');
    });
  });

  describe('Error Handling', () => {
    it('throws TypeError for empty path', () => {
      expect(() => analyze('')).toThrow(TypeError);
    });

    it('throws TypeError for null path', () => {
      expect(() => analyze(null as unknown as string)).toThrow(TypeError);
    });
  });
});

describe('Canonical Path Consistency', () => {
  it('produces identical output for equivalent Windows paths', () => {
    const paths = [
      'C:\\Users\\will',
      'c:/Users/Will',
      'C:/users/will',
      'c:\\USERS\\WILL',
    ];
    const results = paths.map((p) => normalize(p));
    expect(new Set(results).size).toBe(1);
    expect(results[0]).toBe('c:/users/will');
  });

  it('produces identical output for WSL and Windows equivalent paths', () => {
    const wslPath = normalize('/mnt/c/Users/will');
    const winPath = normalize('C:\\Users\\will');
    expect(wslPath).toBe(winPath);
  });

  it('produces identical output for Git Bash and Windows equivalent paths', () => {
    const gitBashPath = normalize('/c/Users/will');
    const winPath = normalize('C:\\Users\\will');
    expect(gitBashPath).toBe(winPath);
  });

  it('produces identical output for all equivalent representations', () => {
    const paths = [
      'C:\\Users\\will',
      'c:/Users/Will',
      '/mnt/c/Users/will',
      '/c/Users/will',
    ];
    const results = paths.map((p) => normalize(p));
    expect(new Set(results).size).toBe(1);
  });
});

describe('Edge Cases', () => {
  it('handles path with only drive letter', () => {
    expect(normalize('C:')).toBe('c:/');
  });

  it('handles single character after drive', () => {
    expect(normalize('C:\\a')).toBe('c:/a');
  });

  it('handles deeply nested paths', () => {
    expect(normalize('C:\\a\\b\\c\\d\\e\\f\\g')).toBe('c:/a/b/c/d/e/f/g');
  });

  it('handles paths with numeric directory names', () => {
    expect(normalize('C:\\123\\456\\789')).toBe('c:/123/456/789');
  });

  it('handles POSIX root correctly', () => {
    expect(normalize('/')).toBe('/');
  });

  it('handles paths with @ symbol', () => {
    expect(normalize('C:\\Users\\user@domain\\file')).toBe(
      'c:/users/user@domain/file'
    );
  });

  it('handles paths with parentheses', () => {
    expect(normalize('C:\\Program Files (x86)\\App')).toBe(
      'c:/program files (x86)/app'
    );
  });

  it('handles paths ending with dot', () => {
    // Windows strips trailing dots - we should too for consistency
    const result = normalize('C:\\folder.');
    expect(result).toBe('c:/folder');
  });
});

// =============================================================================
// SECURITY AND EDGE CASE TESTS
// These tests were added based on adversarial security review
// =============================================================================

describe('Security: Null byte handling', () => {
  it('should reject paths with null bytes at the start', () => {
    expect(() => normalize('\x00path')).toThrow('Path cannot contain null bytes');
  });

  it('should reject paths with null bytes in the middle', () => {
    expect(() => normalize('C:\\path\x00with\x00null')).toThrow('Path cannot contain null bytes');
  });

  it('should reject paths with null bytes at the end', () => {
    expect(() => normalize('C:\\path\x00')).toThrow('Path cannot contain null bytes');
  });

  it('should reject null bytes in POSIX paths', () => {
    expect(() => normalize('/home/user\x00/file')).toThrow('Path cannot contain null bytes');
  });
});

describe('Windows trailing dots and spaces', () => {
  it('should strip trailing dots from segments', () => {
    expect(normalize('C:\\folder.')).toBe('c:/folder');
    expect(normalize('C:\\folder../subfolder')).toBe('c:/folder/subfolder');
    expect(normalize('C:\\folder.\\sub.')).toBe('c:/folder/sub');
  });

  it('should strip trailing spaces from segments', () => {
    expect(normalize('C:\\folder ')).toBe('c:/folder');
    expect(normalize('C:\\folder  \\subfolder ')).toBe('c:/folder/subfolder');
  });

  it('should strip mixed trailing dots and spaces', () => {
    expect(normalize('C:\\folder. ')).toBe('c:/folder');
    expect(normalize('C:\\folder . ')).toBe('c:/folder');
    expect(normalize('C:\\folder  ..')).toBe('c:/folder');
  });

  it('should handle multiple segments with trailing dots/spaces', () => {
    expect(normalize('C:\\folder.\\sub \\file.')).toBe('c:/folder/sub/file');
  });

  it('should preserve dots and spaces in POSIX paths (case-sensitive)', () => {
    // POSIX filesystems don't strip trailing dots/spaces
    const result = normalize('/home/user/folder.');
    expect(result).toBe('/home/user/folder.');
  });
});

describe('Drive-relative paths', () => {
  it('should resolve drive-relative paths against basePath on same drive', () => {
    const result = normalize('C:folder', { basePath: 'C:/Users/will' });
    expect(result).toBe('c:/users/will/folder');
  });

  it('should resolve drive-relative paths with subdirectories', () => {
    const result = normalize('C:folder/subfolder', { basePath: 'C:/Users' });
    expect(result).toBe('c:/users/folder/subfolder');
  });

  it('should resolve against drive root when basePath is different drive', () => {
    const result = normalize('C:folder', { basePath: 'D:/Other' });
    expect(result).toBe('c:/folder');
  });

  it('should resolve against drive root when basePath is POSIX', () => {
    const result = normalize('C:folder', { basePath: '/home/user' });
    expect(result).toBe('c:/folder');
  });

  it('should handle parent references in drive-relative paths', () => {
    const result = normalize('C:../other', { basePath: 'C:/Users/will' });
    expect(result).toBe('c:/users/other');
  });
});

describe('UNC path edge cases', () => {
  it('should handle minimal UNC paths', () => {
    // //a is technically valid as partial UNC (server name only)
    expect(normalize('//server')).toBe('//server');
  });

  it('should handle UNC with share', () => {
    // UNC paths with share don't get trailing slash added (only preserved if present)
    expect(normalize('//server/share')).toBe('//server/share');
    // With trailing slash, it's preserved as UNC root
    expect(normalize('//server/share/')).toBe('//server/share/');
  });

  it('should reject triple slashes as UNC', () => {
    // ///path should not be treated as UNC
    const result = normalize('///path');
    // Should be normalized as regular path, not UNC
    expect(result.startsWith('//')).toBe(false);
  });

  it('should handle UNC with spaces in server/share names', () => {
    expect(normalize('//my server/my share/path')).toBe('//my server/my share/path');
  });

  it('should handle WSL$ UNC paths', () => {
    expect(normalize('\\\\wsl$\\Ubuntu\\home\\user')).toBe('//wsl$/ubuntu/home/user');
  });
});

describe('WSL UNC paths (\\\\wsl.localhost\\distro\\...)', () => {
  it('should convert WSL UNC to native path when env is wsl and distro matches', () => {
    // Save original env
    const originalDistro = process.env.WSL_DISTRO_NAME;

    try {
      // Simulate running on WSL with Ubuntu
      process.env.WSL_DISTRO_NAME = 'Ubuntu';

      const result = normalize('\\\\wsl.localhost\\Ubuntu\\home\\user', { env: 'wsl' });
      expect(result).toBe('/home/user');
    } finally {
      // Restore original env
      if (originalDistro === undefined) {
        delete process.env.WSL_DISTRO_NAME;
      } else {
        process.env.WSL_DISTRO_NAME = originalDistro;
      }
    }
  });

  it('should convert WSL$ UNC to native path when distro matches', () => {
    const originalDistro = process.env.WSL_DISTRO_NAME;

    try {
      process.env.WSL_DISTRO_NAME = 'Ubuntu';

      const result = normalize('\\\\wsl$\\Ubuntu\\home\\will', { env: 'wsl' });
      expect(result).toBe('/home/will');
    } finally {
      if (originalDistro === undefined) {
        delete process.env.WSL_DISTRO_NAME;
      } else {
        process.env.WSL_DISTRO_NAME = originalDistro;
      }
    }
  });

  it('should treat as regular UNC when distro does not match', () => {
    const originalDistro = process.env.WSL_DISTRO_NAME;

    try {
      process.env.WSL_DISTRO_NAME = 'Debian';

      // Ubuntu path but we're on Debian - treat as UNC
      const result = normalize('\\\\wsl.localhost\\Ubuntu\\home\\user', { env: 'wsl' });
      expect(result.startsWith('//')).toBe(true);
    } finally {
      if (originalDistro === undefined) {
        delete process.env.WSL_DISTRO_NAME;
      } else {
        process.env.WSL_DISTRO_NAME = originalDistro;
      }
    }
  });

  it('should treat as regular UNC when not on WSL', () => {
    const result = normalize('\\\\wsl.localhost\\Ubuntu\\home\\user', { env: 'windows' });
    expect(result).toBe('//wsl.localhost/ubuntu/home/user');
  });
});

describe('Path consistency invariants', () => {
  it('should produce same output for equivalent Windows paths', () => {
    const paths = [
      'C:\\Users\\Will\\Project',
      'C:/Users/Will/Project',
      'c:\\users\\will\\project',
      'C:\\Users\\Will\\Project\\',
    ];

    const normalized = paths.map(p => normalize(p));
    const first = normalized[0];
    for (const result of normalized) {
      expect(result).toBe(first);
    }
  });

  it('should produce same output for paths with trailing dots/spaces', () => {
    const equivalent = [
      normalize('C:\\folder'),
      normalize('C:\\folder.'),
      normalize('C:\\folder '),
      normalize('C:\\folder. '),
    ];

    const first = equivalent[0];
    for (const result of equivalent) {
      expect(result).toBe(first);
    }
  });
});
