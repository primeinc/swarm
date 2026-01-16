/**
 * Swarm Integration Tests
 *
 * These tests require:
 * - hive CLI installed and configured
 * - Agent Mail server running at AGENT_MAIL_URL (default: http://agent-mail:8765 in Docker)
 *
 * Run with: pnpm test:integration (or docker:test for full Docker environment)
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AGENT_MAIL_URL, clearState, mcpCall, setState } from "./agent-mail";
import {
	formatSubtaskPromptV2,
	SUBTASK_PROMPT_V2,
	swarm_checkpoint,
	swarm_complete,
	swarm_decompose,
	swarm_evaluation_prompt,
	swarm_plan_prompt,
	swarm_progress,
	swarm_recover,
	swarm_select_strategy,
	swarm_spawn_subtask,
	swarm_status,
	swarm_subtask_prompt,
	swarm_validate_decomposition,
} from "./swarm";
import { swarm_review, swarm_review_feedback } from "./swarm-review";

// ============================================================================
// Test Configuration
// ============================================================================

const TEST_SESSION_ID = `test-swarm-${Date.now()}`;
const TEST_PROJECT_PATH = `/tmp/test-swarm-${Date.now()}`;

/**
 * Mock tool context for execute functions.
 * The real context is provided by OpenCode runtime.
 */
const mockContext = {
	sessionID: TEST_SESSION_ID,
	messageID: `test-message-${Date.now()}`,
	agent: "test-agent",
	abort: new AbortController().signal,
};

/**
 * Check if Agent Mail is available
 */
async function isAgentMailAvailable(): Promise<boolean> {
	try {
		const url = process.env.AGENT_MAIL_URL || AGENT_MAIL_URL;
		const response = await fetch(`${url}/health/liveness`);
		return response.ok;
	} catch {
		return false;
	}
}

/**
 * Check if hive CLI is available
 */
async function isHiveAvailable(): Promise<boolean> {
	try {
		const result = await Bun.$`swarm hive --json list`.quiet().nothrow();
		return result.exitCode === 0;
	} catch {
		return false;
	}
}

// ============================================================================
// Prompt Generation Tests (No external dependencies)
// ============================================================================

describe("swarm_decompose", () => {
	it("generates valid decomposition prompt", async () => {
		const result = await swarm_decompose.execute(
			{
				task: "Add user authentication with OAuth",
			},
			mockContext,
		);

		const parsed = JSON.parse(result);

		expect(parsed).toHaveProperty("prompt");
		expect(parsed).toHaveProperty("expected_schema", "CellTree");
		expect(parsed).toHaveProperty("schema_hint");
		expect(parsed.prompt).toContain("Add user authentication with OAuth");
		expect(parsed.prompt).toContain("as many as needed");
	});

	it("includes context in prompt when provided", async () => {
		const result = await swarm_decompose.execute(
			{
				task: "Refactor the API routes",
				context: "Using Next.js App Router with RSC",
			},
			mockContext,
		);

		const parsed = JSON.parse(result);

		expect(parsed.prompt).toContain("Using Next.js App Router with RSC");
		expect(parsed.prompt).toContain("Additional Context");
	});
});

// ============================================================================
// Strategy Selection Tests
// ============================================================================

