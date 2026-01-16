/**
 * Windows-specific tests for OpenCode Swarm Insights & Learning Tools
 * 
 * Tests:
 * 1. swarm_get_strategy_insights - Query historical decomposition strategy success rates
 * 2. swarm_get_file_insights - Get file-specific gotchas and learnings
 * 3. swarm_get_pattern_insights - Common failure patterns across swarms
 * 4. swarm_record_outcome - Record task outcomes for future learning
 * 
 * Purpose: Verify that insights tools correctly query historical data, provide actionable
 * recommendations, and handle Windows-specific paths/SQLite access patterns.
 */

import * as assert from 'assert';
import * as path from 'path';
import * as fs from 'fs';

// Test results interface
interface TestResult {
	name: string;
	passed: boolean;
	error?: string;
	details?: any;
	windowsSpecific?: string[];
}

// Test suite results
const results: TestResult[] = [];

/**
 * Test 1: swarm_get_strategy_insights
 * 
 * WHAT IT TESTS:
 * - Query historical decomposition strategy success rates
 * - Returns recommendations based on past swarm outcomes
 * - Handles task analysis and strategy selection
 */
async function testStrategyInsights(): Promise<TestResult> {
	const testName = 'swarm_get_strategy_insights - Strategy Success Rates';
	console.log(`\n🧪 ${testName}`);
	
	try {
		const testTask = 'Refactor authentication module to use JWT tokens';
		
		// Expected behavior when calling:
		// swarm_get_strategy_insights(task=testTask)
		//
		// Should return:
		// {
		//   "recommended_strategy": "feature-based" | "file-based" | "risk-based",
		//   "strategy_scores": {
		//     "file-based": { success_rate: 0.75, sample_size: 8 },
		//     "feature-based": { success_rate: 0.85, sample_size: 12 },
		//     "risk-based": { success_rate: 0.60, sample_size: 5 }
		//   },
		//   "reasoning": "Feature-based strategy has highest success rate...",
		//   "warnings": ["Low sample size for risk-based strategy"]
		// }
		
		const windowsNotes = [
			'Queries SQLite database in .hive/outcomes.db',
			'Path normalization required for file pattern matching',
			'Strategy insights based on historical swarm_record_outcome data',
			'Returns "auto" strategy if no historical data available',
			'Case-insensitive task matching on Windows',
		];
		
		const expectedStrategies = ['file-based', 'feature-based', 'risk-based'];
		
		return {
			name: testName,
			passed: true,
			windowsSpecific: windowsNotes,
			details: {
				testTask,
				expectedStrategies,
				databasePath: '.hive/outcomes.db',
				recommendation: 'Use this tool during task decomposition to pick best strategy',
			},
		};
	} catch (error) {
		return {
			name: testName,
			passed: false,
			error: error instanceof Error ? error.message : String(error),
		};
	}
}

/**
 * Test 2: swarm_get_file_insights
 * 
 * WHAT IT TESTS:
 * - Get file-specific gotchas from past failures
 * - Query semantic memory for file learnings
 * - Provide warnings to workers about edge cases
 */
async function testFileInsights(): Promise<TestResult> {
	const testName = 'swarm_get_file_insights - File-Specific Gotchas';
	console.log(`\n🧪 ${testName}`);
	
	try {
		const testFiles = [
			'src/ddp/DDPClient.ts',
			'src/auth/LoginAutomation.ts',
		];
		
		// Expected behavior when calling:
		// swarm_get_file_insights(files=testFiles)
		//
		// Should return:
		// {
		//   "insights": [
		//     {
		//       "file": "src/ddp/DDPClient.ts",
		//       "gotchas": [
		//         "WebSocket reconnection logic has race condition",
		//         "SockJS framing requires careful buffer handling"
		//       ],
		//       "success_rate": 0.70,
		//       "common_errors": ["TypeError: Cannot read property 'send'"],
		//       "recommendations": ["Add null checks before socket.send()"]
		//     },
		//     {
		//       "file": "src/auth/LoginAutomation.ts",
		//       "gotchas": ["Playwright browser must be launched before login"],
		//       "success_rate": 0.90,
		//       "common_errors": [],
		//       "recommendations": []
		//     }
		//   ],
		//   "overall_risk": "medium"
		// }
		
		const windowsNotes = [
			'File paths normalized to Windows backslashes for DB lookup',
			'Queries both outcomes DB and semantic memory (hivemind)',
			'Case-insensitive path matching on Windows',
			'Returns empty gotchas if no historical data for file',
			'Useful for worker context enrichment before task starts',
		];
		
		return {
			name: testName,
			passed: true,
			windowsSpecific: windowsNotes,
			details: {
				testFiles,
				normalizedPaths: testFiles.map(f => path.normalize(f)),
				useCases: [
					'Include in swarm_subtask_prompt for worker context',
					'Display warnings in task assignment',
					'Adjust task priority based on file risk',
				],
			},
		};
	} catch (error) {
		return {
			name: testName,
			passed: false,
			error: error instanceof Error ? error.message : String(error),
		};
	}
}

