/**
 * Test Review & Evaluation System for Windows Swarm Tools Testing
 * 
 * Purpose: Automated validation and quality assessment of Windows test documentation
 * 
 * Features:
 * 1. Parse test markdown documents
 * 2. Validate test result structure and completeness
 * 3. Calculate quality scores
 * 4. Identify coverage gaps
 * 5. Generate review reports
 * 
 * Usage:
 *   const reviewer = new TestReviewer('docs/windows');
 *   const report = await reviewer.reviewAll();
 *   console.log(report.summary);
 */

import * as fs from 'fs';
import * as path from 'path';

// ============================================================================
// TYPES & INTERFACES
// ============================================================================

export interface TestResult {
	name: string;
	status: 'PASS' | 'FAIL' | 'SKIP' | 'UNKNOWN';
	severity?: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
	notes?: string[];
}

export interface WindowsSpecific {
	feature: string;
	tested: boolean;
	notes: string[];
	issues: string[];
}

export interface TestDocument {
	filePath: string;
	title: string;
	platform: string;
	nodeVersion: string;
	testDate: string;
	overallStatus: 'PASS' | 'FAIL' | 'PARTIAL';
	toolsTested: string[];
	results: TestResult[];
	windowsSpecifics: WindowsSpecific[];
	knownIssues: string[];
	recommendations: string[];
}

export interface QualityMetrics {
	completeness: number;      // 0-100: How complete is the documentation?
	accuracy: number;          // 0-100: Are examples accurate and verifiable?
	coverage: number;          // 0-100: How much functionality is tested?
	clarity: number;           // 0-100: Is the documentation clear?
	windowsSpecific: number;   // 0-100: Are Windows issues well documented?
	overallScore: number;      // 0-100: Weighted average
}

export interface ReviewReport {
	document: TestDocument;
	metrics: QualityMetrics;
	gaps: string[];
	strengths: string[];
	suggestions: string[];
	verdict: 'EXCELLENT' | 'GOOD' | 'ACCEPTABLE' | 'NEEDS_WORK' | 'INSUFFICIENT';
}

export interface SummaryReport {
	totalDocuments: number;
	passed: number;
	failed: number;
	partial: number;
	avgQualityScore: number;
	criticalIssues: string[];
	coverageGaps: string[];
	verdict: 'READY' | 'NEEDS_IMPROVEMENT' | 'INCOMPLETE';
	recommendation: string;
}

// ============================================================================
// TEST DOCUMENT PARSER
// ============================================================================