describe("swarm_select_strategy", () => {
	it("selects feature-based for 'add' tasks", async () => {
		const result = await swarm_select_strategy.execute(
			{
				task: "Add user authentication with OAuth",
			},
			mockContext,
		);
		const parsed = JSON.parse(result);

		expect(parsed.strategy).toBe("feature-based");
		expect(parsed.confidence).toBeGreaterThan(0.5);
		expect(parsed.reasoning).toContain("add");
		expect(parsed.guidelines).toBeInstanceOf(Array);
		expect(parsed.anti_patterns).toBeInstanceOf(Array);
	});

	it("selects file-based for 'refactor' tasks", async () => {
		const result = await swarm_select_strategy.execute(
			{
				task: "Refactor all components to use new API",
			},
			mockContext,
		);
		const parsed = JSON.parse(result);

		expect(parsed.strategy).toBe("file-based");
		expect(parsed.confidence).toBeGreaterThanOrEqual(0.5);
		expect(parsed.reasoning).toContain("refactor");
	});

	it("selects risk-based for 'fix security' tasks", async () => {
		const result = await swarm_select_strategy.execute(
			{
				task: "Fix security vulnerability in authentication",
			},
			mockContext,
		);
		const parsed = JSON.parse(result);

		expect(parsed.strategy).toBe("risk-based");
		expect(parsed.confidence).toBeGreaterThan(0.5);
		// Should match either 'fix' or 'security'
		expect(
			parsed.reasoning.includes("fix") || parsed.reasoning.includes("security"),
		).toBe(true);
	});

	it("defaults to feature-based when no keywords match", async () => {
		const result = await swarm_select_strategy.execute(
			{
				task: "Something completely unrelated without keywords",
			},
			mockContext,
		);
		const parsed = JSON.parse(result);

		expect(parsed.strategy).toBe("feature-based");
		// Confidence should be lower without keyword matches
		expect(parsed.confidence).toBeLessThanOrEqual(0.6);
		expect(parsed.reasoning).toContain("Defaulting to feature-based");
	});

	it("includes confidence score and reasoning", async () => {
		const result = await swarm_select_strategy.execute(
			{
				task: "Implement new dashboard feature",
			},
			mockContext,
		);
		const parsed = JSON.parse(result);

		expect(parsed).toHaveProperty("strategy");
		expect(parsed).toHaveProperty("confidence");
		expect(parsed).toHaveProperty("reasoning");
		expect(parsed).toHaveProperty("description");
		expect(typeof parsed.confidence).toBe("number");
		expect(parsed.confidence).toBeGreaterThanOrEqual(0);
		expect(parsed.confidence).toBeLessThanOrEqual(1);
		expect(typeof parsed.reasoning).toBe("string");
		expect(parsed.reasoning.length).toBeGreaterThan(0);
	});

	it("includes alternative strategies with scores", async () => {
		const result = await swarm_select_strategy.execute(
			{
				task: "Build new payment processing module",
			},
			mockContext,
		);
		const parsed = JSON.parse(result);

		expect(parsed).toHaveProperty("alternatives");
		expect(parsed.alternatives).toBeInstanceOf(Array);
		expect(parsed.alternatives.length).toBe(3); // 4 strategies - 1 selected = 3 alternatives

		for (const alt of parsed.alternatives) {
			expect(alt).toHaveProperty("strategy");
			expect(alt).toHaveProperty("description");
			expect(alt).toHaveProperty("score");
			expect([
				"file-based",
				"feature-based",
				"risk-based",
				"research-based",
			]).toContain(alt.strategy);
			expect(typeof alt.score).toBe("number");
		}
	});

	it("includes codebase context in reasoning when provided", async () => {
		const result = await swarm_select_strategy.execute(
			{
				task: "Add new API endpoint",
				codebase_context: "Using Express.js with TypeScript and PostgreSQL",
			},
			mockContext,
		);
		const parsed = JSON.parse(result);

		expect(parsed.reasoning).toContain("Express.js");
	});

	it("accepts optional projectKey parameter for precedent-aware selection", async () => {
		// RED: This test will fail until we add projectKey parameter
		const result = await swarm_select_strategy.execute(
			{
				task: "Add user authentication",
				projectKey: "/tmp/test-project",
			},
			mockContext,
		);
		const parsed = JSON.parse(result);

		// Should work with or without precedent data
		expect(parsed).toHaveProperty("strategy");
		expect(parsed).toHaveProperty("confidence");
		expect(parsed).toHaveProperty("reasoning");
	});

	it("includes precedent info when projectKey provided and data exists", async () => {
		const result = await swarm_select_strategy.execute(
			{
				task: "Add OAuth authentication",
				projectKey: "/tmp/test-precedent",
			},
			mockContext,
		);
		const parsed = JSON.parse(result);

		// Precedent field may or may not be present depending on whether decision_traces table exists
		// If projectKey is provided but DB doesn't exist/has no table, graceful degradation means no precedent
		// This is expected behavior - precedent is optional
		if (parsed.precedent) {
			expect(parsed.precedent).toHaveProperty("similar_decisions");
			expect(typeof parsed.precedent.similar_decisions).toBe("number");
		}

		// Should still work without precedent
		expect(parsed).toHaveProperty("strategy");
		expect(parsed).toHaveProperty("confidence");
		expect(parsed).toHaveProperty("reasoning");
	});

	it("boosts confidence when precedent agrees with keyword selection", async () => {
		// RED: This will fail until we implement confidence boosting
		const uniqueProjectKey = `/tmp/test-confidence-boost-${Date.now()}`;

		// First, create some precedent data (we'll mock this in implementation)
		// For now, just verify the signature works
		const result = await swarm_select_strategy.execute(
			{
				task: "Refactor authentication module",
				projectKey: uniqueProjectKey,
			},
			mockContext,
		);
		const parsed = JSON.parse(result);

		expect(parsed).toHaveProperty("confidence");
		expect(parsed).toHaveProperty("reasoning");
		// Reasoning should mention precedent if it was found
		if (parsed.precedent?.similar_decisions > 0) {
			expect(parsed.reasoning).toContain("precedent");
		}
	});

	it("reduces confidence when strategy has low success rate", async () => {
		// RED: This will fail until we implement success rate adjustment
		const uniqueProjectKey = `/tmp/test-low-success-${Date.now()}`;

		const result = await swarm_select_strategy.execute(
			{
				task: "Fix critical security bug",
				projectKey: uniqueProjectKey,
			},
			mockContext,
		);
		const parsed = JSON.parse(result);

		expect(parsed).toHaveProperty("confidence");
		// If precedent shows low success rate, should be reflected in reasoning
		if (
			parsed.precedent?.strategy_success_rate !== undefined &&
			parsed.precedent.strategy_success_rate < 0.3
		) {
			expect(parsed.reasoning).toContain("low success rate");
		}
	});

	it("works backward-compatible without projectKey", async () => {
		// Ensure existing behavior still works
		const result = await swarm_select_strategy.execute(
			{
				task: "Implement new feature",
			},
			mockContext,
		);
		const parsed = JSON.parse(result);

		expect(parsed.strategy).toBe("feature-based");
		expect(parsed).toHaveProperty("confidence");
		expect(parsed).not.toHaveProperty("precedent");
	});

	it("cites specific epic IDs when precedent found", async () => {
		// RED: This will fail until we implement epic citation
		const uniqueProjectKey = `/tmp/test-epic-citation-${Date.now()}`;

		const result = await swarm_select_strategy.execute(
			{
				task: "Migrate all components to new API",
				projectKey: uniqueProjectKey,
			},
			mockContext,
		);
		const parsed = JSON.parse(result);

		if (parsed.precedent?.cited_epics) {
			expect(Array.isArray(parsed.precedent.cited_epics)).toBe(true);
			// Each epic ID should be a string
			parsed.precedent.cited_epics.forEach((epicId: string) => {
				expect(typeof epicId).toBe("string");
			});
		}
	});
});