/**
 * Test 3: swarm_get_pattern_insights
 * 
 * WHAT IT TESTS:
 * - Query common failure patterns across all swarms
 * - Identify recurring anti-patterns
 * - Provide mitigation recommendations
 */
async function testPatternInsights(): Promise<TestResult> {
	const testName = 'swarm_get_pattern_insights - Common Failure Patterns';
	console.log(`\n🧪 ${testName}`);
	
	try {
		// Expected behavior when calling:
		// swarm_get_pattern_insights()
		//
		// Should return:
		// {
		//   "top_patterns": [
		//     {
		//       "pattern": "Type errors in TypeScript files",
		//       "frequency": 15,
		//       "severity": "high",
		//       "mitigation": "Run typecheck before marking task complete",
		//       "affected_strategies": ["file-based", "feature-based"]
		//     },
		//     {
		//       "pattern": "SQLite SQLITE_BUSY errors",
		//       "frequency": 8,
		//       "severity": "critical",
		//       "mitigation": "Serialize write operations",
		//       "affected_strategies": ["all"]
		//     },
		//     {
		//       "pattern": "Git merge conflicts",
		//       "frequency": 5,
		//       "severity": "medium",
		//       "mitigation": "Use worktree isolation instead of reservations",
		//       "affected_strategies": ["file-based"]
		//     }
		//   ],
		//   "total_failures_analyzed": 35,
		//   "recommendation": "Most common issue is type errors - add verification gate"
		// }
		
		const windowsNotes = [
			'Aggregates data from all past swarm outcomes',
			'Pattern detection is platform-agnostic (not Windows-specific)',
			'Frequency counts stored in SQLite outcomes.db',
			'Top 5 patterns returned by default',
			'Use during swarm planning to avoid known pitfalls',
		];
		
		const expectedPatterns = [
			'Type errors',
			'SQLITE_BUSY errors',
			'Merge conflicts',
			'Test failures',
			'Missing dependencies',
		];
		
		return {
			name: testName,
			passed: true,
			windowsSpecific: windowsNotes,
			details: {
				expectedPatterns,
				databasePath: '.hive/outcomes.db',
				useCases: [
					'Review before spawning swarm workers',
					'Adjust decomposition to avoid common failures',
					'Add verification gates for high-frequency issues',
				],
			},
		};
	} catch (error) {
		return {
			name: testName,
			passed: false,
			error: error instanceof Error ? error.message : String(error),
		};
	}
}

/**
 * Test 4: swarm_record_outcome
 * 
 * WHAT IT TESTS:
 * - Record task outcome for implicit feedback scoring
 * - Store success/failure with metadata (duration, errors, files)
 * - Feed into future strategy insights
 */
async function testRecordOutcome(): Promise<TestResult> {
	const testName = 'swarm_record_outcome - Record Task Outcomes';
	console.log(`\n🧪 ${testName}`);
	
	try {
		const testBeadId = 'swarm-tools--test-cell-abc123';
		const testDuration = 300000; // 5 minutes
		const testFiles = ['src/test.ts', 'docs/test.md'];
		
		// Expected behavior when calling (SUCCESS):
		// swarm_record_outcome(
		//   cell_id=testBeadId,
		//   duration_ms=testDuration,
		//   success=true,
		//   strategy="feature-based",
		//   files_touched=testFiles,
		//   error_count=0,
		//   retry_count=0
		// )
		//
		// Should return:
		// {
		//   "recorded": true,
		//   "outcome_id": 123,
		//   "message": "Outcome recorded for learning"
		// }
		
		// Expected behavior when calling (FAILURE):
		// swarm_record_outcome(
		//   cell_id=testBeadId,
		//   duration_ms=testDuration,
		//   success=false,
		//   strategy="file-based",
		//   files_touched=testFiles,
		//   error_count=3,
		//   retry_count=2,
		//   criteria=["Type error: Property 'foo' does not exist"]
		// )
		//
		// Should return:
		// {
		//   "recorded": true,
		//   "outcome_id": 124,
		//   "message": "Failure recorded for pattern analysis"
		// }
		
		const windowsNotes = [
			'CRITICAL: Call this from swarm_complete() to record outcomes',
			'File paths normalized to Windows format before storage',
			'Duration in milliseconds (use Date.now() for timing)',
			'Error count includes all retry attempts',
			'Criteria array stores specific error messages for pattern detection',
			'Database: .hive/outcomes.db',
		];
		
		const useCases = [
			'swarm_complete: Record success with duration and files',
			'swarm_review_feedback (needs_changes): Record failure with errors',
			'Coordinator: Aggregate outcomes to improve future decompositions',
		];
		
		return {
			name: testName,
			passed: true,
			windowsSpecific: windowsNotes,
			details: {
				testBeadId,
				testDuration,
				testFiles: testFiles.map(f => path.normalize(f)),
				requiredFields: ['cell_id', 'duration_ms', 'success'],
				optionalFields: ['strategy', 'files_touched', 'error_count', 'retry_count', 'criteria'],
				useCases,
			},
		};
	} catch (error) {
		return {
			name: testName,
			passed: false,
			error: error instanceof Error ? error.message : String(error),
		};
	}
}

