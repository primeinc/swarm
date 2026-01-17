import { describe, test, expect } from 'bun:test';
import {
  isAbsolute,
  isUNC,
  isWSLMount,
  isGitBashMount,
  hasDriveLetter,
  isValidPath,
} from '../validate.js';

describe('validate', () => {
  describe('isAbsolute', () => {
    test('C:\\Users is absolute', () => {
      expect(isAbsolute('C:\\Users')).toBe(true);
    });

    test('c:/users is absolute', () => {
      expect(isAbsolute('c:/users')).toBe(true);
    });

    test('/home/user is absolute', () => {
      expect(isAbsolute('/home/user')).toBe(true);
    });

    test('//server/share is absolute', () => {
      expect(isAbsolute('//server/share')).toBe(true);
    });

    test('./relative is not absolute', () => {
      expect(isAbsolute('./relative')).toBe(false);
    });

    test('relative is not absolute', () => {
      expect(isAbsolute('relative')).toBe(false);
    });

    test('\\\\server\\share is absolute (UNC with backslashes)', () => {
      expect(isAbsolute('\\\\server\\share')).toBe(true);
    });

    test('/mnt/c/Users is absolute', () => {
      expect(isAbsolute('/mnt/c/Users')).toBe(true);
    });

    test('../parent is not absolute', () => {
      expect(isAbsolute('../parent')).toBe(false);
    });
  });

  describe('isUNC', () => {
    test('\\\\server\\share is UNC', () => {
      expect(isUNC('\\\\server\\share')).toBe(true);
    });

    test('//server/share is UNC', () => {
      expect(isUNC('//server/share')).toBe(true);
    });

    test('///triple is not UNC', () => {
      expect(isUNC('///triple')).toBe(false);
    });

    test('C:\\path is not UNC', () => {
      expect(isUNC('C:\\path')).toBe(false);
    });

    test('/unix/path is not UNC', () => {
      expect(isUNC('/unix/path')).toBe(false);
    });

    test('\\\\wsl$\\Ubuntu is UNC', () => {
      expect(isUNC('\\\\wsl$\\Ubuntu')).toBe(true);
    });

    test('//server is UNC (minimal)', () => {
      expect(isUNC('//server')).toBe(true);
    });

    test('/single is not UNC', () => {
      expect(isUNC('/single')).toBe(false);
    });
  });

  describe('isWSLMount', () => {
    test('/mnt/c/ is WSL mount', () => {
      expect(isWSLMount('/mnt/c/')).toBe(true);
    });

    test('/mnt/c/Users is WSL mount', () => {
      expect(isWSLMount('/mnt/c/Users')).toBe(true);
    });

    test('/mnt/C/ is WSL mount (case insensitive)', () => {
      expect(isWSLMount('/mnt/C/')).toBe(true);
    });

    test('/home/user is not WSL mount', () => {
      expect(isWSLMount('/home/user')).toBe(false);
    });

    test('/mnt/ is not WSL mount', () => {
      expect(isWSLMount('/mnt/')).toBe(false);
    });

    test('/mnt/c is WSL mount (no trailing slash)', () => {
      expect(isWSLMount('/mnt/c')).toBe(true);
    });

    test('/mnt/d/Projects is WSL mount', () => {
      expect(isWSLMount('/mnt/d/Projects')).toBe(true);
    });

    test('/mnt/cd/path is not WSL mount (not single letter)', () => {
      expect(isWSLMount('/mnt/cd/path')).toBe(false);
    });

    test('C:\\path is not WSL mount', () => {
      expect(isWSLMount('C:\\path')).toBe(false);
    });
  });

  describe('isGitBashMount', () => {
    test('/c/ is Git Bash mount', () => {
      expect(isGitBashMount('/c/')).toBe(true);
    });

    test('/c/Users is Git Bash mount', () => {
      expect(isGitBashMount('/c/Users')).toBe(true);
    });

    test('/home is not Git Bash mount', () => {
      expect(isGitBashMount('/home')).toBe(false);
    });

    test('/mnt/c is not Git Bash mount', () => {
      expect(isGitBashMount('/mnt/c')).toBe(false);
    });

    test('/C/Users is Git Bash mount (case insensitive)', () => {
      expect(isGitBashMount('/C/Users')).toBe(true);
    });

    test('/d/Projects is Git Bash mount', () => {
      expect(isGitBashMount('/d/Projects')).toBe(true);
    });

    test('C:\\path is not Git Bash mount', () => {
      expect(isGitBashMount('C:\\path')).toBe(false);
    });

    test('/cd/path is not Git Bash mount (not single letter)', () => {
      expect(isGitBashMount('/cd/path')).toBe(false);
    });

    test('/c is not Git Bash mount (no trailing slash)', () => {
      expect(isGitBashMount('/c')).toBe(false);
    });
  });

  describe('hasDriveLetter', () => {
    test('C: has drive letter', () => {
      expect(hasDriveLetter('C:')).toBe(true);
    });

    test('c:/ has drive letter', () => {
      expect(hasDriveLetter('c:/')).toBe(true);
    });

    test('/home has no drive letter', () => {
      expect(hasDriveLetter('/home')).toBe(false);
    });

    test('C:\\Users has drive letter', () => {
      expect(hasDriveLetter('C:\\Users')).toBe(true);
    });

    test('D:/Projects has drive letter', () => {
      expect(hasDriveLetter('D:/Projects')).toBe(true);
    });

    test('//server/share has no drive letter', () => {
      expect(hasDriveLetter('//server/share')).toBe(false);
    });

    test('relative/path has no drive letter', () => {
      expect(hasDriveLetter('relative/path')).toBe(false);
    });

    test('c:relative has drive letter', () => {
      expect(hasDriveLetter('c:relative')).toBe(true);
    });
  });

  describe('isValidPath', () => {
    test('valid is a valid path', () => {
      expect(isValidPath('valid')).toBe(true);
    });

    test('empty string is not a valid path', () => {
      expect(isValidPath('')).toBe(false);
    });

    test('path with null byte is not valid', () => {
      expect(isValidPath('path\0with\0null')).toBe(false);
    });

    test('/home/user is a valid path', () => {
      expect(isValidPath('/home/user')).toBe(true);
    });

    test('C:\\Users is a valid path', () => {
      expect(isValidPath('C:\\Users')).toBe(true);
    });

    test('relative/path is a valid path', () => {
      expect(isValidPath('relative/path')).toBe(true);
    });

    test('path with spaces is valid', () => {
      expect(isValidPath('path with spaces')).toBe(true);
    });

    test('single null byte is not valid', () => {
      expect(isValidPath('\0')).toBe(false);
    });

    test('null byte at start is not valid', () => {
      expect(isValidPath('\0path')).toBe(false);
    });

    test('null byte at end is not valid', () => {
      expect(isValidPath('path\0')).toBe(false);
    });
  });
});