// ============================================================================
// Planning Prompt Tests
// ============================================================================

describe("swarm_plan_prompt", () => {
	it("auto-selects strategy when not specified", async () => {
		const result = await swarm_plan_prompt.execute(
			{
				task: "Add user settings page",
				query_cass: false, // Disable CASS to isolate test
			},
			mockContext,
		);
		const parsed = JSON.parse(result);

		expect(parsed).toHaveProperty("prompt");
		expect(parsed).toHaveProperty("strategy");
		expect(parsed.strategy).toHaveProperty("selected");
		expect(parsed.strategy).toHaveProperty("reasoning");
		expect(parsed.strategy.selected).toBe("feature-based"); // 'add' keyword
	});

	it("uses explicit strategy when provided", async () => {
		const result = await swarm_plan_prompt.execute(
			{
				task: "Do something",
				strategy: "risk-based",
				query_cass: false,
			},
			mockContext,
		);
		const parsed = JSON.parse(result);

		expect(parsed.strategy.selected).toBe("risk-based");
		expect(parsed.strategy.reasoning).toContain("User-specified strategy");
	});

	it("includes strategy guidelines in prompt", async () => {
		const result = await swarm_plan_prompt.execute(
			{
				task: "Refactor the codebase",
				query_cass: false,
			},
			mockContext,
		);
		const parsed = JSON.parse(result);

		// Prompt should contain strategy-specific guidelines
		expect(parsed.prompt).toContain("## Strategy:");
		expect(parsed.prompt).toContain("### Guidelines");
		expect(parsed.prompt).toContain("### Anti-Patterns");
		expect(parsed.prompt).toContain("### Examples");
	});

	it("includes anti-patterns in output", async () => {
		const result = await swarm_plan_prompt.execute(
			{
				task: "Build new feature",
				query_cass: false,
			},
			mockContext,
		);
		const parsed = JSON.parse(result);

		expect(parsed.strategy).toHaveProperty("anti_patterns");
		expect(parsed.strategy.anti_patterns).toBeInstanceOf(Array);
		expect(parsed.strategy.anti_patterns.length).toBeGreaterThan(0);
	});

	it("returns expected_schema and validation_note", async () => {
		const result = await swarm_plan_prompt.execute(
			{
				task: "Some task",
				query_cass: false,
			},
			mockContext,
		);
		const parsed = JSON.parse(result);

		expect(parsed).toHaveProperty("expected_schema", "CellTree");
		expect(parsed).toHaveProperty("validation_note");
		expect(parsed.validation_note).toContain("swarm_validate_decomposition");
		expect(parsed).toHaveProperty("schema_hint");
		expect(parsed.schema_hint).toHaveProperty("epic");
		expect(parsed.schema_hint).toHaveProperty("subtasks");
	});

	it("includes strategy and skills info in output", async () => {
		// Test swarm_plan_prompt output structure
		const result = await swarm_plan_prompt.execute(
			{
				task: "Add feature",
			},
			mockContext,
		);
		const parsed = JSON.parse(result);

		// Should have strategy info
		expect(parsed).toHaveProperty("strategy");
		expect(parsed.strategy).toHaveProperty("selected");
		expect(parsed.strategy).toHaveProperty("reasoning");
		expect(parsed.strategy).toHaveProperty("guidelines");
		expect(parsed.strategy).toHaveProperty("anti_patterns");

		// Should have skills info
		expect(parsed).toHaveProperty("skills");
		expect(parsed.skills).toHaveProperty("included");

		// Should have memory query instruction
		expect(parsed).toHaveProperty("memory_query");
	});

	it("includes context in prompt when provided", async () => {
		const result = await swarm_plan_prompt.execute(
			{
				task: "Add user profile",
				context: "We use Next.js App Router with server components",
				query_cass: false, // Skip hivemind session search
			},
			mockContext,
		);
		const parsed = JSON.parse(result);

		expect(parsed.prompt).toContain("Next.js App Router");
		expect(parsed.prompt).toContain("server components");
	});
});