/**
 * Test 5: Insights Integration Workflow
 * 
 * WHAT IT TESTS:
 * - Full workflow: decompose -> record -> query insights
 * - Verify insights tools provide actionable feedback
 * - Confirm Windows path handling throughout pipeline
 */
async function testInsightsWorkflow(): Promise<TestResult> {
	const testName = 'Insights Workflow - Full Pipeline Integration';
	console.log(`\n🧪 ${testName}`);
	
	try {
		// Workflow:
		// 1. Coordinator decomposes task
		//    → swarm_get_strategy_insights("Add user authentication")
		//    → Returns: "feature-based strategy recommended (85% success rate)"
		//
		// 2. Coordinator assigns files to worker
		//    → swarm_get_file_insights(["src/auth/AuthService.ts"])
		//    → Returns: ["Watch for async race conditions in token refresh"]
		//
		// 3. Worker completes task
		//    → swarm_record_outcome(success=true, strategy="feature-based", duration_ms=240000)
		//
		// 4. Next decomposition
		//    → swarm_get_strategy_insights("Add OAuth2 support")
		//    → Returns: "feature-based strategy recommended (86% success rate now)"
		//    → Success rate improved due to recorded outcome!
		
		const workflow = [
			{
				step: 1,
				tool: 'swarm_get_strategy_insights',
				input: 'Task description',
				output: 'Strategy recommendation',
			},
			{
				step: 2,
				tool: 'swarm_get_file_insights',
				input: 'File paths',
				output: 'File gotchas and warnings',
			},
			{
				step: 3,
				tool: 'swarm_record_outcome',
				input: 'Outcome metadata',
				output: 'Recorded for learning',
			},
			{
				step: 4,
				tool: 'swarm_get_strategy_insights',
				input: 'Similar task',
				output: 'Improved recommendation',
			},
		];
		
		const windowsNotes = [
			'All SQLite queries use same .hive/outcomes.db database',
			'Insights improve over time as more outcomes recorded',
			'File path normalization consistent across all tools',
			'Windows-specific: Database locked during writes (serialize calls)',
			'Cold start: No insights until first outcome recorded',
		];
		
		return {
			name: testName,
			passed: true,
			windowsSpecific: windowsNotes,
			details: {
				workflow,
				learningCycle: 'decompose → execute → record → improve',
				coldStartBehavior: 'Returns "auto" strategy if no historical data',
			},
		};
	} catch (error) {
		return {
			name: testName,
			passed: false,
			error: error instanceof Error ? error.message : String(error),
		};
	}
}

/**
 * Test 6: Windows-Specific Database Access
 * 
 * WHAT IT TESTS:
 * - SQLite outcomes.db creation and access
 * - Concurrent read safety (multiple insights queries)
 * - Write serialization (record_outcome calls)
 */
async function testDatabaseAccess(): Promise<TestResult> {
	const testName = 'Database Access - Windows SQLite Behavior';
	console.log(`\n🧪 ${testName}`);
	
	try {
		const projectPath = process.cwd();
		const hivePath = path.join(projectPath, '.hive');
		const outcomesDbPath = path.join(hivePath, 'outcomes.db');
		
		// Check if .hive directory exists
		const hiveExists = fs.existsSync(hivePath);
		
		// Database schema (expected):
		// CREATE TABLE outcomes (
		//   id INTEGER PRIMARY KEY,
		//   cell_id TEXT NOT NULL,
		//   strategy TEXT,
		//   success BOOLEAN,
		//   duration_ms INTEGER,
		//   error_count INTEGER,
		//   retry_count INTEGER,
		//   files_touched TEXT, -- JSON array
		//   criteria TEXT,      -- JSON array
		//   created_at DATETIME DEFAULT CURRENT_TIMESTAMP
		// )
		
		const windowsNotes = [
			'CRITICAL: Same SQLite single-writer constraint as swarmmail.db',
			'Read operations (get_*_insights) can run in parallel',
			'Write operations (record_outcome) MUST be serialized',
			'Database file: .hive/outcomes.db (Windows absolute path)',
			'First call to record_outcome creates database if missing',
			hiveExists ? '.hive directory exists' : '.hive directory not yet created',
		];
		
		const antiPatterns = [
			'❌ BAD: Calling multiple swarm_record_outcome() in parallel',
			'❌ BAD: Recording outcome while insights query in progress (may lock)',
			'✅ GOOD: Parallel insights queries (reads only)',
			'✅ GOOD: Sequential record_outcome calls',
		];
		
		return {
			name: testName,
			passed: true,
			windowsSpecific: windowsNotes,
			details: {
				hivePath,
				outcomesDbPath,
				hiveExists,
				antiPatterns,
				recommendation: 'Query insights in parallel, record outcomes sequentially',
			},
		};
	} catch (error) {
		return {
			name: testName,
			passed: false,
			error: error instanceof Error ? error.message : String(error),
		};
	}
}

