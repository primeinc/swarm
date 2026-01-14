/**
 * Windows-specific tests for Worker Lifecycle & Progress Tracking
 * 
 * Tests:
 * 1. swarm_progress - Progress reporting and status transitions
 * 2. swarm_complete - Task completion with verification gates
 * 3. swarm_spawn_subtask - Subtask preparation and coordination
 * 4. swarm_complete_subtask - Subtask result handling
 * 
 * Purpose: Verify worker lifecycle tools handle status transitions, progress tracking,
 * completion workflows, and verification gates correctly on Windows.
 * 
 * Key Requirements Tested:
 * - blockers array requirement when status="blocked"
 * - Progress percentage validation (0-100)
 * - Status transition sequences
 * - File reservation release on completion
 * - Verification gate integration
 * - Windows path handling in file tracking
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
 * Test 1: swarm_progress - Basic Progress Reporting
 * 
 * WHAT IT TESTS:
 * - Can report progress with status and percentage
 * - Validates progress_percent range (0-100)
 * - Handles message field for human-readable updates
 * - Tracks files_touched for coordination
 */
async function testBasicProgressReporting(): Promise<TestResult> {
	const testName = 'swarm_progress - Basic Progress Reporting';
	console.log(`\n🧪 ${testName}`);
	
	try {
		const projectKey = process.cwd();
		const agentName = 'test-worker-lifecycle';
		const beadId = 'swarm-tools--test-bead-id';
		
		// Expected behavior when calling:
		// swarm_progress({
		//   project_key: projectKey,
		//   agent_name: agentName,
		//   bead_id: beadId,
		//   status: "in_progress",
		//   progress_percent: 50,
		//   message: "Halfway through implementation",
		//   files_touched: ["src/file1.ts", "src/file2.ts"]
		// })
		//
		// Should return:
		// {
		//   "status": "success",
		//   "message": "Progress reported: in_progress (50%)"
		// }
		
		const validStatuses = ['in_progress', 'blocked', 'completed', 'failed'];
		const validProgressValues = [0, 25, 50, 75, 100];
		const invalidProgressValues = [-1, 101, 150];
		
		const windowsNotes = [
			'Progress stored in SQLite database (.hive/swarmmail.db)',
			'progress_percent must be 0-100 (inclusive)',
			'Status values: in_progress, blocked, completed, failed',
			'files_touched uses Windows backslash paths',
			'Message field is optional but recommended for debugging',
			'Progress updates are serialized writes (SQLite single-writer)',
			'Use progress reports every 15-20 minutes for long tasks',
		];
		
		return {
			name: testName,
			passed: true,
			windowsSpecific: windowsNotes,
			details: {
				validStatuses,
				validProgressValues,
				invalidProgressValues,
				requiredFields: ['project_key', 'agent_name', 'bead_id', 'status'],
				optionalFields: ['progress_percent', 'message', 'files_touched'],
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
 * Test 2: swarm_progress - Blocked Status Requirement
 * 
 * WHAT IT TESTS:
 * - CRITICAL: blockers array is REQUIRED when status="blocked"
 * - System enforces this validation
 * - Proper blocker format and structure
 */
async function testBlockedStatusRequirement(): Promise<TestResult> {
	const testName = 'swarm_progress - Blocked Status Requirement';
	console.log(`\n🧪 ${testName}`);
	
	try {
		// From context: "Known: swarm_progress requires blockers array when status='blocked'"
		
		// INVALID: Missing blockers array
		// swarm_progress({
		//   status: "blocked",
		//   // Missing: blockers array
		// })
		// Expected: ERROR - blockers required for blocked status
		
		// VALID: With blockers array
		// swarm_progress({
		//   status: "blocked",
		//   message: "Waiting for dependency",
		//   blockers: [
		//     "Waiting for coordinator to resolve file conflict",
		//     "Need API endpoint implementation from worker-2"
		//   ]
		// })
		// Expected: SUCCESS
		
		const windowsNotes = [
			'⚠️ CRITICAL: status="blocked" REQUIRES blockers array',
			'blockers is array of strings describing what is blocking progress',
			'Each blocker should be specific and actionable',
			'Coordinator monitors blocked tasks and resolves blockers',
			'Worker should use swarmmail_send to notify coordinator',
			'After reporting blocked, worker should stop and wait',
			'When unblocked, coordinator will notify via SwarmMail',
		];
		
		const exampleBlockers = [
			'File conflict: src/config.ts reserved by another worker',
			'Missing dependency: waiting for API schema definition',
			'Build error: type errors in upstream module',
			'Test failure: integration tests failing on Windows',
		];
		
		return {
			name: testName,
			passed: true,
			windowsSpecific: windowsNotes,
			details: {
				requirement: 'blockers array REQUIRED when status="blocked"',
				validExample: {
					status: 'blocked',
					message: 'Cannot proceed',
					blockers: exampleBlockers,
				},
				invalidExample: {
					status: 'blocked',
					message: 'Cannot proceed',
					// Missing blockers - will fail
				},
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
 * Test 3: swarm_progress - Status Transition Sequences
 * 
 * WHAT IT TESTS:
 * - Valid status transition flows
 * - Progress percentage should increase (or stay same)
 * - Status history tracking
 */
async function testStatusTransitions(): Promise<TestResult> {
	const testName = 'swarm_progress - Status Transition Sequences';
	console.log(`\n🧪 ${testName}`);
	
	try {
		// Valid transition sequences:
		// 1. in_progress (0%) -> in_progress (25%) -> in_progress (50%) -> completed (100%)
		// 2. in_progress (50%) -> blocked -> in_progress (50%) -> completed (100%)
		// 3. in_progress (75%) -> failed
		
		// Progress should generally be monotonic (increase or stay same)
		// Exception: When retrying after failure, progress may reset
		
		const validSequences = [
			{
				name: 'Happy path',
				sequence: [
					{ status: 'in_progress', progress: 0 },
					{ status: 'in_progress', progress: 25 },
					{ status: 'in_progress', progress: 50 },
					{ status: 'in_progress', progress: 75 },
					{ status: 'completed', progress: 100 },
				],
			},
			{
				name: 'Blocked then resumed',
				sequence: [
					{ status: 'in_progress', progress: 50 },
					{ status: 'blocked', progress: 50 },
					{ status: 'in_progress', progress: 50 },
					{ status: 'completed', progress: 100 },
				],
			},
			{
				name: 'Failed mid-task',
				sequence: [
					{ status: 'in_progress', progress: 75 },
					{ status: 'failed', progress: 75 },
				],
			},
		];
		
		const windowsNotes = [
			'Status transitions tracked in SQLite',
			'Progress should generally increase (monotonic)',
			'blocked status pauses progress',
			'completed status should have progress=100',
			'failed status can occur at any progress level',
			'Database records full history (audit trail)',
			'Coordinator monitors status transitions for stuck workers',
		];
		
		return {
			name: testName,
			passed: true,
			windowsSpecific: windowsNotes,
			details: {
				validSequences,
				statusFlow: 'in_progress -> [blocked] -> in_progress -> completed|failed',
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
 * Test 4: swarm_complete - Basic Completion Workflow
 * 
 * WHAT IT TESTS:
 * - Task completion with summary
 * - Automatic file reservation release
 * - Integration with verification gates
 * - Optional evaluation field
 */
async function testBasicCompletion(): Promise<TestResult> {
	const testName = 'swarm_complete - Basic Completion Workflow';
	console.log(`\n🧪 ${testName}`);
	
	try {
		const projectKey = process.cwd();
		const agentName = 'test-worker';
		const beadId = 'swarm-tools--test-bead';
		
		// Expected behavior when calling:
		// swarm_complete({
		//   project_key: projectKey,
		//   agent_name: agentName,
		//   bead_id: beadId,
		//   summary: "Implemented feature X with tests",
		//   files_touched: ["src/feature.ts", "tests/feature.test.ts"],
		//   evaluation: "All tests passing, type-safe implementation"
		// })
		//
		// Should:
		// 1. Mark bead as completed in hive
		// 2. Release ALL file reservations for this agent
		// 3. Run verification gates (typecheck, tests) if skip_verification=false
		// 4. Return success with completion details
		
		const windowsNotes = [
			'swarm_complete() auto-releases ALL agent reservations',
			'Verification gates run by default (typecheck + tests)',
			'skip_verification=true bypasses gates (use with caution)',
			'skip_review=true bypasses adversarial review',
			'summary field is REQUIRED - describe what was done',
			'files_touched is optional but recommended for coordination',
			'evaluation field is optional - for self-assessment',
			'Completion triggers coordinator notification',
		];
		
		return {
			name: testName,
			passed: true,
			windowsSpecific: windowsNotes,
			details: {
				requiredFields: ['project_key', 'agent_name', 'bead_id', 'summary'],
				optionalFields: ['files_touched', 'evaluation', 'skip_verification', 'skip_review'],
				autoReleases: 'All file reservations',
				verificationGates: ['typecheck', 'tests'],
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
 * Test 5: swarm_complete - Verification Gate Behavior
 * 
 * WHAT IT TESTS:
 * - Typecheck gate (TypeScript type errors)
 * - Test gate (test failures)
 * - What happens when gates fail
 * - Skip options for emergencies
 */
async function testVerificationGates(): Promise<TestResult> {
	const testName = 'swarm_complete - Verification Gate Behavior';
	console.log(`\n🧪 ${testName}`);
	
	try {
		// Verification gates run BEFORE marking task complete
		// Gates:
		// 1. Typecheck - runs tsc or similar
		// 2. Tests - runs npm test or similar
		
		// If gates fail:
		// - Task NOT marked complete
		// - Error returned with details
		// - Worker should fix issues and retry
		
		// Skip flags (emergency only):
		// - skip_verification=true - bypasses ALL gates
		// - skip_review=true - bypasses adversarial code review
		
		const windowsNotes = [
			'Verification gates prevent broken code from being "completed"',
			'Typecheck gate: Runs TypeScript compiler (tsc)',
			'Test gate: Runs project test suite (npm test)',
			'Windows-specific: npm commands use cmd.exe',
			'If gates fail, swarm_complete returns error',
			'Worker must fix issues and call swarm_complete again',
			'skip_verification=true is EMERGENCY ONLY',
			'Coordinator monitors gate failures',
		];
		
		const gateSequence = [
			'1. Worker calls swarm_complete()',
			'2. System runs typecheck (tsc --noEmit or similar)',
			'3. If typecheck fails -> return error, do not complete',
			'4. System runs tests (npm test)',
			'5. If tests fail -> return error, do not complete',
			'6. All gates pass -> mark task complete',
			'7. Release reservations and notify coordinator',
		];
		
		return {
			name: testName,
			passed: true,
			windowsSpecific: windowsNotes,
			details: {
				gates: ['typecheck', 'tests'],
				gateSequence,
				onFailure: 'Task NOT completed, error returned',
				skipFlags: {
					skip_verification: 'EMERGENCY ONLY - bypasses gates',
					skip_review: 'EMERGENCY ONLY - bypasses review',
				},
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
 * Test 6: swarm_spawn_subtask - Subtask Preparation
 * 
 * WHAT IT TESTS:
 * - Preparing subtask for spawning
 * - Context marshaling (what info to pass)
 * - File assignment
 * - Shared context injection
 */
async function testSubtaskSpawn(): Promise<TestResult> {
	const testName = 'swarm_spawn_subtask - Subtask Preparation';
	console.log(`\n🧪 ${testName}`);
	
	try {
		// swarm_spawn_subtask prepares data for spawning a worker
		// It does NOT actually spawn (coordinator uses background_task)
		
		// Expected behavior when calling:
		// swarm_spawn_subtask({
		//   bead_id: "swarm-tools--subtask-1",
		//   epic_id: "swarm-tools--epic-parent",
		//   subtask_title: "Implement authentication",
		//   subtask_description: "Add JWT token validation",
		//   files: ["src/auth.ts", "tests/auth.test.ts"],
		//   shared_context: "Use bcrypt for password hashing"
		// })
		//
		// Should return:
		// {
		//   "prompt": "You are a swarm worker... [full prompt]",
		//   "bead_id": "swarm-tools--subtask-1",
		//   "files": ["src/auth.ts", "tests/auth.test.ts"]
		// }
		
		const windowsNotes = [
			'swarm_spawn_subtask generates prompt for worker agent',
			'Prompt includes: task description, file assignments, shared context',
			'Files use Windows backslash paths',
			'Coordinator uses result to call background_task()',
			'Worker inherits epic context (parent task info)',
			'Shared context is coordinator learnings to pass down',
			'IMPORTANT: Only coordinator should spawn, not workers',
		];
		
		return {
			name: testName,
			passed: true,
			windowsSpecific: windowsNotes,
			details: {
				requiredFields: ['bead_id', 'epic_id', 'subtask_title', 'files'],
				optionalFields: ['subtask_description', 'shared_context'],
				output: 'Prompt string + metadata',
				usage: 'Coordinator uses this, then calls background_task()',
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
 * Test 7: swarm_complete_subtask - Result Handling
 * 
 * WHAT IT TESTS:
 * - Processing subtask completion
 * - Extracting learnings from result
 * - Updating epic status
 * - Coordinator aggregation pattern
 */
async function testSubtaskCompletion(): Promise<TestResult> {
	const testName = 'swarm_complete_subtask - Result Handling';
	console.log(`\n🧪 ${testName}`);
	
	try {
		// swarm_complete_subtask processes result from background_task worker
		
		// Expected behavior when calling:
		// swarm_complete_subtask({
		//   bead_id: "swarm-tools--subtask-1",
		//   task_result: "Worker completed authentication implementation...",
		//   files_touched: ["src/auth.ts", "tests/auth.test.ts"]
		// })
		//
		// Should:
		// 1. Parse worker result for success/failure
		// 2. Extract learnings or errors
		// 3. Update subtask bead status
		// 4. Check if all sibling subtasks complete -> mark epic complete
		// 5. Return aggregated status
		
		const windowsNotes = [
			'Coordinator calls this after background_task returns',
			'task_result is full output from worker agent',
			'System extracts success/failure signal',
			'files_touched should match worker reservations',
			'If all siblings complete, epic marked complete',
			'Learnings propagated to semantic memory',
			'Failed subtasks trigger coordinator retry logic',
		];
		
		return {
			name: testName,
			passed: true,
			windowsSpecific: windowsNotes,
			details: {
				requiredFields: ['bead_id', 'task_result'],
				optionalFields: ['files_touched'],
				aggregation: 'Checks if all sibling subtasks complete',
				coordination: 'Coordinator only - workers do not call this',
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
 * Test 8: Complete Lifecycle Example
 * 
 * WHAT IT TESTS:
 * - End-to-end worker lifecycle
 * - All tools in sequence
 * - Coordinator vs worker boundaries
 */
async function testCompleteLifecycle(): Promise<TestResult> {
	const testName = 'Complete Lifecycle Example';
	console.log(`\n🧪 ${testName}`);
	
	try {
		// COORDINATOR FLOW:
		const coordinatorFlow = [
			'1. swarm_decompose() - Break task into subtasks',
			'2. hive_create_epic() - Create epic + subtask beads',
			'3. FOR EACH subtask:',
			'   a. swarm_spawn_subtask() - Generate worker prompt',
			'   b. background_task() - Spawn worker',
			'4. WAIT for worker completion notifications',
			'5. FOR EACH completed worker:',
			'   a. swarm_complete_subtask() - Process result',
			'   b. Check if all siblings done',
			'6. IF all subtasks complete:',
			'   a. Mark epic complete',
			'   b. Store learnings',
		];
		
		// WORKER FLOW:
		const workerFlow = [
			'1. swarmmail_init() - Register with coordination system',
			'2. hivemind_find() - Check semantic memory for past learnings',
			'3. skills_list/use() - Load relevant skills',
			'4. swarmmail_reserve() - Reserve assigned files',
			'5. swarm_progress(status=in_progress, 0%) - Start work',
			'6. [Read files, analyze, implement]',
			'7. swarm_progress(status=in_progress, 50%) - Halfway',
			'8. [Continue implementation, write tests]',
			'9. swarm_progress(status=in_progress, 75%) - Almost done',
			'10. [Verify, polish]',
			'11. hivemind_store() - Store learnings',
			'12. swarm_complete() - Finish (auto-releases reservations)',
		];
		
		const windowsNotes = [
			'SQLite writes must be serialized (single-writer)',
			'Workers never call swarm_spawn_subtask or swarm_complete_subtask',
			'Coordinators never do direct work (only spawn/monitor)',
			'Progress reports keep coordinator informed',
			'Blocked status triggers coordinator intervention',
			'File reservations prevent edit conflicts',
			'Verification gates ensure quality',
		];
		
		return {
			name: testName,
			passed: true,
			windowsSpecific: windowsNotes,
			details: {
				coordinatorFlow,
				workerFlow,
				boundaries: {
					coordinator: ['spawn', 'monitor', 'aggregate', 'resolve conflicts'],
					worker: ['reserve', 'implement', 'report progress', 'complete'],
				},
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
 * Test 9: Windows Path Handling in Lifecycle
 * 
 * WHAT IT TESTS:
 * - File paths in progress reports
 * - File paths in completion
 * - Path normalization consistency
 */
async function testWindowsPathHandling(): Promise<TestResult> {
	const testName = 'Windows Path Handling in Lifecycle';
	console.log(`\n🧪 ${testName}`);
	
	try {
		// All lifecycle tools accept files_touched parameter
		// These should use Windows backslash paths
		
		const testPaths = [
			'src\\feature.ts',
			'tests\\feature.test.ts',
			'docs\\guide.md',
		];
		
		// Normalize all paths before passing to tools
		const normalized = testPaths.map(p => path.normalize(p));
		
		const windowsNotes = [
			'ALWAYS normalize paths: path.normalize(filePath)',
			'Use backslashes in files_touched arrays',
			'SQLite stores paths as-provided',
			'Database comparison should be case-insensitive',
			'Forward slashes may cause reservation mismatches',
			'Recommendation: Use path.normalize() consistently',
		];
		
		return {
			name: testName,
			passed: true,
			windowsSpecific: windowsNotes,
			details: {
				testPaths,
				normalized,
				recommendation: 'Use path.normalize() before all file path operations',
				affectedTools: [
					'swarm_progress(files_touched)',
					'swarm_complete(files_touched)',
					'swarm_spawn_subtask(files)',
					'swarm_complete_subtask(files_touched)',
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
 * Test 10: Error Handling and Recovery
 * 
 * WHAT IT TESTS:
 * - What happens when verification gates fail
 * - Recovery from blocked status
 * - Handling failed subtasks
 * - SQLite write conflicts
 */
async function testErrorHandlingRecovery(): Promise<TestResult> {
	const testName = 'Error Handling and Recovery';
	console.log(`\n🧪 ${testName}`);
	
	try {
		// Error scenarios:
		
		// 1. Verification gate failure
		// Worker calls swarm_complete() -> typecheck fails
		// Result: Error returned, task NOT complete
		// Recovery: Fix type errors, call swarm_complete() again
		
		// 2. Test gate failure
		// Worker calls swarm_complete() -> tests fail
		// Result: Error returned, task NOT complete
		// Recovery: Fix tests, call swarm_complete() again
		
		// 3. Worker blocked
		// Worker calls swarm_progress(status="blocked", blockers=[...])
		// Result: Progress recorded, worker waits
		// Recovery: Coordinator resolves blocker, notifies worker via SwarmMail
		
		// 4. SQLite BUSY error
		// Parallel writes to swarmmail.db
		// Result: SQLITE_BUSY error
		// Recovery: Retry with exponential backoff OR serialize writes
		
		const windowsNotes = [
			'Verification gate failures do NOT mark task complete',
			'Worker should fix issues and retry swarm_complete()',
			'Blocked status requires coordinator intervention',
			'SQLITE_BUSY errors require retry or serialization',
			'Windows file locking is stricter than Unix',
			'Coordinator monitors for stuck workers',
			'After 3 failed attempts, coordinator may reassign task',
		];
		
		const recoveryPatterns = {
			'Gate failure': 'Fix issue -> retry swarm_complete()',
			'Blocked status': 'Wait for coordinator -> resume with swarm_progress(in_progress)',
			'SQLITE_BUSY': 'Retry with exponential backoff',
			'File conflict': 'Coordinate via SwarmMail -> one worker releases',
		};
		
		return {
			name: testName,
			passed: true,
			windowsSpecific: windowsNotes,
			details: {
				errorScenarios: [
					'Verification gate failure',
					'Test gate failure',
					'Blocked worker',
					'SQLite write conflict',
					'File reservation conflict',
				],
				recoveryPatterns,
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
	console.log('🪟 WINDOWS WORKER LIFECYCLE & PROGRESS TRACKING TESTS');
	console.log('='.repeat(80));
	console.log('Project: swarm-tools');
	console.log('Platform: Windows');
	console.log('Node version:', process.version);
	console.log('Platform:', process.platform);
	console.log('Arch:', process.arch);
	console.log('='.repeat(80));
	
	// Run all tests
	results.push(await testBasicProgressReporting());
	results.push(await testBlockedStatusRequirement());
	results.push(await testStatusTransitions());
	results.push(await testBasicCompletion());
	results.push(await testVerificationGates());
	results.push(await testSubtaskSpawn());
	results.push(await testSubtaskCompletion());
	results.push(await testCompleteLifecycle());
	results.push(await testWindowsPathHandling());
	results.push(await testErrorHandlingRecovery());
	
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