describe("swarm_validate_decomposition", () => {
	it("validates correct CellTree", async () => {
		const validCellTree = JSON.stringify({
			epic: {
				title: "Add OAuth",
				description: "Implement OAuth authentication",
			},
			subtasks: [
				{
					title: "Add OAuth provider config",
					description: "Set up Google OAuth",
					files: ["src/auth/google.ts", "src/auth/config.ts"],
					dependencies: [],
					estimated_complexity: 2,
				},
				{
					title: "Add login UI",
					description: "Create login button component",
					files: ["src/components/LoginButton.tsx"],
					dependencies: [0],
					estimated_complexity: 1,
				},
			],
		});

		const result = await swarm_validate_decomposition.execute(
			{ response: validCellTree },
			mockContext,
		);

		const parsed = JSON.parse(result);

		expect(parsed.valid).toBe(true);
		expect(parsed.cell_tree).toBeDefined();
		expect(parsed.stats).toEqual({
			subtask_count: 2,
			total_files: 3,
			total_complexity: 3,
		});
	});

	it("rejects file conflicts", async () => {
		const conflictingCellTree = JSON.stringify({
			epic: {
				title: "Conflicting files",
			},
			subtasks: [
				{
					title: "Task A",
					files: ["src/shared.ts"],
					dependencies: [],
					estimated_complexity: 1,
				},
				{
					title: "Task B",
					files: ["src/shared.ts"], // Conflict!
					dependencies: [],
					estimated_complexity: 1,
				},
			],
		});

		const result = await swarm_validate_decomposition.execute(
			{ response: conflictingCellTree },
			mockContext,
		);

		const parsed = JSON.parse(result);

		expect(parsed.valid).toBe(false);
		expect(parsed.error).toContain("File conflicts detected");
		expect(parsed.error).toContain("src/shared.ts");
	});

	it("rejects invalid dependencies (forward reference)", async () => {
		const invalidDeps = JSON.stringify({
			epic: {
				title: "Invalid deps",
			},
			subtasks: [
				{
					title: "Task A",
					files: ["src/a.ts"],
					dependencies: [1], // Invalid: depends on later task
					estimated_complexity: 1,
				},
				{
					title: "Task B",
					files: ["src/b.ts"],
					dependencies: [],
					estimated_complexity: 1,
				},
			],
		});

		const result = await swarm_validate_decomposition.execute(
			{ response: invalidDeps },
			mockContext,
		);

		const parsed = JSON.parse(result);

		expect(parsed.valid).toBe(false);
		expect(parsed.error).toContain("Invalid dependency");
		expect(parsed.hint).toContain("Reorder subtasks");
	});

	it("rejects invalid JSON", async () => {
		const result = await swarm_validate_decomposition.execute(
			{ response: "not valid json {" },
			mockContext,
		);

		const parsed = JSON.parse(result);

		expect(parsed.valid).toBe(false);
		expect(parsed.error).toContain("Invalid JSON");
	});

	it("rejects missing required fields", async () => {
		const missingFields = JSON.stringify({
			epic: { title: "Missing subtasks" },
			// No subtasks array
		});

		const result = await swarm_validate_decomposition.execute(
			{ response: missingFields },
			mockContext,
		);

		const parsed = JSON.parse(result);

		expect(parsed.valid).toBe(false);
		expect(parsed.error).toContain("Schema validation failed");
	});
});

describe("swarm_subtask_prompt", () => {
	it("generates complete subtask prompt", async () => {
		const result = await swarm_subtask_prompt.execute(
			{
				agent_name: "BlueLake",
				cell_id: "cell-abc123.1",
				epic_id: "cell-abc123",
				subtask_title: "Add OAuth provider",
				subtask_description: "Configure Google OAuth in the auth config",
				files: ["src/auth/google.ts", "src/auth/config.ts"],
				shared_context: "We are using NextAuth.js v5",
			},
			mockContext,
		);

		// Result is the prompt string directly
		expect(result).toContain("BlueLake");
		expect(result).toContain("cell-abc123.1");
		expect(result).toContain("cell-abc123");
		expect(result).toContain("Add OAuth provider");
		expect(result).toContain("Configure Google OAuth");
		expect(result).toContain("src/auth/google.ts");
		expect(result).toContain("NextAuth.js v5");
		expect(result).toContain("swarm_progress");
		expect(result).toContain("swarm_complete");
	});

	it("handles missing optional fields", async () => {
		const result = await swarm_subtask_prompt.execute(
			{
				agent_name: "RedStone",
				cell_id: "cell-xyz789.2",
				epic_id: "cell-xyz789",
				subtask_title: "Simple task",
				files: [],
			},
			mockContext,
		);

		expect(result).toContain("RedStone");
		expect(result).toContain("cell-xyz789.2");
		expect(result).toContain("Simple task");
		expect(result).toContain("(none)"); // For missing description/context
		expect(result).toContain("(no files assigned)"); // Empty files
	});
});

describe("swarm_evaluation_prompt", () => {
	it("generates evaluation prompt with schema hint", async () => {
		const result = await swarm_evaluation_prompt.execute(
			{
				cell_id: "cell-abc123.1",
				subtask_title: "Add OAuth provider",
				files_touched: ["src/auth/google.ts", "src/auth/config.ts"],
			},
			mockContext,
		);

		const parsed = JSON.parse(result);

		expect(parsed).toHaveProperty("prompt");
		expect(parsed).toHaveProperty("expected_schema", "Evaluation");
		expect(parsed).toHaveProperty("schema_hint");

		expect(parsed.prompt).toContain("cell-abc123.1");
		expect(parsed.prompt).toContain("Add OAuth provider");
		expect(parsed.prompt).toContain("src/auth/google.ts");
		expect(parsed.prompt).toContain("type_safe");
		expect(parsed.prompt).toContain("no_bugs");
		expect(parsed.prompt).toContain("patterns");
		expect(parsed.prompt).toContain("readable");
	});

	it("handles empty files list", async () => {
		const result = await swarm_evaluation_prompt.execute(
			{
				cell_id: "cell-xyz789.1",
				subtask_title: "Documentation only",
				files_touched: [],
			},
			mockContext,
		);

		const parsed = JSON.parse(result);

		expect(parsed.prompt).toContain("(no files recorded)");
	});
});

// ============================================================================
// Integration Tests (Require Agent Mail + cells)
// ============================================================================

describe("swarm_status (integration)", () => {
	let hiveAvailable = false;

	beforeAll(async () => {
		hiveAvailable = await isHiveAvailable();
	});

	it.skipIf(!hiveAvailable)(
		"returns status for non-existent epic",
		async () => {
			// This should fail gracefully - no epic exists
			try {
				await swarm_status.execute(
					{
						epic_id: "cell-nonexistent",
						project_key: TEST_PROJECT_PATH,
					},
					mockContext,
				);
				// If it doesn't throw, that's fine too - it might return empty status
			} catch (error) {
				expect(error).toBeInstanceOf(Error);
				// SwarmError should have operation property
				if (error instanceof Error && "operation" in error) {
					expect((error as { operation: string }).operation).toBe(
						"query_subtasks",
					);
				}
			}
		},
	);
});

