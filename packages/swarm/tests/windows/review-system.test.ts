/**
 * Unit tests for Test Review & Evaluation System
 * 
 * Tests the core functionality:
 * - Document parsing
 * - Quality metric calculation
 * - Gap analysis
 * - Report generation
 */

import * as assert from 'assert';
import * as path from 'path';
import * as fs from 'fs';
import { 
	TestDocumentParser,
	QualityEvaluator,
	GapAnalyzer,
	TestReviewer,
	TestDocument,
	QualityMetrics,
} from './review-system';

// ============================================================================
// TEST DATA
// ============================================================================

const MOCK_DOC_EXCELLENT = `# Windows Testing: Core Initialization & Health Tools

**Platform:** Windows 11  
**Node Version:** v22.21.1  
**Test Date:** 2026-01-13  
**Test Status:** ✅ ALL TESTS PASSED

---

## Overview

This document covers testing results for the OpenCode swarm-tools plugin.

## Tools Tested

1. ✅ **swarmmail_init** - Initialize coordination system
2. ✅ **swarm_init** - Initialize swarm session
3. ✅ **swarmmail_health** - Database health check
4. ✅ **swarmmail_reserve** - File reservation

---

## 1. swarmmail_init - Coordination System Initialization

### Purpose
Registers an agent with the coordination system.

### Windows Test Results

#### ✅ Test: Basic Initialization
**Status:** PASS

**Command:**
\`\`\`typescript
swarmmail_init(
  agent_name: "worker-init-test",
  project_path: process.cwd().replace(/\\/g, "\\\\"),
  task_description: "Test Core Initialization & Health Tools"
)
\`\`\`

**Actual Response:**
\`\`\`json
{
  "agent_name": "worker-init-test",
  "project_key": process.cwd().replace(/\\/g, "\\\\"),
  "message": "Initialized as worker-init-test"
}
\`\`\`

### Windows-Specific Behaviors

#### 🪟 Path Normalization
| Input Format | Normalized Output | Valid? |
|--------------|-------------------|--------|
| \`C:\\Users\\will\\dev\\swarm-tools\` | \`C:\\Users\\will\\dev\\swarm-tools\` | ✅ YES (preferred) |

#### 🪟 Database Location
\`\`\`
Project Root: C:\\Users\\will\\dev\\swarm-tools
Database:     C:\\Users\\will\\dev\\swarm-tools\\.hive\\swarmmail.db
\`\`\`

### Known Issues
**None detected.** Initialization works reliably on Windows.

---

## Summary: Windows Compatibility

### ✅ What Works
| Feature | Status | Notes |
|---------|--------|-------|
| swarmmail_init | ✅ PASS | Path normalization works |
| swarm_init | ✅ PASS | Recommended for Windows |

### ⚠️ Known Limitations

1. **SQLite Single-Writer Constraint**
   - **Impact:** Parallel writes fail with SQLITE_BUSY
   - **Severity:** CRITICAL

### 🎯 Recommendations

1. **Use Reservation Isolation on Windows**
   - Simpler than worktrees
   - Works on non-git projects
`;

const MOCK_DOC_POOR = `# Windows Testing: Incomplete

**Platform:** Windows 11  

## Overview

Some tests.

### ❌ Test: Failed Test
**Status:** FAIL
`;

// ============================================================================
// TEST HELPERS
// ============================================================================

function createTempDoc(content: string, filename: string): string {
	const tempDir = path.join(__dirname, 'temp-test-docs');
	if (!fs.existsSync(tempDir)) {
		fs.mkdirSync(tempDir, { recursive: true });
	}
	const filePath = path.join(tempDir, filename);
	fs.writeFileSync(filePath, content, 'utf-8');
	return filePath;
}

function cleanupTempDocs(): void {
	const tempDir = path.join(__dirname, 'temp-test-docs');
	if (fs.existsSync(tempDir)) {
		fs.rmSync(tempDir, { recursive: true, force: true });
	}
}

// ============================================================================
// TESTS
// ============================================================================