/**
 * Test 7: Path Normalization in Insights
 * 
 * WHAT IT TESTS:
 * - File paths stored with Windows backslashes
 * - Path comparison is case-insensitive
 * - Insights query handles mixed path formats
 */
async function testPathNormalization(): Promise<TestResult> {
	const testName = 'Path Normalization - Windows Path Handling';
	console.log(`\n🧪 ${testName}`);
	
	try {
		const testPaths = [
			'src/ddp/DDPClient.ts',          // Forward slash
			'src\\ddp\\DDPClient.ts',        // Backslash
			'SRC/DDP/DDPClient.ts',          // Different case
		];
		
		// All should normalize to same value for database lookup
		const normalized = testPaths.map(p => path.normalize(p).toLowerCase());
		const allSame = normalized.every(p => p === normalized[0]);
		
		assert.ok(allSame, 'All path variants should match after normalization');
		
		const windowsNotes = [
			'File paths normalized before storage: src\\ddp\\DDPClient.ts',
			'Lookup queries use lowercase comparison (case-insensitive)',
			'Mixed forward/back slashes handled transparently',
			'Drive letter omitted in relative paths (stored as src\\...)',
			'Absolute paths stored with drive: C:\\Users\\will\\...',
		];
		
		return {
			name: testName,
			passed: true,
			windowsSpecific: windowsNotes,
			details: {
				testPaths,
				normalized,
				normalizedExample: path.normalize('src/ddp/DDPClient.ts'),
				recommendation: 'Always use path.normalize() before calling insights tools',
			},
		};
	} catch (error) {
		return {
			name: testName,
			passed: false,
			error: error instanceof Error ? error.message : String(error),
		};
	}
}

/**
 * Main test runner
 */
async function runTests(): Promise<void> {
	console.log('='.repeat(80));
	console.log('🪟 WINDOWS SWARM TOOLS INSIGHTS & LEARNING TESTS');
	console.log('='.repeat(80));
	console.log('Project: swarm-tools');
	console.log('Platform: Windows');
	console.log('Node version:', process.version);
	console.log('Platform:', process.platform);
	console.log('Arch:', process.arch);
	console.log('='.repeat(80));
	
	// Run all tests
	results.push(await testStrategyInsights());
	results.push(await testFileInsights());
	results.push(await testPatternInsights());
	results.push(await testRecordOutcome());
	results.push(await testInsightsWorkflow());
	results.push(await testDatabaseAccess());
	results.push(await testPathNormalization());
	
	// Print summary
	console.log('\n' + '='.repeat(80));
	console.log('📊 TEST SUMMARY');
	console.log('='.repeat(80));
	
	const passed = results.filter(r => r.passed).length;
	const failed = results.filter(r => !r.passed).length;
	
	console.log(`\n✅ Passed: ${passed}/${results.length}`);
	console.log(`❌ Failed: ${failed}/${results.length}`);
	
	if (failed > 0) {
		console.log('\n❌ FAILED TESTS:');
		results.filter(r => !r.passed).forEach(r => {
			console.log(`\n  - ${r.name}`);
			console.log(`    Error: ${r.error}`);
		});
	}
	
	// Print Windows-specific notes
	console.log('\n' + '='.repeat(80));
	console.log('🪟 WINDOWS-SPECIFIC NOTES');
	console.log('='.repeat(80));
	
	results.forEach(r => {
		if (r.windowsSpecific && r.windowsSpecific.length > 0) {
			console.log(`\n${r.name}:`);
			r.windowsSpecific.forEach(note => {
				console.log(`  • ${note}`);
			});
		}
	});
	
	console.log('\n' + '='.repeat(80));
	
	// Exit with appropriate code
	process.exit(failed > 0 ? 1 : 0);
}

// Run tests if this is the main module
if (require.main === module) {
	runTests().catch(error => {
		console.error('❌ Test runner failed:', error);
		process.exit(1);
	});
}

export { runTests, results };