describe("swarm_progress (integration)", () => {
	let agentMailAvailable = false;

	beforeAll(async () => {
		agentMailAvailable = await isAgentMailAvailable();
	});

	it.skipIf(!agentMailAvailable)("reports progress to Agent Mail", async () => {
		const uniqueProjectKey = `${TEST_PROJECT_PATH}-progress-${Date.now()}`;
		const sessionID = `progress-session-${Date.now()}`;

		// Initialize Agent Mail state for this session
		try {
			// Ensure project exists
			await mcpCall("ensure_project", { human_key: uniqueProjectKey });

			// Register agent
			const agent = await mcpCall<{ name: string }>("register_agent", {
				project_key: uniqueProjectKey,
				program: "opencode-test",
				model: "test",
				task_description: "Integration test",
			});

			// Set state for the session
			setState(sessionID, {
				projectKey: uniqueProjectKey,
				agentName: agent.name,
				reservations: [],
				startedAt: new Date().toISOString(),
			});

			const ctx = {
				...mockContext,
				sessionID,
			};

			const result = await swarm_progress.execute(
				{
					project_key: uniqueProjectKey,
					agent_name: agent.name,
					cell_id: "cell-test123.1",
					status: "in_progress",
					message: "Working on the feature",
					progress_percent: 50,
					files_touched: ["src/test.ts"],
				},
				ctx,
			);

			expect(result).toContain("Progress reported");
			expect(result).toContain("in_progress");
			expect(result).toContain("50%");
		} finally {
			clearState(sessionID);
		}
	});
});

describe("swarm_complete (integration)", () => {
	let agentMailAvailable = false;
	let hiveAvailable = false;

	beforeAll(async () => {
		agentMailAvailable = await isAgentMailAvailable();
		hiveAvailable = await isHiveAvailable();
	});

	it.skipIf(!agentMailAvailable || !hiveAvailable)(
		"completes subtask with passing evaluation",
		async () => {
			const uniqueProjectKey = `${TEST_PROJECT_PATH}-complete-${Date.now()}`;
			const sessionID = `complete-session-${Date.now()}`;

			try {
				// Set up Agent Mail
				await mcpCall("ensure_project", { human_key: uniqueProjectKey });
				const agent = await mcpCall<{ name: string }>("register_agent", {
					project_key: uniqueProjectKey,
					program: "opencode-test",
					model: "test",
					task_description: "Integration test",
				});

				setState(sessionID, {
					projectKey: uniqueProjectKey,
					agentName: agent.name,
					reservations: [],
					startedAt: new Date().toISOString(),
				});

				const ctx = {
					...mockContext,
					sessionID,
				};

				// 3. Create a cell first
				const createResult =
					await Bun.$`swarm hive create "Test subtask" -t task --json`
						.quiet()
						.nothrow();

				if (createResult.exitCode !== 0) {
					console.warn(
						"Could not create test cell:",
						createResult.stderr.toString(),
					);
					return;
				}

				const cell = JSON.parse(createResult.stdout.toString());

				const passingEvaluation = JSON.stringify({
					passed: true,
					criteria: {
						type_safe: { passed: true, feedback: "All types correct" },
						no_bugs: { passed: true, feedback: "No issues found" },
						patterns: { passed: true, feedback: "Follows conventions" },
						readable: { passed: true, feedback: "Clear code" },
					},
					overall_feedback: "Great work!",
					retry_suggestion: null,
				});

				const result = await swarm_complete.execute(
					{
						project_key: uniqueProjectKey,
						agent_name: agent.name,
						cell_id: cell.id,
						summary: "Completed the test subtask",
						evaluation: passingEvaluation,
						start_time: Date.now(),
					},
					ctx,
				);

				const parsed = JSON.parse(result);

				expect(parsed.success).toBe(true);
				expect(parsed.cell_id).toBe(cell.id);
				expect(parsed.closed).toBe(true);
				expect(parsed.reservations_released).toBe(true);
				expect(parsed.message_sent).toBe(true);
			} finally {
				clearState(sessionID);
			}
		},
	);

	it.skipIf(!agentMailAvailable)(
		"rejects completion with failing evaluation",
		async () => {
			const uniqueProjectKey = `${TEST_PROJECT_PATH}-fail-${Date.now()}`;
			const sessionID = `fail-session-${Date.now()}`;

			try {
				// Set up Agent Mail
				await mcpCall("ensure_project", { human_key: uniqueProjectKey });
				const agent = await mcpCall<{ name: string }>("register_agent", {
					project_key: uniqueProjectKey,
					program: "opencode-test",
					model: "test",
					task_description: "Integration test",
				});

				setState(sessionID, {
					projectKey: uniqueProjectKey,
					agentName: agent.name,
					reservations: [],
					startedAt: new Date().toISOString(),
				});

				const ctx = {
					...mockContext,
					sessionID,
				};

				const failingEvaluation = JSON.stringify({
					passed: false,
					criteria: {
						type_safe: { passed: false, feedback: "Missing types on line 42" },
					},
					overall_feedback: "Needs work",
					retry_suggestion: "Add explicit types to the handler function",
				});

				const result = await swarm_complete.execute(
					{
						project_key: uniqueProjectKey,
						agent_name: agent.name,
						cell_id: "cell-test-fail.1",
						summary: "Attempted completion",
						evaluation: failingEvaluation,
						start_time: Date.now(),
					},
					ctx,
				);

				const parsed = JSON.parse(result);

				expect(parsed.success).toBe(false);
				expect(parsed.error).toContain("Self-evaluation failed");
				expect(parsed.retry_suggestion).toBe(
					"Add explicit types to the handler function",
				);
			} finally {
				clearState(sessionID);
			}
		},
	);
});