export class TestDocumentParser {
	/**
	 * Parse a markdown test document into structured data
	 */
	static parse(filePath: string): TestDocument {
		const content = fs.readFileSync(filePath, 'utf-8');
		const lines = content.split('\n');
		
		const doc: TestDocument = {
			filePath,
			title: '',
			platform: '',
			nodeVersion: '',
			testDate: '',
			overallStatus: 'PASS',
			toolsTested: [],
			results: [],
			windowsSpecifics: [],
			knownIssues: [],
			recommendations: [],
		};
		
		// Extract metadata from header
		for (let i = 0; i < Math.min(20, lines.length); i++) {
			const line = lines[i].trim();
			
			if (line.startsWith('# ')) {
				doc.title = line.substring(2).trim();
			} else if (line.startsWith('**Platform:**')) {
				doc.platform = line.split('**Platform:**')[1].trim();
			} else if (line.startsWith('**Node Version:**')) {
				doc.nodeVersion = line.split('**Node Version:**')[1].trim();
			} else if (line.startsWith('**Test Date:**')) {
				doc.testDate = line.split('**Test Date:**')[1].trim();
			} else if (line.startsWith('**Test Status:**')) {
				const status = line.split('**Test Status:**')[1].trim();
				if (status.includes('ALL TESTS PASSED')) {
					doc.overallStatus = 'PASS';
				} else if (status.includes('FAIL')) {
					doc.overallStatus = 'FAIL';
				} else {
					doc.overallStatus = 'PARTIAL';
				}
			}
		}
		
		// Extract tools tested (look for checkmark markers)
		const toolsSectionMatch = /## Tools Tested([\s\S]{0,1000}?)---/.exec(content);
		if (toolsSectionMatch) {
			const toolLines = toolsSectionMatch[1].split('\n');
			for (const line of toolLines) {
				const match = /[\u2705]\s+\*\*([^*]+)\*\*/u.exec(line);
				if (match) {
					doc.toolsTested.push(match[1].trim());
				}
			}
		}
		
		// Extract test results (look for test headers line by line)
		for (const line of lines) {
			if (line.includes('Test:')) {
				const hasCheck = line.includes('\u2705');
				const hasCross = line.includes('\u274C');
				if (hasCheck || hasCross) {
					const testMatch = /Test:\s+([^\n]+)/.exec(line);
					if (testMatch) {
						doc.results.push({
							name: testMatch[1].trim(),
							status: hasCheck ? 'PASS' : 'FAIL',
						});
					}
				}
			}
		}
		
		// Extract Windows-specific notes (look for window emoji)
		for (let i = 0; i < lines.length; i++) {
			const line = lines[i];
			if (line.includes('\uD83E\uDE9F') || line.includes('🪟')) {
				const featureMatch = /####\s+.+?\s+([^\n]+)/.exec(line);
				if (featureMatch) {
					const feature = featureMatch[1].trim();
					
					// Collect notes from following lines
					const notes: string[] = [];
					const issues: string[] = [];
					
					for (let j = i + 1; j < Math.min(i + 50, lines.length); j++) {
						const noteLine = lines[j];
						if (noteLine.startsWith('####') || noteLine.startsWith('##')) {
							break;
						}
						if (noteLine.trim().startsWith('-') || noteLine.trim().startsWith('•')) {
							const note = noteLine.replace(/^\s*[-\u2022]\s*/, '').trim();
							if (note && (note.includes('\u274C') || note.includes('ERROR') || note.includes('CRITICAL'))) {
								issues.push(note);
							} else if (note) {
								notes.push(note);
							}
						}
					}
					
					if (notes.length > 0 || issues.length > 0) {
						doc.windowsSpecifics.push({ feature, tested: true, notes, issues });
					}
				}
			}
		}
		
		// Extract known issues
		const issuesSectionMatch = /### Known Issues([\s\S]{0,2000}?)(?=###|\n##|$)/.exec(content);
		if (issuesSectionMatch) {
			const issueLines = issuesSectionMatch[1].split('\n');
			for (const line of issueLines) {
				// Match lines starting with bullet points or warning/error markers
				if (/^\s*[-\u2022]/.test(line) || line.includes('\u26A0') || line.includes('\u274C')) {
					const cleaned = line
						.replace(/^\s*[-\u2022\s]+/, '')
						.replace(/^[\u26A0\u274C\s]+/, '')
						.replace(/\uFE0F/g, '')
						.trim();
					if (cleaned) {
						doc.knownIssues.push(cleaned);
					}
				}
			}
		}
		
		// Extract recommendations
		const recoSectionMatch = /### 🎯 Recommendations([\s\S]{0,2000}?)(?=###|\n##|---)/.exec(content);
		if (recoSectionMatch) {
			const recoLines = recoSectionMatch[1].split('\n');
			for (const line of recoLines) {
				if (line.match(/^\s*\d+\.\s+\*\*/)) {
					const reco = line.replace(/^\s*\d+\.\s+\*\*/, '').replace(/\*\*.*$/, '').trim();
					if (reco) {
						doc.recommendations.push(reco);
					}
				}
			}
		}
		
		return doc;
	}
}

// ============================================================================
// QUALITY EVALUATOR
// ============================================================================
// QUALITY EVALUATOR
// ============================================================================

export class QualityEvaluator {
	/**
	 * Calculate quality metrics for a test document
	 */
	static evaluate(doc: TestDocument): QualityMetrics {
		const completeness = this.evaluateCompleteness(doc);
		const accuracy = this.evaluateAccuracy(doc);
		const coverage = this.evaluateCoverage(doc);
		const clarity = this.evaluateClarity(doc);
		const windowsSpecific = this.evaluateWindowsSpecific(doc);
		
		// Weighted average
		const overallScore = (
			completeness * 0.25 +
			accuracy * 0.20 +
			coverage * 0.25 +
			clarity * 0.15 +
			windowsSpecific * 0.15
		);
		
		return {
			completeness,
			accuracy,
			coverage,
			clarity,
			windowsSpecific,
			overallScore,
		};
	}
	
