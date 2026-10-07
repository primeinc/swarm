/**
 * Error Enrichment Tests (RED PHASE)
 * 
 * TDD: Write tests first, then implement error-enrichment.ts
 * 
 * These tests define the contract for:
 * 1. SwarmError class - structured error context
 * 2. enrichError() - add context to any error
 * 3. debugLog() - respect DEBUG env var patterns
 * 4. suggestFix() - map error patterns to suggestions
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import {
	SwarmError,
	enrichError,
	debugLog,
	suggestFix,
	type SwarmErrorContext,
} from "./error-enrichment";

describe("error-enrichment", () => {
	// Save original env for cleanup
	let originalDebug: string | undefined;

	beforeEach(() => {
		originalDebug = process.env.DEBUG;
	});

	afterEach(() => {
		if (originalDebug !== undefined) {
			process.env.DEBUG = originalDebug;
		} else {
			delete process.env.DEBUG;
		}
	});

	describe("SwarmError", () => {
		test("is defined as a class extending Error", () => {
			expect(SwarmError).toBeDefined();
			expect(SwarmError.prototype).toBeInstanceOf(Error);
		});

		test("can be constructed with just a message", () => {
			const error = new SwarmError("something failed");
			expect(error.message).toBe("something failed");
			expect(error.name).toBe("SwarmError");
		});

		test("has structured context fields", () => {
			const context: SwarmErrorContext = {
				file: "src/worker.ts",
				line: 42,
				agent: "BlueLake",
				epic_id: "mjmas3zxlmg",
				cell_id: "mjmas408i87",
				recent_events: [
					{ type: "SPAWN", timestamp: "2025-12-25T10:00:00Z", message: "Worker spawned" },
					{ type: "RESERVE", timestamp: "2025-12-25T10:01:00Z", message: "Reserved files" },
				],
			};

			const error = new SwarmError("operation failed", context);

			expect(error.context).toBeDefined();
			expect(error.context.file).toBe("src/worker.ts");
			expect(error.context.line).toBe(42);
			expect(error.context.agent).toBe("BlueLake");
			expect(error.context.epic_id).toBe("mjmas3zxlmg");
			expect(error.context.cell_id).toBe("mjmas408i87");
			expect(error.context.recent_events).toHaveLength(2);
			expect(error.context.recent_events![0].type).toBe("SPAWN");
		});

		test("accepts partial context (minimal construction)", () => {
			const error = new SwarmError("minimal error", {
				agent: "SilverFire",
				cell_id: "mjmas408i87",
			});

			expect(error.context.agent).toBe("SilverFire");
			expect(error.context.cell_id).toBe("mjmas408i87");
			expect(error.context.file).toBeUndefined();
			expect(error.context.line).toBeUndefined();
		});

		test("serializes to JSON with context", () => {
			const error = new SwarmError("serialize me", {
				agent: "TestAgent",
				cell_id: "test-123",
			});

			const json = JSON.stringify(error);
			const parsed = JSON.parse(json);

			expect(parsed.message).toBe("serialize me");
			expect(parsed.context).toBeDefined();
			expect(parsed.context.agent).toBe("TestAgent");
		});

		test("preserves stack trace", () => {
			const error = new SwarmError("stack test");
			expect(error.stack).toBeDefined();
			expect(error.stack).toContain("stack test");
		});
	});

	describe("enrichError", () => {
		test("is defined as a function", () => {
			expect(enrichError).toBeDefined();
			expect(typeof enrichError).toBe("function");
		});

		test("converts plain Error to SwarmError with context", () => {
			const plainError = new Error("plain error");
			const context: SwarmErrorContext = {
				agent: "TestAgent",
				cell_id: "test-456",
			};

			const enriched = enrichError(plainError, context);

			expect(enriched).toBeInstanceOf(SwarmError);
			expect(enriched.message).toBe("plain error");
			expect(enriched.context.agent).toBe("TestAgent");
			expect(enriched.context.cell_id).toBe("test-456");
		});

		test("preserves original stack trace when enriching", () => {
			const originalError = new Error("original");
			const originalStack = originalError.stack;

			const enriched = enrichError(originalError, { agent: "Test" });

			expect(enriched.stack).toBe(originalStack);
		});

		test("adds context to existing SwarmError", () => {
			const swarmError = new SwarmError("already enriched", {
				agent: "Agent1",
			});

			const reEnriched = enrichError(swarmError, {
				cell_id: "new-cell",
				file: "src/test.ts",
			});

			// Should merge contexts
			expect(reEnriched.context.agent).toBe("Agent1");
			expect(reEnriched.context.cell_id).toBe("new-cell");
			expect(reEnriched.context.file).toBe("src/test.ts");
		});

		test("handles string errors by creating new SwarmError", () => {
			const enriched = enrichError("string error", { agent: "Test" });

			expect(enriched).toBeInstanceOf(SwarmError);
			expect(enriched.message).toBe("string error");
			expect(enriched.context.agent).toBe("Test");
		});

		test("handles unknown error types gracefully", () => {
			const weirdError = { weird: "object" };
			const enriched = enrichError(weirdError, { agent: "Test" });

			expect(enriched).toBeInstanceOf(SwarmError);
			expect(enriched.message).toContain("object");
		});
	});

	describe("debugLog", () => {
		test("is defined as a function", () => {
			expect(debugLog).toBeDefined();
			expect(typeof debugLog).toBe("function");
		});

		test("logs when DEBUG=swarm:* is set", () => {
			process.env.DEBUG = "swarm:*";
			
			// Capture console output
			const logs: string[] = [];
			const originalLog = console.log;
			console.log = (...args: any[]) => logs.push(args.join(" "));

			debugLog("test", "test message", { data: "value" });

			console.log = originalLog;

			expect(logs.length).toBeGreaterThan(0);
			expect(logs[0]).toContain("test");
			expect(logs[0]).toContain("test message");
		});

		test("respects DEBUG=swarm:coordinator pattern", () => {
			process.env.DEBUG = "swarm:coordinator";

			const logs: string[] = [];
			const originalLog = console.log;
			console.log = (...args: any[]) => logs.push(args.join(" "));

			// Should log coordinator messages
			debugLog("coordinator", "coordinator message");
			const coordinatorLogs = logs.length;

			// Should NOT log worker messages
			debugLog("worker", "worker message");
			const afterWorkerLogs = logs.length;

			console.log = originalLog;

			expect(coordinatorLogs).toBeGreaterThan(0);
			expect(afterWorkerLogs).toBe(coordinatorLogs); // No new logs
		});

		test("respects DEBUG=swarm:worker pattern", () => {
			process.env.DEBUG = "swarm:worker";

			const logs: string[] = [];
			const originalLog = console.log;
			console.log = (...args: any[]) => logs.push(args.join(" "));

			// Should log worker messages
			debugLog("worker", "worker message");
			const workerLogs = logs.length;

			// Should NOT log coordinator messages
			debugLog("coordinator", "coordinator message");
			const afterCoordinatorLogs = logs.length;

			console.log = originalLog;

			expect(workerLogs).toBeGreaterThan(0);
			expect(afterCoordinatorLogs).toBe(workerLogs); // No new logs
		});

		test("respects DEBUG=swarm:mail pattern", () => {
			process.env.DEBUG = "swarm:mail";

			const logs: string[] = [];
			const originalLog = console.log;
			console.log = (...args: any[]) => logs.push(args.join(" "));

			debugLog("mail", "mail message");
			const mailLogs = logs.length;

			debugLog("worker", "worker message");
			const afterOtherLogs = logs.length;

			console.log = originalLog;

			expect(mailLogs).toBeGreaterThan(0);
			expect(afterOtherLogs).toBe(mailLogs);
		});

		test("does not log when DEBUG is unset", () => {
			delete process.env.DEBUG;

			const logs: string[] = [];
			const originalLog = console.log;
			console.log = (...args: any[]) => logs.push(args.join(" "));

			debugLog("test", "should not appear");

			console.log = originalLog;

			expect(logs.length).toBe(0);
		});

		test("supports multiple DEBUG patterns with comma separator", () => {
			process.env.DEBUG = "swarm:coordinator,swarm:mail";

			const logs: string[] = [];
			const originalLog = console.log;
			console.log = (...args: any[]) => logs.push(args.join(" "));

			debugLog("coordinator", "coordinator msg");
			debugLog("mail", "mail msg");
			debugLog("worker", "worker msg"); // Should not log

			console.log = originalLog;

			expect(logs.length).toBe(2);
		});

		test("formats output with box-drawing characters", () => {
			process.env.DEBUG = "swarm:*";

			const logs: string[] = [];
			const originalLog = console.log;
			console.log = (...args: any[]) => logs.push(args.join(" "));

			debugLog("test", "formatted message");

			console.log = originalLog;

			// Should contain box-drawing chars (┌│└ etc)
			const output = logs.join("");
			expect(
				output.includes("┌") || 
				output.includes("│") || 
				output.includes("└")
			).toBe(true);
		});
	});

	describe("suggestFix", () => {
		test("is defined as a function", () => {
			expect(suggestFix).toBeDefined();
			expect(typeof suggestFix).toBe("function");
		});

		test("suggests swarmmail_init for 'agent not registered' error", () => {
			const error = new Error("Agent not registered in swarm mail database");
			const suggestion = suggestFix(error);

			expect(suggestion).toBeDefined();
			expect(suggestion).toContain("swarmmail_init");
		});

		test("suggests file reservation for 'file already reserved' error", () => {
			const error = new Error("File src/test.ts is already reserved by AnotherAgent");
			const suggestion = suggestFix(error);

			expect(suggestion).toBeDefined();
			expect(suggestion).toContain("reserved");
			expect(suggestion).toContain("release") || expect(suggestion).toContain("wait");
		});

		test("suggests hive_sync for 'uncommitted changes' error", () => {
			const error = new Error("Uncommitted changes in git working directory");
			const suggestion = suggestFix(error);

			expect(suggestion).toBeDefined();
			expect(suggestion).toContain("hive_sync") || expect(suggestion).toContain("commit");
		});

		test("suggests semantic-memory_find for 'pattern not found' errors", () => {
			const error = new Error("No similar patterns found in learning database");
			const suggestion = suggestFix(error);

			expect(suggestion).toBeDefined();
			expect(suggestion).toContain("semantic-memory_find");
		});

		test("suggests swarm_complete for 'manual close detected' errors", () => {
			const error = new Error("Manual hive_close detected in worker agent");
			const suggestion = suggestFix(error);

			expect(suggestion).toBeDefined();
			expect(suggestion).toContain("swarm_complete");
		});

		test("returns null for unknown error patterns", () => {
			const error = new Error("Completely unknown random error");
			const suggestion = suggestFix(error);

			expect(suggestion).toBeNull();
		});

		test("handles SwarmError instances with context", () => {
			const error = new SwarmError("Agent not registered", {
				agent: "TestAgent",
				cell_id: "test-123",
			});

			const suggestion = suggestFix(error);

			expect(suggestion).toBeDefined();
			expect(suggestion).toContain("swarmmail_init");
			// Should include context hints
			expect(suggestion).toContain("TestAgent") || expect(suggestion).toContain("test-123");
		});

		test("detects 'libSQL not initialized' pattern", () => {
			const error = new Error("libSQL database not initialized for project");
			const suggestion = suggestFix(error);

			expect(suggestion).toBeDefined();
			expect(suggestion).toContain("database") || expect(suggestion).toContain("init");
		});

		test("detects 'context exhausted' pattern", () => {
			const error = new Error("Context window exhausted: 195000/200000 tokens");
			const suggestion = suggestFix(error);

			expect(suggestion).toBeDefined();
			expect(suggestion).toContain("checkpoint") || expect(suggestion).toContain("context");
		});

		test("provides multiple suggestions for complex errors", () => {
			const error = new SwarmError("File reservation failed: agent not initialized", {
				agent: "TestAgent",
			});

			const suggestion = suggestFix(error);

			expect(suggestion).toBeDefined();
			// Should suggest both init and reservation steps
			expect(suggestion).toContain("swarmmail_init");
			expect(suggestion).toContain("reserve");
		});
	});
});
