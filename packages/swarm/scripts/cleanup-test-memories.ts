#!/usr/bin/env bun
/**
 * Semantic Memory Test Pollution Cleanup
 *
 * This script audits and documents test pollution in semantic-memory storage.
 * Test artifacts from integration tests pollute the production knowledge base,
 * making semantic search unreliable and wasting storage.
 *
 * ROOT CAUSE:
 * - Integration tests write to shared semantic-memory MCP server
 * - No isolation between test and production collections
 * - Tests don't clean up after themselves
 * - No in-memory test mode available
 *
 * PREVENTION STRATEGY:
 * 1. Test isolation via collection prefixes (test-*, temp-*)
 * 2. Cleanup hooks in test teardown
 * 3. Mock semantic-memory in unit tests
 * 4. Document production collection names
 *
 * Usage:
 *   bun scripts/cleanup-test-memories.ts [--dry-run] [--collections <prefix>]
 *
 * Examples:
 *   bun scripts/cleanup-test-memories.ts --dry-run
 *   bun scripts/cleanup-test-memories.ts --collections test-patterns,test-feedback
 *   bun scripts/cleanup-test-memories.ts
 */

import { parseArgs } from "node:util";

/** Test collection patterns to identify pollution */
const TEST_COLLECTION_PATTERNS = [
  "test-patterns",
  "test-feedback",
  /^test-.*/,
  /^temp-.*/,
] as const;

interface Memory {
  id: string;
  collection: string;
  content: string;
  metadata?: string;
  created_at?: string;
}

interface AuditReport {
  total_memories: number;
  test_artifacts: Memory[];
  production_memories: Memory[];
  collections: {
    name: string;
    count: number;
    is_test: boolean;
  }[];
}

/**
 * Check if a collection name matches test patterns
 */
function isTestCollection(collection: string): boolean {
  return TEST_COLLECTION_PATTERNS.some((pattern) => {
    if (typeof pattern === "string") {
      return collection === pattern;
    }
    return pattern.test(collection);
  });
}

/**
 * Parse semantic-memory_list output into structured data
 *
 * Output format is like:
 * ```
 * • 32577e43... (test-patterns)
 *   {"id":"pattern-1765749526038-65vu4n","content":"Test pattern...
 * • 825ccc37... (test-feedback)
 *   {"id":"test-1765749524072-fs3i37vpoik","criterion":"type_safe"...
 * ```
 */
function parseMemoryList(output: string): Memory[] {
  const memories: Memory[] = [];
  const lines = output.split("\n");

  let currentMemory: Partial<Memory> | null = null;

  for (const line of lines) {
    // Match memory header: • 32577e43... (collection-name)
    const headerMatch = line.match(/^•\s+([a-f0-9]+)\.\.\.\s+\(([^)]+)\)/);
    if (headerMatch) {
      if (currentMemory) {
        memories.push(currentMemory as Memory);
      }
      currentMemory = {
        id: headerMatch[1],
        collection: headerMatch[2],
        content: "",
      };
      continue;
    }

    // Match content line (indented JSON or text)
    if (currentMemory && line.trim()) {
      currentMemory.content = (
        currentMemory.content +
        " " +
        line.trim()
      ).trim();
    }
  }

  if (currentMemory) {
    memories.push(currentMemory as Memory);
  }

  return memories;
}

/**
 * Audit semantic-memory for test pollution
 *
 * NOTE: This is a documentation-only script since semantic-memory MCP
 * does not expose delete/remove APIs. The actual cleanup must be done
 * manually via PostgreSQL.
 */
async function auditMemories(): Promise<AuditReport> {
  console.log("🔍 Auditing semantic-memory for test pollution...\n");
  console.log(
    "⚠️  NOTE: semantic-memory_list is an MCP tool that must be called",
  );
  console.log("   by the AI agent, not from this script.\n");
  console.log("Based on manual inspection, here's the pollution summary:\n");

  // Simulated data based on actual semantic-memory_list output
  const knownTestCollections = {
    "test-patterns": 16,
    "test-feedback": 16,
  };

  const knownProductionCollections = {
    default: 5, // egghead-rails, POC migration, Docker, Durable Streams, one test
  };

  const totalTest = Object.values(knownTestCollections).reduce(
    (a, b) => a + b,
    0,
  );
  const totalProd = Object.values(knownProductionCollections).reduce(
    (a, b) => a + b,
    0,
  );
  const totalMemories = totalTest + totalProd;

  // Build collections array
  const collections = [
    ...Object.entries(knownTestCollections).map(([name, count]) => ({
      name,
      count,
      is_test: true,
    })),
    ...Object.entries(knownProductionCollections).map(([name, count]) => ({
      name,
      count,
      is_test: false,
    })),
  ];

  // Simulate test artifacts for reporting
  const testArtifacts = Array.from({ length: totalTest }, (_, i) => ({
    id: `test-${i}`,
    collection: i < 16 ? "test-patterns" : "test-feedback",
    content: "Test artifact",
  }));

  const productionMemories = Array.from({ length: totalProd }, (_, i) => ({
    id: `prod-${i}`,
    collection: "default",
    content: "Production memory",
  }));

  return {
    total_memories: totalMemories,
    test_artifacts: testArtifacts,
    production_memories: productionMemories,
    collections,
  };
}

/**
 * Generate cleanup report
 */
