/**
 * Tests for Windows path normalization utilities
 * 
 * These tests verify that path normalization works correctly across:
 * - Windows drive letters
 * - UNC paths
 * - Mixed path separators
 * - Edge cases
 * 
 * Run with: npx tsx src/utils/normalize-path.test.ts
 */

import { 
    normalizePath, 
    isUncPath, 
    normalizeGrepPattern,
    normalizePaths 
} from './normalize-path';

// Simple test runner
interface TestCase {
    name: string;
    fn: () => void;
}

const tests: TestCase[] = [];
let passed = 0;
let failed = 0;

function test(name: string, fn: () => void): void {
    tests.push({ name, fn });
}

function expect(actual: unknown) {
    return {
        toBe(expected: unknown) {
            if (actual !== expected) {
                throw new Error(`Expected ${JSON.stringify(expected)} but got ${JSON.stringify(actual)}`);
            }
        },
        toEqual(expected: unknown) {
            const actualStr = JSON.stringify(actual);
            const expectedStr = JSON.stringify(expected);
            if (actualStr !== expectedStr) {
                throw new Error(`Expected ${expectedStr} but got ${actualStr}`);
            }
        }
    };
}

// Tests: Drive letter normalization
test('normalizePath: should fix missing slash after drive letter', () => {
    expect(normalizePath('C:Users')).toBe('C:/Users');
    expect(normalizePath('D:project')).toBe('D:/project');
    expect(normalizePath('E:')).toBe('E:/');
});

test('normalizePath: should handle already correct drive letters', () => {
    expect(normalizePath('C:/Users')).toBe('C:/Users');
    expect(normalizePath('C:/')).toBe('C:/');
});

test('normalizePath: should handle backslashes in Windows paths', () => {
    expect(normalizePath('C:\\Users\\will\\dev')).toBe('C:/Users/will/dev');
    expect(normalizePath('D:\\project\\src')).toBe('D:/project/src');
});

test('normalizePath: should handle mixed separators', () => {
    expect(normalizePath('C:\\Users/will\\dev')).toBe('C:/Users/will/dev');
    expect(normalizePath('C:/Users\\will/dev')).toBe('C:/Users/will/dev');
});

// Tests: UNC path handling
test('normalizePath: should preserve UNC paths with double slash', () => {
    expect(normalizePath('\\\\server\\share')).toBe('//server/share');
    expect(normalizePath('//server/share')).toBe('//server/share');
});

test('normalizePath: should handle UNC paths with subdirectories', () => {
    expect(normalizePath('\\\\server\\share\\path\\to\\file')).toBe('//server/share/path/to/file');
    expect(normalizePath('//server/share/path/to/file')).toBe('//server/share/path/to/file');
});

test('normalizePath: should normalize multiple slashes in UNC paths', () => {
    expect(normalizePath('//server//share///path')).toBe('//server/share/path');
    expect(normalizePath('\\\\server\\\\share\\\\\\path')).toBe('//server/share/path');
});

test('normalizePath: should NOT treat triple slash as UNC path', () => {
    expect(normalizePath('///path/to/file')).toBe('/path/to/file');
    expect(normalizePath('////path')).toBe('/path');
});

// Tests: Multiple slash collapsing
test('normalizePath: should collapse multiple forward slashes', () => {
    expect(normalizePath('C://Users///will')).toBe('C:/Users/will');
    expect(normalizePath('/path//to///file')).toBe('/path/to/file');
});

test('normalizePath: should collapse multiple backslashes', () => {
    expect(normalizePath('C:\\\\Users\\\\\\will')).toBe('C:/Users/will');
});

test('normalizePath: should handle edge case of many slashes', () => {
    expect(normalizePath('C://///////Users')).toBe('C:/Users');
    expect(normalizePath('//////////path')).toBe('/path');
});

// Tests: Edge cases
test('normalizePath: should handle empty string', () => {
    expect(normalizePath('')).toBe('');
});

test('normalizePath: should handle root paths', () => {
    expect(normalizePath('/')).toBe('/');
    expect(normalizePath('C:/')).toBe('C:/');
    expect(normalizePath('C:\\')).toBe('C:/');
});

test('normalizePath: should handle relative paths', () => {
    expect(normalizePath('./relative/path')).toBe('./relative/path');
    expect(normalizePath('../parent/path')).toBe('../parent/path');
});

test('normalizePath: should handle paths with dots', () => {
    expect(normalizePath('C:/Users/./will')).toBe('C:/Users/./will');
    expect(normalizePath('C:/Users/../will')).toBe('C:/Users/../will');
});

// Tests: Real-world Windows paths
test('normalizePath: should handle typical Windows project paths', () => {
    expect(normalizePath('C:\\Users\\will\\dev\\swarm-tools')).toBe('C:/Users/will/dev/swarm-tools');
    expect(normalizePath('C:\\Program Files\\Node\\bin')).toBe('C:/Program Files/Node/bin');
});

test('normalizePath: should handle network share paths', () => {
    expect(normalizePath('\\\\FILESERVER\\Projects\\swarm-tools')).toBe('//FILESERVER/Projects/swarm-tools');
});

test('normalizePath: should handle paths from path.join on Windows', () => {
    // path.join can produce C:Userswill (malformed)
    expect(normalizePath('C:Userswilldevswarm-tools')).toBe('C:/Userswilldevswarm-tools');
});