describe('TestDocumentParser', () => {
	afterEach(() => {
		cleanupTempDocs();
	});
	
	it('should parse metadata from header', () => {
		const filePath = createTempDoc(MOCK_DOC_EXCELLENT, 'test-excellent.md');
		const doc = TestDocumentParser.parse(filePath);
		
		assert.strictEqual(doc.title, 'Windows Testing: Core Initialization & Health Tools');
		assert.strictEqual(doc.platform, 'Windows 11');
		assert.strictEqual(doc.nodeVersion, 'v22.21.1');
		assert.strictEqual(doc.testDate, '2026-01-13');
		assert.strictEqual(doc.overallStatus, 'PASS');
	});
	
	it('should extract tools tested', () => {
		const filePath = createTempDoc(MOCK_DOC_EXCELLENT, 'test-excellent.md');
		const doc = TestDocumentParser.parse(filePath);
		
		assert.ok(doc.toolsTested.length >= 3, 'Should extract at least 3 tools');
		assert.ok(doc.toolsTested.includes('swarmmail_init'));
		assert.ok(doc.toolsTested.includes('swarm_init'));
		assert.ok(doc.toolsTested.includes('swarmmail_health'));
	});
	
	it('should extract test results', () => {
		const filePath = createTempDoc(MOCK_DOC_EXCELLENT, 'test-excellent.md');
		const doc = TestDocumentParser.parse(filePath);
		
		assert.ok(doc.results.length > 0, 'Should extract test results');
		const initTest = doc.results.find(r => r.name === 'Basic Initialization');
		assert.ok(initTest, 'Should find Basic Initialization test');
		assert.strictEqual(initTest?.status, 'PASS');
	});
	
	it('should extract Windows-specific sections', () => {
		const filePath = createTempDoc(MOCK_DOC_EXCELLENT, 'test-excellent.md');
		const doc = TestDocumentParser.parse(filePath);
		
		assert.ok(doc.windowsSpecifics.length > 0, 'Should extract Windows-specific sections');
		const pathSection = doc.windowsSpecifics.find(ws => 
			ws.feature.includes('Path Normalization')
		);
		assert.ok(pathSection, 'Should find Path Normalization section');
	});
	
	it('should extract known issues', () => {
		const filePath = createTempDoc(MOCK_DOC_EXCELLENT, 'test-excellent.md');
		const doc = TestDocumentParser.parse(filePath);
		
		assert.ok(doc.knownIssues.length > 0, 'Should extract known issues');
		const sqliteIssue = doc.knownIssues.find(issue => 
			issue.includes('SQLite')
		);
		assert.ok(sqliteIssue, 'Should find SQLite issue');
	});
	
	it('should extract recommendations', () => {
		const filePath = createTempDoc(MOCK_DOC_EXCELLENT, 'test-excellent.md');
		const doc = TestDocumentParser.parse(filePath);
		
		assert.ok(doc.recommendations.length > 0, 'Should extract recommendations');
	});
});

describe('QualityEvaluator', () => {
	afterEach(() => {
		cleanupTempDocs();
	});
	
	it('should give high score to excellent documentation', () => {
		const filePath = createTempDoc(MOCK_DOC_EXCELLENT, 'test-excellent.md');
		const doc = TestDocumentParser.parse(filePath);
		const metrics = QualityEvaluator.evaluate(doc);
		
		assert.ok(metrics.completeness >= 80, `Completeness should be >= 80, got ${metrics.completeness}`);
		assert.ok(metrics.accuracy >= 80, `Accuracy should be >= 80, got ${metrics.accuracy}`);
		assert.ok(metrics.coverage >= 60, `Coverage should be >= 60, got ${metrics.coverage}`);
		assert.ok(metrics.overallScore >= 70, `Overall should be >= 70, got ${metrics.overallScore}`);
	});
	
	it('should give low score to poor documentation', () => {
		const filePath = createTempDoc(MOCK_DOC_POOR, 'test-poor.md');
		const doc = TestDocumentParser.parse(filePath);
		const metrics = QualityEvaluator.evaluate(doc);
		
		assert.ok(metrics.completeness < 60, `Completeness should be < 60, got ${metrics.completeness}`);
		assert.ok(metrics.overallScore < 60, `Overall should be < 60, got ${metrics.overallScore}`);
	});
	
	it('should evaluate all metric categories', () => {
		const filePath = createTempDoc(MOCK_DOC_EXCELLENT, 'test-excellent.md');
		const doc = TestDocumentParser.parse(filePath);
		const metrics = QualityEvaluator.evaluate(doc);
		
		assert.ok(metrics.completeness >= 0 && metrics.completeness <= 100);
		assert.ok(metrics.accuracy >= 0 && metrics.accuracy <= 100);
		assert.ok(metrics.coverage >= 0 && metrics.coverage <= 100);
		assert.ok(metrics.clarity >= 0 && metrics.clarity <= 100);
		assert.ok(metrics.windowsSpecific >= 0 && metrics.windowsSpecific <= 100);
		assert.ok(metrics.overallScore >= 0 && metrics.overallScore <= 100);
	});
});

describe('GapAnalyzer', () => {
	afterEach(() => {
		cleanupTempDocs();
	});
	
	it('should identify missing tool tests', () => {
		const filePath = createTempDoc(MOCK_DOC_POOR, 'test-poor.md');
		const doc = TestDocumentParser.parse(filePath);
		const gaps = GapAnalyzer.analyze(doc);
		
		assert.ok(gaps.length > 0, 'Should identify gaps');
		const missingTools = gaps.filter(g => g.startsWith('Missing test for tool:'));
		assert.ok(missingTools.length > 0, 'Should identify missing tool tests');
	});
	
	it('should identify missing Windows-specific tests', () => {
		const filePath = createTempDoc(MOCK_DOC_POOR, 'test-poor.md');
		const doc = TestDocumentParser.parse(filePath);
		const gaps = GapAnalyzer.analyze(doc);
		
		const windowsGaps = gaps.filter(g => g.includes('Windows-specific'));
		assert.ok(windowsGaps.length > 0, 'Should identify missing Windows-specific tests');
	});
	
	it('should identify missing documentation', () => {
		const filePath = createTempDoc(MOCK_DOC_POOR, 'test-poor.md');
		const doc = TestDocumentParser.parse(filePath);
		const gaps = GapAnalyzer.analyze(doc);
		
		assert.ok(
			gaps.some(g => g.includes('recommendations')),
			'Should identify missing recommendations'
		);
	});
});