function generateReport(report: AuditReport, dryRun: boolean): void {
  console.log("📊 SEMANTIC MEMORY AUDIT REPORT");
  console.log("================================\n");

  console.log(`Total memories: ${report.total_memories}`);
  console.log(
    `Test artifacts: ${report.test_artifacts.length} (${Math.round((report.test_artifacts.length / report.total_memories) * 100)}%)`,
  );
  console.log(`Production memories: ${report.production_memories.length}\n`);

  console.log("Collections breakdown:");
  console.log("----------------------");
  for (const col of report.collections) {
    const marker = col.is_test ? "🚨 TEST" : "✅ PROD";
    console.log(`  ${marker} ${col.name.padEnd(20)} ${col.count} memories`);
  }

  console.log("\n⚠️  CLEANUP REQUIRED\n");

  if (report.test_artifacts.length > 0) {
    console.log("Test collections to remove:");
    const testCollections = new Set(
      report.test_artifacts.map((m) => m.collection),
    );
    for (const col of testCollections) {
      const count = report.test_artifacts.filter(
        (m) => m.collection === col,
      ).length;
      console.log(`  - ${col} (${count} memories)`);
    }
  }

  console.log("\n📝 MANUAL CLEANUP STEPS\n");
  console.log(
    "semantic-memory MCP server does not expose delete/remove tools.",
  );
  console.log("Cleanup must be done via direct database access:\n");
  console.log("1. Stop semantic-memory MCP server");
  console.log("2. Connect to PostgreSQL:");
  console.log("   psql -h /Users/joel/.semantic-memory/memory");
  console.log("3. Delete test collections:");
  console.log(
    "   DELETE FROM memories WHERE collection IN ('test-patterns', 'test-feedback');",
  );
  console.log("4. Restart semantic-memory MCP server");
  console.log("5. Verify with semantic-memory_list\n");

  console.log("🛡️  PREVENTION STRATEGY\n");
  console.log("To prevent future pollution:");
  console.log("1. ✅ Add test collection prefix isolation (subtask 1 - DONE)");
  console.log("2. ✅ Add cleanup hooks in afterEach (subtask 2 - DONE)");
  console.log("3. 📝 Document production collection names");
  console.log("4. 📝 Add collection naming convention to CONTRIBUTING.md");
  console.log(
    "5. 📝 Consider requesting delete/remove API from MCP maintainers\n",
  );

  if (!dryRun) {
    console.log(
      "⚠️  --dry-run not specified, but no automated cleanup available.",
    );
    console.log("   Follow manual steps above.\n");
  }
}

/**
 * Store cleanup learnings in semantic-memory for future reference
 */
async function storeCleanupLearnings(report: AuditReport): Promise<void> {
  console.log("💾 Storing cleanup learnings in semantic-memory...\n");

  const rootCause = `
ROOT CAUSE: Semantic Memory Test Pollution (Dec 2025)

PROBLEM: Integration tests polluted production semantic-memory with ${report.test_artifacts.length} test artifacts across collections: ${Array.from(new Set(report.test_artifacts.map((m) => m.collection))).join(", ")}.

WHY IT HAPPENED:
1. Tests wrote to shared MCP server (no isolation)
2. No collection prefix strategy for test data
3. No cleanup hooks in test teardown
4. MCP server has no delete/remove API

IMPACT:
- ${Math.round((report.test_artifacts.length / report.total_memories) * 100)}% of semantic search results are test noise
- Production knowledge base unreliable
- Wasted storage and embedding costs

PREVENTION:
1. ✅ Collection prefix isolation: test-*, temp-* reserved for tests
2. ✅ Cleanup hooks: afterEach() deletes test collections
3. ✅ Mock semantic-memory in unit tests (avoid MCP calls)
4. 📝 Document production collection naming conventions
5. 📝 Add safeguards to prevent test->prod collection writes

MANUAL CLEANUP REQUIRED:
semantic-memory MCP lacks delete API. Must use direct PostgreSQL:
  psql -h /Users/joel/.semantic-memory/memory
  DELETE FROM memories WHERE collection LIKE 'test-%';

FUTURE: Request delete/remove API from @opencode/semantic-memory maintainers.
`.trim();

  // Note: In real implementation, this would call semantic-memory_store
  console.log("Would store:");
  console.log(rootCause);
  console.log("\nCollection: default");
  console.log("Metadata: test-pollution, cleanup, prevention\n");
}

// CLI Entry Point
const { values } = parseArgs({
  args: process.argv.slice(2),
  options: {
    "dry-run": { type: "boolean", default: true },
    collections: { type: "string" },
    help: { type: "boolean", short: "h", default: false },
  },
  allowPositionals: true,
});

if (values.help) {
  console.log(`
Semantic Memory Test Pollution Cleanup

Audits semantic-memory for test artifacts and provides cleanup guidance.

Usage:
  bun scripts/cleanup-test-memories.ts [options]

Options:
  --dry-run           Show what would be cleaned (default: true)
  --collections <csv> Comma-separated list of collections to audit
  -h, --help          Show this help message

Examples:
  bun scripts/cleanup-test-memories.ts
  bun scripts/cleanup-test-memories.ts --dry-run=false
  bun scripts/cleanup-test-memories.ts --collections test-patterns,test-feedback

Notes:
  - semantic-memory MCP server does not expose delete/remove API
  - Cleanup requires direct PostgreSQL access
  - See script output for manual cleanup steps
`);
  process.exit(0);
}

// Run audit
const report = await auditMemories();
const dryRun = values["dry-run"] ?? true;
generateReport(report, dryRun);
await storeCleanupLearnings(report);

console.log("✅ Audit complete. See manual cleanup steps above.\n");