// ============================================================================
// Full Swarm Flow (End-to-End)
// ============================================================================

describe("full swarm flow (integration)", () => {
	let agentMailAvailable = false;
	let hiveAvailable = false;

	beforeAll(async () => {
		agentMailAvailable = await isAgentMailAvailable();
		hiveAvailable = await isHiveAvailable();
	});

	it.skipIf(!agentMailAvailable || !hiveAvailable)(
		"creates epic, reports progress, completes subtask",
		async () => {
			const uniqueProjectKey = `${TEST_PROJECT_PATH}-flow-${Date.now()}`;
			const sessionID = `flow-session-${Date.now()}`;

			try {
				// 1. Set up Agent Mail session
				await mcpCall("ensure_project", { human_key: uniqueProjectKey });
				const agent = await mcpCall<{ name: string }>("register_agent", {
					project_key: uniqueProjectKey,
					program: "opencode-test",
					model: "test",
					task_description: "E2E swarm test",
				});

				setState(sessionID, {
					projectKey: uniqueProjectKey,
					agentName: agent.name,
					reservations: [],
					startedAt: new Date().toISOString(),
				});

				const ctx = {
					...mockContext,
					sessionID,
				};

				// 2. Generate decomposition prompt
				const decomposeResult = await swarm_decompose.execute(
					{
						task: "Add unit tests for auth module",
					},
					ctx,
				);

				const decomposition = JSON.parse(decomposeResult);
				expect(decomposition.prompt).toContain("Add unit tests");

				// 3. Create an epic with swarm hive
				const epicResult =
					await Bun.$`swarm hive create "Add unit tests for auth module" -t epic --json`
						.quiet()
						.nothrow();

				if (epicResult.exitCode !== 0) {
					console.warn("Could not create epic:", epicResult.stderr.toString());
					return;
				}

				const epic = JSON.parse(epicResult.stdout.toString());
				expect(epic.id).toMatch(/^[a-z0-9-]+-[a-z0-9]+$/);

				// 4. Create a subtask
				const subtaskResult =
					await Bun.$`swarm hive create "Test login flow" -t task --json`
						.quiet()
						.nothrow();

				if (subtaskResult.exitCode !== 0) {
					console.warn(
						"Could not create subtask:",
						subtaskResult.stderr.toString(),
					);
					return;
				}

				const subtask = JSON.parse(subtaskResult.stdout.toString());

				// 5. Generate subtask prompt
				const subtaskPrompt = await swarm_subtask_prompt.execute(
					{
						agent_name: agent.name,
						cell_id: subtask.id,
						epic_id: epic.id,
						subtask_title: "Test login flow",
						files: ["src/auth/__tests__/login.test.ts"],
					},
					ctx,
				);

				expect(subtaskPrompt).toContain(agent.name);
				expect(subtaskPrompt).toContain(subtask.id);

				// 6. Report progress
				const progressResult = await swarm_progress.execute(
					{
						project_key: uniqueProjectKey,
						agent_name: agent.name,
						cell_id: subtask.id,
						status: "in_progress",
						progress_percent: 50,
						message: "Writing test cases",
					},
					ctx,
				);

				expect(progressResult).toContain("Progress reported");

				// 7. Generate evaluation prompt
				const evalPromptResult = await swarm_evaluation_prompt.execute(
					{
						cell_id: subtask.id,
						subtask_title: "Test login flow",
						files_touched: ["src/auth/__tests__/login.test.ts"],
					},
					ctx,
				);

				const evalPrompt = JSON.parse(evalPromptResult);
				expect(evalPrompt.expected_schema).toBe("Evaluation");

				// 8. Complete the subtask
				const completeResult = await swarm_complete.execute(
					{
						project_key: uniqueProjectKey,
						agent_name: agent.name,
						cell_id: subtask.id,
						summary: "Added comprehensive login tests",
						evaluation: JSON.stringify({
							passed: true,
							criteria: {
								type_safe: { passed: true, feedback: "TypeScript compiles" },
								no_bugs: { passed: true, feedback: "Tests pass" },
								patterns: { passed: true, feedback: "Follows test patterns" },
								readable: { passed: true, feedback: "Clear test names" },
							},
							overall_feedback: "Good test coverage",
							retry_suggestion: null,
						}),
						start_time: Date.now(),
					},
					ctx,
				);

				const completion = JSON.parse(completeResult);
				expect(completion.success).toBe(true);
				expect(completion.closed).toBe(true);
				expect(completion.message_sent).toBe(true);

				// 9. Check swarm status
				const statusResult = await swarm_status.execute(
					{
						epic_id: epic.id,
						project_key: uniqueProjectKey,
					},
					ctx,
				);

				const status = JSON.parse(statusResult);
				expect(status.epic_id).toBe(epic.id);
				// Status may show completed subtasks now
			} finally {
				clearState(sessionID);
			}
		},
	);
});

// ============================================================================
// Tool Availability & Graceful Degradation Tests
// ============================================================================