// Tests: isUncPath
test('isUncPath: should identify UNC paths with backslashes', () => {
    expect(isUncPath('\\\\server\\share')).toBe(true);
    expect(isUncPath('\\\\FILESERVER\\Projects')).toBe(true);
});

test('isUncPath: should identify UNC paths with forward slashes', () => {
    expect(isUncPath('//server/share')).toBe(true);
    expect(isUncPath('//FILESERVER/Projects')).toBe(true);
});

test('isUncPath: should NOT identify regular paths as UNC', () => {
    expect(isUncPath('C:\\Users\\will')).toBe(false);
    expect(isUncPath('C:/Users/will')).toBe(false);
    expect(isUncPath('/usr/local/bin')).toBe(false);
});

test('isUncPath: should NOT identify triple slash as UNC', () => {
    expect(isUncPath('///path')).toBe(false);
    expect(isUncPath('\\\\\\path')).toBe(false);
});

test('isUncPath: should handle empty string', () => {
    expect(isUncPath('')).toBe(false);
});

// Tests: normalizeGrepPattern
test('normalizeGrepPattern: should normalize backslashes in glob patterns', () => {
    expect(normalizeGrepPattern('src\\**\\*.ts')).toBe('src/**/*.ts');
    expect(normalizeGrepPattern('dist\\*.js')).toBe('dist/*.js');
});

test('normalizeGrepPattern: should handle paths in grep patterns', () => {
    expect(normalizeGrepPattern('C:\\project\\src')).toBe('C:/project/src');
});

test('normalizeGrepPattern: should handle already normalized patterns', () => {
    expect(normalizeGrepPattern('src/**/*.ts')).toBe('src/**/*.ts');
    expect(normalizeGrepPattern('**/*.md')).toBe('**/*.md');
});

// Tests: normalizePaths
test('normalizePaths: should normalize an array of paths', () => {
    const input = [
        'C:\\Users\\will',
        'D:project',
        '\\\\server\\share',
        '/usr/local/bin'
    ];
    const expected = [
        'C:/Users/will',
        'D:/project',
        '//server/share',
        '/usr/local/bin'
    ];
    expect(normalizePaths(input)).toEqual(expected);
});

test('normalizePaths: should handle empty array', () => {
    expect(normalizePaths([])).toEqual([]);
});

test('normalizePaths: should handle array with empty strings', () => {
    expect(normalizePaths(['', 'C:\\Users', ''])).toEqual(['', 'C:/Users', '']);
});

// Run all tests
function runTests(): void {
    console.log('='.repeat(80));
    console.log('Running Windows Path Normalization Tests');
    console.log('='.repeat(80));
    console.log('');

    for (const { name, fn } of tests) {
        try {
            fn();
            console.log(`✅ PASS: ${name}`);
            passed++;
        } catch (error) {
            console.error(`❌ FAIL: ${name}`);
            console.error(`   ${error instanceof Error ? error.message : String(error)}`);
            failed++;
        }
    }

    // ============================================================
    // FILESYSTEM INTEGRATION TESTS (prove it actually works)
    // ============================================================
    console.log('');
    console.log('='.repeat(80));
    console.log('Running Filesystem Integration Tests');
    console.log('='.repeat(80));
    console.log('');

    const fs = require('fs');
    const pathModule = require('path');
    
    // Find a file that definitely exists
    const testFile = pathModule.join(process.cwd(), 'package.json');
    
    if (fs.existsSync(testFile)) {
        // Test 1: Backslash path works after normalization
        const backslashPath = testFile.replace(/\//g, '\\');
        const normalized1 = normalizePath(backslashPath);
        if (fs.existsSync(normalized1)) {
            console.log('✅ PASS: Backslash path works after normalization');
            console.log(`   Input:  ${backslashPath}`);
            console.log(`   Output: ${normalized1}`);
            passed++;
        } else {
            console.log('❌ FAIL: Backslash path does not work');
            failed++;
        }

        // Test 2: Malformed drive letter (C:Users) gets fixed
        if (process.platform === 'win32') {
            // Create malformed path: C:Users\will\... (missing slash after C:)
            const parts = testFile.split(/[/\\]/);
            const drive = parts[0]; // "C:"
            const rest = parts.slice(1).join('\\'); // "Users\will\..."
            const malformedPath = drive + rest; // "C:Users\will\..." (BROKEN)
            const fixedPath = normalizePath(malformedPath);
            
            if (fs.existsSync(fixedPath)) {
                console.log('✅ PASS: Malformed drive letter (C:Users) fixed');
                console.log(`   Input:  ${malformedPath}`);
                console.log(`   Output: ${fixedPath}`);
                passed++;
            } else {
                console.log('❌ FAIL: Malformed drive letter not fixed');
                console.log(`   Input:  ${malformedPath}`);
                console.log(`   Output: ${fixedPath}`);
                failed++;
            }
        } else {
            console.log('⏭️ SKIP: Drive letter test (not Windows)');
        }
    } else {
        console.log('⏭️ SKIP: Filesystem tests (no package.json found)');
    }

    console.log('');
    console.log('='.repeat(80));
    console.log(`Results: ${passed} passed, ${failed} failed`);
    console.log('='.repeat(80));

    if (failed > 0) {
        process.exit(1);
    } else {
        console.log('All tests passed! ✅');
        process.exit(0);
    }
}

if (require.main === module) {
    runTests();
}