// =============================================================================
// isDriveRelative tests (new function for drive-relative path detection)
// =============================================================================

import { isDriveRelative, parseWSLUNC, isWSLUNC } from '../validate.js';

describe('isDriveRelative', () => {
  describe('positive cases', () => {
    test('C:folder is drive-relative', () => {
      expect(isDriveRelative('C:folder')).toBe(true);
    });

    test('c:folder is drive-relative (lowercase)', () => {
      expect(isDriveRelative('c:folder')).toBe(true);
    });

    test('C:relative/path is drive-relative', () => {
      expect(isDriveRelative('C:relative/path')).toBe(true);
    });

    test('D:sub\\folder is drive-relative', () => {
      expect(isDriveRelative('D:sub\\folder')).toBe(true);
    });
  });

  describe('negative cases', () => {
    test('C:/absolute is NOT drive-relative (has slash)', () => {
      expect(isDriveRelative('C:/absolute')).toBe(false);
    });

    test('C:\\absolute is NOT drive-relative (has backslash)', () => {
      expect(isDriveRelative('C:\\absolute')).toBe(false);
    });

    test('/unix/path is NOT drive-relative', () => {
      expect(isDriveRelative('/unix/path')).toBe(false);
    });

    test('relative is NOT drive-relative', () => {
      expect(isDriveRelative('relative')).toBe(false);
    });

    test('C: alone is NOT drive-relative (too short)', () => {
      expect(isDriveRelative('C:')).toBe(false);
    });

    test('empty string is NOT drive-relative', () => {
      expect(isDriveRelative('')).toBe(false);
    });

    test('1:folder is NOT drive-relative (number, not letter)', () => {
      expect(isDriveRelative('1:folder')).toBe(false);
    });
  });
});