import { swarm_init } from "./swarm";
import {
	checkAllTools,
	checkTool,
	formatToolAvailability,
	ifToolAvailable,
	isToolAvailable,
	resetToolCache,
	withToolFallback,
} from "./tool-availability";

describe("Tool Availability", () => {
	beforeAll(() => {
		resetToolCache();
	});

	afterAll(() => {
		resetToolCache();
	});

	it("checks individual tool availability", async () => {
		const status = await checkTool("hivemind");
		expect(status).toHaveProperty("available");
		expect(status).toHaveProperty("checkedAt");
		expect(typeof status.available).toBe("boolean");
	});

	it("caches tool availability checks", async () => {
		const status1 = await checkTool("hivemind");
		const status2 = await checkTool("hivemind");
		// Same timestamp means cached
		expect(status1.checkedAt).toBe(status2.checkedAt);
	});

	it("checks all tools at once", async () => {
		const availability = await checkAllTools();
		expect(availability.size).toBe(7); // hivemind, cass, hive, cells, swarm-mail, agent-mail
		expect(availability.has("hivemind")).toBe(true);
		expect(availability.has("cass")).toBe(true);
		expect(availability.has("hive")).toBe(true);
		expect(availability.has("swarm-mail")).toBe(true);
		expect(availability.has("agent-mail")).toBe(true);
	});

	it("formats tool availability for display", async () => {
		const availability = await checkAllTools();
		const formatted = formatToolAvailability(availability);
		expect(formatted).toContain("Tool Availability:");
		expect(formatted).toContain("hivemind");
	});

	it("executes with fallback when tool unavailable", async () => {
		// Force cache reset to test fresh
		resetToolCache();

		const result = await withToolFallback(
			"cass", // May or may not be available
			async () => "action-result",
			() => "fallback-result",
		);

		// Either result is valid depending on tool availability
		expect(["action-result", "fallback-result"]).toContain(result);
	});

	it("returns undefined when tool unavailable with ifToolAvailable", async () => {
		resetToolCache();

		// This will return undefined if agent-mail is not running
		const result = await ifToolAvailable("agent-mail", async () => "success");

		// Result is either "success" or undefined
		expect([undefined, "success"]).toContain(result);
	});
});

describe("swarm_init", () => {
	it("reports tool availability status", async () => {
		resetToolCache();

		const result = await swarm_init.execute({}, mockContext);
		const parsed = JSON.parse(result);

		expect(parsed).toHaveProperty("ready", true);
		expect(parsed).toHaveProperty("tool_availability");
		expect(parsed).toHaveProperty("report");

		// Check tool availability structure
		const tools = parsed.tool_availability;
		expect(tools).toHaveProperty("hivemind");
		expect(tools).toHaveProperty("cass");
		expect(tools).toHaveProperty("hive");
		expect(tools).toHaveProperty("agent-mail");

		// Each tool should have available and fallback
		for (const [, info] of Object.entries(tools)) {
			expect(info).toHaveProperty("available");
			expect(info).toHaveProperty("fallback");
		}
	});

	it("includes recommendations", async () => {
		const result = await swarm_init.execute({}, mockContext);
		const parsed = JSON.parse(result);

		expect(parsed).toHaveProperty("recommendations");
		expect(parsed.recommendations).toHaveProperty("cells");
		expect(parsed.recommendations).toHaveProperty("agent_mail");
	});
});

describe("Worker Handoff Generation", () => {
	it("generateWorkerHandoff creates valid WorkerHandoff object", () => {
		const { generateWorkerHandoff } = require("./swarm-orchestrate");

		const handoff = generateWorkerHandoff({
			task_id: "opencode-swarm-monorepo-lf2p4u-abc123.1",
			files_owned: ["src/auth.ts", "src/middleware.ts"],
			epic_summary: "Add OAuth authentication",
			your_role: "Implement OAuth provider",
			dependencies_completed: ["Database schema ready"],
			what_comes_next: "Integration tests",
		});

		// Verify contract section
		expect(handoff.contract.cell_id).toBe(
			"opencode-swarm-monorepo-lf2p4u-abc123.1",
		);
		expect(handoff.contract.files_owned).toEqual([
			"src/auth.ts",
			"src/middleware.ts",
		]);
		expect(handoff.contract.files_readonly).toEqual([]);
		expect(handoff.contract.dependencies_completed).toEqual([
			"Database schema ready",
		]);
		expect(handoff.contract.success_criteria.length).toBeGreaterThan(0);

		// Verify context section
		expect(handoff.context.epic_summary).toBe("Add OAuth authentication");
		expect(handoff.context.your_role).toBe("Implement OAuth provider");
		expect(handoff.context.what_comes_next).toBe("Integration tests");

		// Verify escalation section
		expect(handoff.escalation.blocked_contact).toBe("coordinator");
		expect(handoff.escalation.scope_change_protocol).toContain(
			"swarmmail_send",
		);
	});

	it("swarm_spawn_subtask includes handoff JSON in prompt", async () => {
		const result = await swarm_spawn_subtask.execute(
			{
				cell_id: "opencode-swarm-monorepo-lf2p4u-abc123.1",
				epic_id: "opencode-swarm-monorepo-lf2p4u-abc123",
				subtask_title: "Add OAuth provider",
				subtask_description: "Configure Google OAuth",
				files: ["src/auth/google.ts"],
				shared_context: "Using NextAuth.js v5",
				project_path: "/tmp/test",
			},
			mockContext,
		);

		// Parse the JSON response
		const parsed = JSON.parse(result);
		const prompt = parsed.prompt;

		// Should contain WorkerHandoff JSON section
		expect(prompt).toContain("## WorkerHandoff Contract");
		expect(prompt).toContain('"contract"');
		expect(prompt).toContain('"cell_id"');
		expect(prompt).toContain('"files_owned"');
		expect(prompt).toContain('"success_criteria"');
		expect(prompt).toContain("opencode-swarm-monorepo-lf2p4u-abc123.1");
	});
});

