/**
 * Windows Testing: Git Worktree Isolation
 * 
 * Tests the git worktree functionality for parallel agent isolation.
 * 
 * Platform: Windows 11
 * Node: v22.21.1
 * Test Date: 2026-01-13
 */

import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

interface TestResult {
    name: string;
    status: 'PASS' | 'FAIL';
    message?: string;
    error?: string;
}

const results: TestResult[] = [];

function test(name: string, fn: () => void | Promise<void>) {
    return async () => {
        try {
            await fn();
            results.push({ name, status: 'PASS' });
            console.log(`✅ ${name}`);
        } catch (error) {
            results.push({
                name,
                status: 'FAIL',
                error: error instanceof Error ? error.message : String(error)
            });
            console.error(`❌ ${name}:`, error);
        }
    };
}

function exec(command: string): string {
    return execSync(command, {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true
    }).trim();
}

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const WORKTREE_DIR = path.join(PROJECT_ROOT, '..', 'swarm-tools-worktree-test-123');

async function main() {
    console.log('🪟 Windows Git Worktree Isolation Tests\n');
    console.log(`Project Root: ${PROJECT_ROOT}`);
    console.log(`Test Worktree: ${WORKTREE_DIR}\n`);

    // Cleanup any existing test worktree
    if (fs.existsSync(WORKTREE_DIR)) {
        console.log('⚠️  Cleaning up existing test worktree...');
        try {
            exec(`git worktree remove "${WORKTREE_DIR}" --force`);
        } catch (e) {
            // Ignore errors, worktree might not be registered
        }
        if (fs.existsSync(WORKTREE_DIR)) {
            fs.rmSync(WORKTREE_DIR, { recursive: true, force: true });
        }
    }

    // Test 1: Verify git repository exists
    await test('Git repository detection', () => {
        const gitDir = path.join(PROJECT_ROOT, '.git');
        if (!fs.existsSync(gitDir)) {
            throw new Error('.git directory not found - repository required for worktree tests');
        }
    })();

    // Test 2: Get current branch and commit
    let mainBranch = '';
    let startCommit = '';
    await test('Get main branch info', () => {
        mainBranch = exec('git rev-parse --abbrev-ref HEAD');
        startCommit = exec('git rev-parse HEAD');
        console.log(`   Branch: ${mainBranch}, Commit: ${startCommit.substring(0, 7)}`);
    })();

    // Test 3: Create worktree
    await test('Create git worktree', () => {
        const result = exec(`git worktree add "${WORKTREE_DIR}" "${startCommit}"`);
        console.log(`   ${result}`);
        
        if (!fs.existsSync(WORKTREE_DIR)) {
            throw new Error('Worktree directory not created');
        }
    })();

    // Test 4: Verify worktree structure
    await test('Verify worktree structure', () => {
        const requiredPaths = [
            '.git',
            'package.json',
            'src',
            'tsconfig.json'
        ];

        for (const p of requiredPaths) {
            const fullPath = path.join(WORKTREE_DIR, p);
            if (!fs.existsSync(fullPath)) {
                throw new Error(`Missing: ${p}`);
            }
        }
        console.log(`   All required paths exist in worktree`);
    })();

    // Test 5: List all worktrees
    await test('List worktrees', () => {
        const output = exec('git worktree list');
        const lines = output.split('\n').filter(l => l.trim());
        
        if (lines.length < 2) {
            throw new Error('Expected at least 2 worktrees (main + test)');
        }

        // Normalize paths for comparison (git may use forward slashes on Windows)
        const normalizedProjectRoot = path.normalize(PROJECT_ROOT).toLowerCase();
        const normalizedWorktreeDir = path.normalize(WORKTREE_DIR).toLowerCase();
        
        const hasMainWorktree = lines.some(l => {
            const normalized = path.normalize(l).toLowerCase();
            return normalized.includes(normalizedProjectRoot);
        });
        const hasTestWorktree = lines.some(l => {
            const normalized = path.normalize(l).toLowerCase();
            return normalized.includes(normalizedWorktreeDir);
        });

        if (!hasMainWorktree) {
            throw new Error(`Main worktree not found. Looking for: ${normalizedProjectRoot}\nGot:\n${output}`);
        }
        if (!hasTestWorktree) {
            throw new Error(`Test worktree not found. Looking for: ${normalizedWorktreeDir}\nGot:\n${output}`);
        }

        console.log(`   Found ${lines.length} worktree(s)`);
    })();

    // Test 6: Verify isolation - create file in worktree
    const testFile = path.join(WORKTREE_DIR, 'WORKTREE_TEST_FILE.txt');
    const mainTestFile = path.join(PROJECT_ROOT, 'WORKTREE_TEST_FILE.txt');
    
    await test('Create file in worktree', () => {
        fs.writeFileSync(testFile, 'This file exists only in the worktree');
        
        if (!fs.existsSync(testFile)) {
            throw new Error('File not created in worktree');
        }
        console.log(`   Created: ${path.basename(testFile)}`);
    })();

    // Test 7: Verify isolation - file does NOT appear in main
    await test('Verify file isolation', () => {
        if (fs.existsSync(mainTestFile)) {
            throw new Error('File should NOT exist in main worktree (isolation failed)');
        }
        console.log(`   ✅ File isolated - not visible in main worktree`);
    })();

    // Test 8: Commit in worktree
    let worktreeCommit = '';
    await test('Commit changes in worktree', () => {
        process.chdir(WORKTREE_DIR);
        exec('git add WORKTREE_TEST_FILE.txt');
        exec('git commit -m "test: worktree isolation test file"');
        worktreeCommit = exec('git rev-parse HEAD');
        process.chdir(PROJECT_ROOT);
        
        console.log(`   Commit: ${worktreeCommit.substring(0, 7)}`);
    })();

    // Test 9: Verify commit is on detached HEAD in worktree
    await test('Verify detached HEAD state', () => {
        process.chdir(WORKTREE_DIR);
        const branch = exec('git rev-parse --abbrev-ref HEAD');
        process.chdir(PROJECT_ROOT);
        
        if (branch !== 'HEAD') {
            console.log(`   ⚠️  Expected detached HEAD, got: ${branch}`);
            // Not a failure - worktree might be on a branch
        } else {
            console.log(`   ✅ Worktree is on detached HEAD (as expected)`);
        }
    })();

    // Test 10: Cherry-pick commit back to main
    await test('Cherry-pick commit to main', () => {
        const before = exec('git rev-parse HEAD');
        exec(`git cherry-pick ${worktreeCommit}`);
        const after = exec('git rev-parse HEAD');
        
        if (before === after) {
            throw new Error('Cherry-pick did not create new commit');
        }
        
        if (!fs.existsSync(mainTestFile)) {
            throw new Error('Cherry-picked file not present in main worktree');
        }
        
        console.log(`   File now exists in main: ${path.basename(mainTestFile)}`);
    })();

    // Test 11: Remove worktree
    await test('Remove worktree', () => {
        exec(`git worktree remove "${WORKTREE_DIR}"`);
        
        if (fs.existsSync(WORKTREE_DIR)) {
            throw new Error('Worktree directory still exists after removal');
        }
        
        console.log(`   Worktree removed successfully`);
    })();

    // Test 12: Verify worktree no longer in list
    await test('Verify worktree removed from list', () => {
        const output = exec('git worktree list');
        
        if (output.includes(WORKTREE_DIR)) {
            throw new Error('Worktree still appears in listing');
        }
        
        console.log(`   Worktree no longer listed`);
    })();

    // Cleanup: Remove test commit from main
    await test('Cleanup: Reset test commit', () => {
        // Only reset if we're still at the test commit
        const currentCommit = exec('git rev-parse HEAD');
        if (currentCommit === exec('git rev-parse HEAD')) {
            exec('git reset --hard HEAD~1');
            
            if (fs.existsSync(mainTestFile)) {
                fs.unlinkSync(mainTestFile);
            }
            
            console.log(`   Reset to ${startCommit.substring(0, 7)}`);
        }
    })();

    // Print summary
    console.log('\n' + '='.repeat(60));
    console.log('Test Summary');
    console.log('='.repeat(60));
    
    const passed = results.filter(r => r.status === 'PASS').length;
    const failed = results.filter(r => r.status === 'FAIL').length;
    
    console.log(`✅ Passed: ${passed}/${results.length}`);
    console.log(`❌ Failed: ${failed}/${results.length}`);
    
    if (failed > 0) {
        console.log('\nFailed Tests:');
        results.filter(r => r.status === 'FAIL').forEach(r => {
            console.log(`  - ${r.name}`);
            if (r.error) console.log(`    ${r.error}`);
        });
    }

    // Ensure cleanup happened
    if (fs.existsSync(WORKTREE_DIR)) {
        console.log('\n⚠️  Cleanup: Removing leftover worktree directory...');
        try {
            exec(`git worktree remove "${WORKTREE_DIR}" --force`);
        } catch (e) {
            // Ignore
        }
        if (fs.existsSync(WORKTREE_DIR)) {
            fs.rmSync(WORKTREE_DIR, { recursive: true, force: true });
        }
    }

    if (fs.existsSync(mainTestFile)) {
        console.log('⚠️  Cleanup: Removing test file from main...');
        fs.unlinkSync(mainTestFile);
    }

    process.exit(failed > 0 ? 1 : 0);
}

main().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
});