describe('TestReviewer', () => {
	let tempDir: string;
	
	beforeEach(() => {
		tempDir = path.join(__dirname, 'temp-test-docs');
		if (!fs.existsSync(tempDir)) {
			fs.mkdirSync(tempDir, { recursive: true });
		}
	});
	
	afterEach(() => {
		cleanupTempDocs();
	});
	
	it('should review a single document', () => {
		const filePath = createTempDoc(MOCK_DOC_EXCELLENT, 'test-excellent.md');
		const reviewer = new TestReviewer(tempDir);
		const report = reviewer.reviewDocument(filePath);
		
		assert.ok(report.document);
		assert.ok(report.metrics);
		assert.ok(Array.isArray(report.gaps));
		assert.ok(Array.isArray(report.strengths));
		assert.ok(Array.isArray(report.suggestions));
		assert.ok(['EXCELLENT', 'GOOD', 'ACCEPTABLE', 'NEEDS_WORK', 'INSUFFICIENT'].includes(report.verdict));
	});
	
	it('should give EXCELLENT verdict to high-quality docs', () => {
		const filePath = createTempDoc(MOCK_DOC_EXCELLENT, 'test-excellent.md');
		const reviewer = new TestReviewer(tempDir);
		const report = reviewer.reviewDocument(filePath);
		
		assert.ok(
			['EXCELLENT', 'GOOD'].includes(report.verdict),
			`Expected EXCELLENT or GOOD, got ${report.verdict}`
		);
	});
	
	it('should give poor verdict to low-quality docs', () => {
		const filePath = createTempDoc(MOCK_DOC_POOR, 'test-poor.md');
		const reviewer = new TestReviewer(tempDir);
		const report = reviewer.reviewDocument(filePath);
		
		assert.ok(
			['NEEDS_WORK', 'INSUFFICIENT'].includes(report.verdict),
			`Expected NEEDS_WORK or INSUFFICIENT, got ${report.verdict}`
		);
	});
	
	it('should review all documents in directory', () => {
		createTempDoc(MOCK_DOC_EXCELLENT, 'test-1.md');
		createTempDoc(MOCK_DOC_POOR, 'test-2.md');
		
		const reviewer = new TestReviewer(tempDir);
		const summary = reviewer.reviewAll();
		
		assert.strictEqual(summary.totalDocuments, 2);
		assert.ok(summary.avgQualityScore > 0);
		assert.ok(['READY', 'NEEDS_IMPROVEMENT', 'INCOMPLETE'].includes(summary.verdict));
		assert.ok(summary.recommendation);
	});
	
	it('should generate markdown report', () => {
		const filePath = createTempDoc(MOCK_DOC_EXCELLENT, 'test-excellent.md');
		const reviewer = new TestReviewer(tempDir);
		const report = reviewer.reviewDocument(filePath);
		const summary = reviewer.reviewAll();
		
		const markdown = reviewer.generateReport(summary, [report]);
		
		assert.ok(markdown.includes('# Windows Swarm Tools Testing - Review Report'));
		assert.ok(markdown.includes('Executive Summary'));
		assert.ok(markdown.includes('Quality Metrics'));
		assert.ok(markdown.length > 100, 'Report should be substantial');
	});
});

// ============================================================================
// TEST RUNNER
// ============================================================================

async function runTests(): Promise<void> {
	console.log('='.repeat(80));
	console.log('🧪 TEST REVIEW SYSTEM - UNIT TESTS');
	console.log('='.repeat(80));
	console.log();
	
	let passed = 0;
	let failed = 0;
	const failures: string[] = [];
	
	const testSuites = [
		{ name: 'TestDocumentParser', tests: describe.bind(null, 'TestDocumentParser') },
		{ name: 'QualityEvaluator', tests: describe.bind(null, 'QualityEvaluator') },
		{ name: 'GapAnalyzer', tests: describe.bind(null, 'GapAnalyzer') },
		{ name: 'TestReviewer', tests: describe.bind(null, 'TestReviewer') },
	];
	
	// Simple test runner (would use Jest/Mocha in real scenario)
	console.log('✅ All test structure defined');
	console.log('   Note: Use a test runner like Jest to execute these tests');
	console.log();
	console.log('Test suites defined:');
	for (const suite of testSuites) {
		console.log(`  - ${suite.name}`);
	}
	console.log();
	console.log('='.repeat(80));
}

// Mock test framework functions (would be provided by Jest/Mocha)
function describe(name: string, fn: () => void): void {
	// Test suite definition
}

function it(name: string, fn: () => void): void {
	// Test case definition
}

function beforeEach(fn: () => void): void {
	// Setup hook
}

function afterEach(fn: () => void): void {
	// Teardown hook
}

if (require.main === module) {
	runTests().catch(error => {
		console.error('❌ Tests failed:', error);
		process.exit(1);
	});
}

export { runTests };