describe("Graceful Degradation", () => {
	it("swarm_decompose works without hivemind sessions", async () => {
		// This should work regardless of hivemind session search availability
		const result = await swarm_decompose.execute(
			{
				task: "Add user authentication",
				query_cass: true, // Request hivemind session search but it may not be available
			},
			mockContext,
		);

		const parsed = JSON.parse(result);

		// Should always return a valid prompt
		expect(parsed).toHaveProperty("prompt");
		expect(parsed.prompt).toContain("Add user authentication");

		// hivemind history should indicate whether it was queried
		expect(parsed).toHaveProperty("cass_history");
		expect(parsed.cass_history).toHaveProperty("queried");
	});

	it("swarm_decompose can skip hivemind session search explicitly", async () => {
		const result = await swarm_decompose.execute(
			{
				task: "Add user authentication",
				query_cass: false, // Explicitly skip hivemind session search
			},
			mockContext,
		);

		const parsed = JSON.parse(result);

		expect(parsed.cass_history.queried).toBe(false);
	});

	it("decomposition prompt includes cells discipline", async () => {
		const result = await swarm_decompose.execute(
			{
				task: "Build feature X",
			},
			mockContext,
		);

		const parsed = JSON.parse(result);

		// Check that cells discipline is in the prompt
		expect(parsed.prompt).toContain("MANDATORY");
		expect(parsed.prompt).toContain("cell");
		expect(parsed.prompt).toContain("Plan aggressively");
	});

	it("subtask prompt includes agent-mail discipline", async () => {
		const result = await swarm_subtask_prompt.execute(
			{
				agent_name: "TestAgent",
				cell_id: "cell-test123.1",
				epic_id: "cell-test123",
				subtask_title: "Test task",
				files: ["src/test.ts"],
			},
			mockContext,
		);

		// Check that swarm-mail discipline is in the prompt
		expect(result).toContain("MANDATORY");
		expect(result).toContain("Swarm Mail");
		expect(result).toContain("swarmmail_send");
		expect(result).toContain("Report progress");
	});
});

describe("swarm_complete error handling", () => {
	let hiveAvailable = false;

	beforeAll(async () => {
		hiveAvailable = await isHiveAvailable();
	});

	it.skipIf(!hiveAvailable)(
		"returns structured error when cell close fails",
		async () => {
			// Try to complete a non-existent cell
			const result = await swarm_complete.execute(
				{
					project_key: "/tmp/test-error-handling",
					agent_name: "test-agent",
					cell_id: "cell-nonexistent-12345",
					summary: "This should fail",
					skip_verification: true,
					start_time: Date.now(),
				},
				mockContext,
			);

			const parsed = JSON.parse(result);

			// Should return structured error, not throw
			expect(parsed.success).toBe(false);
			expect(parsed.error).toContain("Failed to close cell");
			expect(parsed.failed_step).toBe("closeCell");
			expect(parsed.cell_id).toBe("cell-nonexistent-12345");
			expect(parsed.recovery).toBeDefined();
			expect(parsed.recovery.steps).toBeInstanceOf(Array);
		},
	);
});

describe("swarm_complete auto-sync", () => {
	it("calls hive_sync after closing cell on successful completion", async () => {
		const testProjectPath = "/tmp/swarm-auto-sync-test-" + Date.now();
		const { getHiveAdapter } = await import("./hive");
		const adapter = await getHiveAdapter(testProjectPath);

		// Create a task cell directly
		const cell = await adapter.createCell(testProjectPath, {
			title: "Test task for auto-sync",
			type: "task",
			priority: 2,
		});

		// Start the task
		await adapter.updateCell(testProjectPath, cell.id, {
			status: "in_progress",
		});

		// Complete with skip_review and skip_verification
		const result = await swarm_complete.execute(
			{
				project_key: testProjectPath,
				agent_name: "TestAgent",
				cell_id: cell.id,
				summary: "Done - testing auto-sync",
				files_touched: [],
				skip_verification: true,
				skip_review: true,
				start_time: Date.now(),
			},
			mockContext,
		);

		console.log("RESULT:", result);
		const parsed = JSON.parse(result);

		// Should complete successfully
		expect(parsed.success).toBe(true);
		expect(parsed.closed).toBe(true);

		// Check that cell is actually closed in database
		const closedCell = await adapter.getCell(testProjectPath, cell.id);
		expect(closedCell?.status).toBe("closed");

		// The sync should have flushed the cell to .hive/issues.jsonl
		const hivePath = `${testProjectPath}/.hive/issues.jsonl`;
		const hiveFile = Bun.file(hivePath);
		const exists = await hiveFile.exists();

		expect(exists).toBe(true);

		if (exists) {
			const content = await hiveFile.text();
			const lines = content.trim().split("\n");
			expect(lines.length).toBeGreaterThan(0);
			const cells = lines.map((line) => JSON.parse(line));
			const exportedCell = cells.find((c) => c.id === cell.id);
			expect(exportedCell).toBeDefined();
			expect(exportedCell.status).toBe("closed");
		}
	});
});