	private static evaluateCompleteness(doc: TestDocument): number {
		let score = 0;
		
		// Required fields
		if (doc.title) score += 10;
		if (doc.platform) score += 10;
		if (doc.nodeVersion) score += 10;
		if (doc.testDate) score += 10;
		if (doc.overallStatus) score += 10;
		
		// Content
		if (doc.toolsTested.length > 0) score += 15;
		if (doc.results.length > 0) score += 15;
		if (doc.windowsSpecifics.length > 0) score += 10;
		if (doc.knownIssues.length > 0) score += 5;
		if (doc.recommendations.length > 0) score += 5;
		
		return Math.min(100, score);
	}
	
	private static evaluateAccuracy(doc: TestDocument): number {
		let score = 100;
		
		// Check for placeholder content
		const content = fs.readFileSync(doc.filePath, 'utf-8');
		if (content.includes('TODO') || content.includes('PLACEHOLDER')) {
			score -= 20;
		}
		
		// Check for proper status markers
		const hasProperMarkers = content.includes('✅') || content.includes('❌');
		if (!hasProperMarkers) {
			score -= 30;
		}
		
		// Check for code examples
		const hasCodeBlocks = content.includes('```');
		if (!hasCodeBlocks) {
			score -= 20;
		}
		
		return Math.max(0, score);
	}
	
	private static evaluateCoverage(doc: TestDocument): number {
		// Core initialization tools (must be tested)
		const coreTools = [
			'swarmmail_init',
			'swarm_init',
			'swarmmail_health',
			'swarmmail_reserve',
		];
		
		const testedCore = coreTools.filter(tool => 
			doc.toolsTested.some(t => t.includes(tool))
		).length;
		
		const coreScore = (testedCore / coreTools.length) * 60;
		
		// Additional coverage
		const additionalScore = Math.min(40, doc.toolsTested.length * 5);
		
		return Math.min(100, coreScore + additionalScore);
	}
	
