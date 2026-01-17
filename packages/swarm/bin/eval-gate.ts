#!/usr/bin/env bun
/**
 * Eval Gate CLI - Run evals and fail on regression
 * 
 * Usage:
 *   bun run bin/eval-gate.ts                    # Run all evals
 *   bun run bin/eval-gate.ts --suite coordinator # Run specific suite
 *   bun run bin/eval-gate.ts --threshold 80     # Custom score threshold
 */

import { runEvals } from "../src/eval-runner.js";
import { detectRegressions } from "../src/regression-detection.js";

const args = process.argv.slice(2);

// Parse args
let suiteFilter: string | undefined;
let scoreThreshold: number | undefined;

for (let i = 0; i < args.length; i++) {
  if (args[i] === "--suite" && args[i + 1]) {
    suiteFilter = args[i + 1];
    i++;
  } else if (args[i] === "--threshold" && args[i + 1]) {
    scoreThreshold = parseInt(args[i + 1], 10);
    i++;
  }
}

async function main() {
  console.log("🔍 Running eval gates...\n");
  
  const result = await runEvals({
    cwd: process.cwd(),
    suiteFilter,
    scoreThreshold,
  });
  
  // Print results
  console.log(`📊 Results:`);
  console.log(`   Suites: ${result.totalSuites}`);
  console.log(`   Evals: ${result.totalEvals}`);
  console.log(`   Average Score: ${(result.averageScore * 100).toFixed(1)}%\n`);
  
  // Print gate results
  if (result.gateResults && result.gateResults.length > 0) {
    console.log("🚦 Gate Results:");
    for (const gate of result.gateResults) {
      const icon = gate.passed ? "✅" : "❌";
      console.log(`   ${icon} ${gate.suite}: ${gate.message}`);
    }
    console.log("");
  }
  
  // Check for regressions
  const regressions = detectRegressions(process.cwd(), 0.10);
  
  if (regressions.length > 0) {
    console.error("\n⚠️  REGRESSION DETECTED");
    for (const reg of regressions) {
      const oldPercent = (reg.oldScore * 100).toFixed(1);
      const newPercent = (reg.newScore * 100).toFixed(1);
      const deltaPercent = reg.deltaPercent.toFixed(1);
      console.error(`├── ${reg.evalName}: ${oldPercent}% → ${newPercent}% (${deltaPercent}%)`);
    }
    console.error(`└── Threshold: 10%\n`);
  }
  
  // Check for gate failures
  const failedGates = result.gateResults?.filter(g => !g.passed) || [];
  
  if (failedGates.length > 0) {
    console.error(`❌ ${failedGates.length} gate(s) failed!`);
    process.exit(1);
  }
  
  if (!result.success) {
    console.error(`❌ Evals failed threshold check`);
    process.exit(1);
  }
  
  // Exit non-zero if regressions detected (alerting mode)
  if (regressions.length > 0) {
    console.error(`❌ ${regressions.length} regression(s) detected!`);
    process.exit(1);
  }
  
  console.log("✅ All gates passed!");
  process.exit(0);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