// =============================================================================
// Additional isUNC edge case tests
// =============================================================================

describe('isUNC edge cases', () => {
  test('//server is UNC (minimal valid)', () => {
    expect(isUNC('//server')).toBe(true);
  });

  test('//a is UNC (single character server)', () => {
    expect(isUNC('//a')).toBe(true);
  });

  test('// alone is NOT UNC (no server)', () => {
    expect(isUNC('//')).toBe(false);
  });

  test('/// is NOT UNC (triple slash)', () => {
    expect(isUNC('///')).toBe(false);
  });

  test('///path is NOT UNC (triple slash with path)', () => {
    expect(isUNC('///path')).toBe(false);
  });

  test('// (space) is NOT UNC (whitespace only)', () => {
    expect(isUNC('// ')).toBe(false);
  });

  test('//server/share is UNC', () => {
    expect(isUNC('//server/share')).toBe(true);
  });

  test('\\\\server\\share is UNC (backslash format)', () => {
    expect(isUNC('\\\\server\\share')).toBe(true);
  });
});

// =============================================================================
// WSL UNC path tests (\\wsl.localhost\distro\... and \\wsl$\distro\...)
// =============================================================================

describe('parseWSLUNC', () => {
  describe('positive cases', () => {
    test('parses \\\\wsl.localhost\\Ubuntu\\home\\user', () => {
      const result = parseWSLUNC('\\\\wsl.localhost\\Ubuntu\\home\\user');
      expect(result).toEqual({ distro: 'Ubuntu', path: '/home/user' });
    });

    test('parses \\\\wsl$\\Ubuntu\\home\\user', () => {
      const result = parseWSLUNC('\\\\wsl$\\Ubuntu\\home\\user');
      expect(result).toEqual({ distro: 'Ubuntu', path: '/home/user' });
    });

    test('parses //wsl.localhost/Ubuntu/home/user (forward slashes)', () => {
      const result = parseWSLUNC('//wsl.localhost/Ubuntu/home/user');
      expect(result).toEqual({ distro: 'Ubuntu', path: '/home/user' });
    });

    test('handles root path', () => {
      const result = parseWSLUNC('\\\\wsl.localhost\\Ubuntu');
      expect(result).toEqual({ distro: 'Ubuntu', path: '/' });
    });

    test('handles Debian distro', () => {
      const result = parseWSLUNC('\\\\wsl.localhost\\Debian\\etc\\passwd');
      expect(result).toEqual({ distro: 'Debian', path: '/etc/passwd' });
    });

    test('is case-insensitive for wsl.localhost', () => {
      const result = parseWSLUNC('\\\\WSL.LOCALHOST\\Ubuntu\\home');
      expect(result).toEqual({ distro: 'Ubuntu', path: '/home' });
    });
  });

  describe('negative cases', () => {
    test('returns null for regular UNC paths', () => {
      expect(parseWSLUNC('\\\\server\\share')).toBeNull();
    });

    test('returns null for Windows paths', () => {
      expect(parseWSLUNC('C:\\Users\\will')).toBeNull();
    });

    test('returns null for POSIX paths', () => {
      expect(parseWSLUNC('/home/user')).toBeNull();
    });
  });
});

describe('isWSLUNC', () => {
  test('returns true for WSL UNC paths', () => {
    expect(isWSLUNC('\\\\wsl.localhost\\Ubuntu\\home')).toBe(true);
    expect(isWSLUNC('\\\\wsl$\\Debian\\home')).toBe(true);
  });

  test('returns false for regular UNC paths', () => {
    expect(isWSLUNC('\\\\server\\share')).toBe(false);
  });

  test('returns false for non-UNC paths', () => {
    expect(isWSLUNC('C:\\Users\\will')).toBe(false);
    expect(isWSLUNC('/home/user')).toBe(false);
  });
});