	private static evaluateClarity(doc: TestDocument): number {
		const content = fs.readFileSync(doc.filePath, 'utf-8');
		let score = 100;
		
		// Check for section headers
		const sections = [
			'## Overview',
			'## Tools Tested',
			'## Summary',
			'### Purpose',
			'### Windows Test Results',
		];
		
		const foundSections = sections.filter(s => content.includes(s)).length;
		const structureScore = (foundSections / sections.length) * 40;
		
		// Check for explanations (should have "Purpose", "Why", "What")
		const hasExplanations = 
			content.includes('Purpose') ||
			content.includes('WHY') ||
			content.includes('WHAT IT TESTS');
		const explanationScore = hasExplanations ? 30 : 0;
		
		// Check for examples
		const exampleCount = (content.match(/```/g) || []).length / 2;
		const exampleScore = Math.min(30, exampleCount * 10);
		
		return Math.min(100, structureScore + explanationScore + exampleScore);
	}
	
	private static evaluateWindowsSpecific(doc: TestDocument): number {
		let score = 0;
		
		// Windows-specific sections documented
		if (doc.windowsSpecifics.length > 0) score += 40;
		
		// Known issues documented
		if (doc.knownIssues.length > 0) score += 20;
		
		// Recommendations provided
		if (doc.recommendations.length > 0) score += 20;
		
		// Windows markers used (🪟)
		const content = fs.readFileSync(doc.filePath, 'utf-8');
		if (content.includes('🪟')) score += 10;
		
		// Path handling discussed
		if (content.includes('backslash') || content.includes('\\\\')) score += 10;
		
		return Math.min(100, score);
	}
}

// ============================================================================
// GAP ANALYZER
// ============================================================================

export class GapAnalyzer {
	/**
	 * Identify missing coverage and areas for improvement
	 */
	static analyze(doc: TestDocument): string[] {
		const gaps: string[] = [];
		
		// Check for required tools
		const requiredTools = [
			'swarmmail_init',
			'swarm_init',
			'swarmmail_health',
			'swarmmail_reserve',
			'swarmmail_send',
			'swarmmail_inbox',
			'swarm_progress',
			'swarm_complete',
			'hive_create',
			'hive_update',
			'hive_close',
		];
		
		for (const tool of requiredTools) {
			if (!doc.toolsTested.some(t => t.includes(tool))) {
				gaps.push(`Missing test for tool: ${tool}`);
			}
		}
		
		// Check for Windows-specific areas
		const windowsAreas = [
			'Path normalization',
			'Database locking',
			'File reservations',
			'Long path support',
			'Case sensitivity',
		];
		
		for (const area of windowsAreas) {
			const covered = doc.windowsSpecifics.some(ws => 
				ws.feature.toLowerCase().includes(area.toLowerCase())
			);
			if (!covered) {
				gaps.push(`Missing Windows-specific test: ${area}`);
			}
		}
		
		// Check for critical documentation
		if (doc.knownIssues.length === 0) {
			gaps.push('No known issues documented (expected at least 1)');
		}
		
		if (doc.recommendations.length === 0) {
			gaps.push('No recommendations provided');
		}
		
		return gaps;
	}
}

// ============================================================================
// TEST REVIEWER
// ============================================================================

export class TestReviewer {
	constructor(private docsDir: string) {}
	
	/**
	 * Review a single test document
	 */
	reviewDocument(filePath: string): ReviewReport {
		const doc = TestDocumentParser.parse(filePath);
		const metrics = QualityEvaluator.evaluate(doc);
		const gaps = GapAnalyzer.analyze(doc);
		
		const strengths: string[] = [];
		const suggestions: string[] = [];
		
		// Identify strengths
		if (metrics.completeness >= 90) {
			strengths.push('Comprehensive documentation with all required sections');
		}
		if (metrics.accuracy >= 90) {
			strengths.push('Accurate examples with proper status markers');
		}
		if (metrics.coverage >= 80) {
			strengths.push('Good test coverage of core functionality');
		}
		if (metrics.windowsSpecific >= 80) {
			strengths.push('Excellent Windows-specific documentation');
		}
		
		// Generate suggestions
		if (metrics.completeness < 80) {
			suggestions.push('Add missing sections: metadata, tools tested, or results');
		}
		if (metrics.accuracy < 80) {
			suggestions.push('Add code examples and verify all status markers');
		}
		if (metrics.coverage < 70) {
			suggestions.push('Test more tools, especially core initialization tools');
		}
		if (metrics.clarity < 70) {
			suggestions.push('Improve structure with clear section headers and explanations');
		}
		if (metrics.windowsSpecific < 70) {
			suggestions.push('Document more Windows-specific behaviors and known issues');
		}
		
		// Determine verdict
		let verdict: ReviewReport['verdict'];
		if (metrics.overallScore >= 90) {
			verdict = 'EXCELLENT';
		} else if (metrics.overallScore >= 75) {
			verdict = 'GOOD';
		} else if (metrics.overallScore >= 60) {
			verdict = 'ACCEPTABLE';
		} else if (metrics.overallScore >= 40) {
			verdict = 'NEEDS_WORK';
		} else {
			verdict = 'INSUFFICIENT';
		}
		
		return {
			document: doc,
			metrics,
			gaps,
			strengths,
			suggestions,
			verdict,
		};
	}
	
	/**
	 * Review all test documents in the directory
	 */
	reviewAll(): SummaryReport {
		const files = fs.readdirSync(this.docsDir)
			.filter(f => f.endsWith('.md') && f !== 'README.md')
			.map(f => path.join(this.docsDir, f));
		
		const reports = files.map(f => this.reviewDocument(f));
		
		const totalDocuments = reports.length;
		const passed = reports.filter(r => r.document.overallStatus === 'PASS').length;
		const failed = reports.filter(r => r.document.overallStatus === 'FAIL').length;
		const partial = reports.filter(r => r.document.overallStatus === 'PARTIAL').length;
		
		const avgQualityScore = reports.length > 0
			? reports.reduce((sum, r) => sum + r.metrics.overallScore, 0) / reports.length
			: 0;
		
		// Collect critical issues
		const criticalIssues: string[] = [];
		for (const report of reports) {
			for (const issue of report.document.knownIssues) {
				if (issue.includes('CRITICAL') || issue.includes('SQLite')) {
					criticalIssues.push(`${report.document.title}: ${issue}`);
				}
			}
		}
		
		// Collect coverage gaps
		const coverageGaps: string[] = [];
		for (const report of reports) {
			for (const gap of report.gaps) {
				if (gap.startsWith('Missing test for tool:')) {
					coverageGaps.push(gap);
				}
			}
		}
		
		// Determine verdict
		let verdict: SummaryReport['verdict'];
		let recommendation: string;
		
		if (avgQualityScore >= 80 && coverageGaps.length <= 3) {
			verdict = 'READY';
			recommendation = 'Documentation is comprehensive and ready for production use. Minor gaps can be addressed in future iterations.';
		} else if (avgQualityScore >= 60) {
			verdict = 'NEEDS_IMPROVEMENT';
			recommendation = 'Documentation is functional but has gaps. Address missing tests and critical issues before production deployment.';
		} else {
			verdict = 'INCOMPLETE';
			recommendation = 'Documentation is insufficient. Complete all core tests and document Windows-specific behaviors before proceeding.';
		}
		
		return {
			totalDocuments,
			passed,
			failed,
			partial,
			avgQualityScore,
			criticalIssues: [...new Set(criticalIssues)],
			coverageGaps: [...new Set(coverageGaps)],
			verdict,
			recommendation,
		};
	}
	
	/**
	 * Generate a markdown report
	 */
	generateReport(summary: SummaryReport, individualReports: ReviewReport[]): string {
		let md = '# Windows Swarm Tools Testing - Review Report\n\n';
		md += `**Generated:** ${new Date().toISOString().split('T')[0]}\n\n`;
		md += '---\n\n';
		
		// Summary
		md += '## Executive Summary\n\n';
		md += `**Verdict:** ${summary.verdict}\n\n`;
		md += `${summary.recommendation}\n\n`;
		md += '### Metrics\n\n';
		md += `- **Total Documents:** ${summary.totalDocuments}\n`;
		md += `- **Tests Passed:** ${summary.passed}\n`;
		md += `- **Tests Failed:** ${summary.failed}\n`;
		md += `- **Tests Partial:** ${summary.partial}\n`;
		md += `- **Avg Quality Score:** ${summary.avgQualityScore.toFixed(1)}/100\n\n`;
		
		// Critical Issues
		if (summary.criticalIssues.length > 0) {
			md += '### ⚠️ Critical Issues\n\n';
			for (const issue of summary.criticalIssues) {
				md += `- ${issue}\n`;
			}
			md += '\n';
		}
		
		// Coverage Gaps
		if (summary.coverageGaps.length > 0) {
			md += '### 📊 Coverage Gaps\n\n';
			for (const gap of summary.coverageGaps) {
				md += `- ${gap}\n`;
			}
			md += '\n';
		}
		
		md += '---\n\n';
		
		// Individual Reports
		md += '## Individual Document Reviews\n\n';
		
		for (const report of individualReports) {
			md += `### ${report.document.title}\n\n`;
			md += `**File:** ${path.basename(report.document.filePath)}\n`;
			md += `**Status:** ${report.document.overallStatus}\n`;
			md += `**Verdict:** ${report.verdict}\n\n`;
			
			md += '#### Quality Metrics\n\n';
			md += '| Metric | Score | Status |\n';
			md += '|--------|-------|--------|\n';
			md += `| Completeness | ${report.metrics.completeness.toFixed(0)} | ${this.scoreStatus(report.metrics.completeness)} |\n`;
			md += `| Accuracy | ${report.metrics.accuracy.toFixed(0)} | ${this.scoreStatus(report.metrics.accuracy)} |\n`;
			md += `| Coverage | ${report.metrics.coverage.toFixed(0)} | ${this.scoreStatus(report.metrics.coverage)} |\n`;
			md += `| Clarity | ${report.metrics.clarity.toFixed(0)} | ${this.scoreStatus(report.metrics.clarity)} |\n`;
			md += `| Windows-Specific | ${report.metrics.windowsSpecific.toFixed(0)} | ${this.scoreStatus(report.metrics.windowsSpecific)} |\n`;
			md += `| **Overall** | **${report.metrics.overallScore.toFixed(0)}** | **${this.scoreStatus(report.metrics.overallScore)}** |\n\n`;
			
			if (report.strengths.length > 0) {
				md += '#### ✅ Strengths\n\n';
				for (const strength of report.strengths) {
					md += `- ${strength}\n`;
				}
				md += '\n';
			}
			
			if (report.suggestions.length > 0) {
				md += '#### 💡 Suggestions\n\n';
				for (const suggestion of report.suggestions) {
					md += `- ${suggestion}\n`;
				}
				md += '\n';
			}
			
			if (report.gaps.length > 0) {
				md += '#### 📋 Coverage Gaps\n\n';
				for (const gap of report.gaps.slice(0, 5)) {
					md += `- ${gap}\n`;
				}
				if (report.gaps.length > 5) {
					md += `- *...and ${report.gaps.length - 5} more*\n`;
				}
				md += '\n';
			}
			
			md += '---\n\n';
		}
		
		return md;
	}
	
	private scoreStatus(score: number): string {
		if (score >= 90) return '🟢 Excellent';
		if (score >= 75) return '🟢 Good';
		if (score >= 60) return '🟡 Acceptable';
		if (score >= 40) return '🟠 Needs Work';
		return '🔴 Insufficient';
	}
}

// ============================================================================
// CLI INTERFACE
// ============================================================================

export async function main(): Promise<void> {
	const docsDir = path.resolve(process.cwd(), 'docs', 'windows');
	
	console.log('='.repeat(80));
	console.log('🔍 WINDOWS SWARM TOOLS TEST REVIEW SYSTEM');
	console.log('='.repeat(80));
	console.log(`\nReviewing documents in: ${docsDir}\n`);
	
	const reviewer = new TestReviewer(docsDir);
	
	// Get all markdown files
	const files = fs.readdirSync(docsDir)
		.filter(f => f.endsWith('.md') && f !== 'README.md')
		.map(f => path.join(docsDir, f));
	
	if (files.length === 0) {
		console.log('❌ No test documents found!');
		process.exit(1);
	}
	
	console.log(`Found ${files.length} test document(s):\n`);
	
	// Review individual documents
	const individualReports: ReviewReport[] = [];
	
	for (const file of files) {
		console.log(`📄 Reviewing: ${path.basename(file)}`);
		const report = reviewer.reviewDocument(file);
		individualReports.push(report);
		
		console.log(`   Status: ${report.document.overallStatus}`);
		console.log(`   Verdict: ${report.verdict}`);
		console.log(`   Quality Score: ${report.metrics.overallScore.toFixed(1)}/100`);
		console.log();
	}
	
	// Generate summary
	const summary = reviewer.reviewAll();
	
	console.log('='.repeat(80));
	console.log('📊 SUMMARY');
	console.log('='.repeat(80));
	console.log();
	console.log(`Verdict: ${summary.verdict}`);
	console.log(`Avg Quality Score: ${summary.avgQualityScore.toFixed(1)}/100`);
	console.log(`Documents: ${summary.totalDocuments}`);
	console.log(`Passed: ${summary.passed} | Failed: ${summary.failed} | Partial: ${summary.partial}`);
	console.log();
	
	if (summary.criticalIssues.length > 0) {
		console.log(`⚠️  Critical Issues: ${summary.criticalIssues.length}`);
	}
	
	if (summary.coverageGaps.length > 0) {
		console.log(`📋 Coverage Gaps: ${summary.coverageGaps.length}`);
	}
	
	console.log();
	console.log('Recommendation:');
	console.log(`  ${summary.recommendation}`);
	console.log();
	
	// Generate report file
	const reportMd = reviewer.generateReport(summary, individualReports);
	const reportPath = path.join(docsDir, 'REVIEW-REPORT.md');
	fs.writeFileSync(reportPath, reportMd, 'utf-8');
	
	console.log(`✅ Full report saved to: ${reportPath}`);
	console.log();
	console.log('='.repeat(80));
	
	// Exit with appropriate code
	if (summary.verdict === 'INCOMPLETE') {
		process.exit(1);
	}
}

// Run if this is the main module
if (require.main === module) {
	main().catch(error => {
		console.error('❌ Review system failed:', error);
		process.exit(1);
	});
}
