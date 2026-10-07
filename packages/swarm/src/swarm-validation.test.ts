/**
 * Unit tests for Swarm Validation Hook
 *
 * Tests:
 * - ValidationIssue schema validation
 * - runPostSwarmValidation hook
 * - reportIssue helper
 * - Event emission
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	reportIssue,
	runPostSwarmValidation,
	type ValidationContext,
	type ValidationIssue,
	ValidationIssueCategory,
	ValidationIssueSchema,
	ValidationIssueSeverity,
} from "./swarm-validation";

// ============================================================================
// Schema Validation Tests
// ============================================================================

describe("ValidationIssueSeverity", () => {
	it("validates error severity", () => {
		expect(() => ValidationIssueSeverity.parse("error")).not.toThrow();
	});

	it("validates warning severity", () => {
		expect(() => ValidationIssueSeverity.parse("warning")).not.toThrow();
	});

	it("validates info severity", () => {
		expect(() => ValidationIssueSeverity.parse("info")).not.toThrow();
	});

	it("rejects invalid severity", () => {
		expect(() => ValidationIssueSeverity.parse("critical")).toThrow();
	});
});

describe("ValidationIssueCategory", () => {
	it("validates schema_mismatch category", () => {
		expect(() =>
			ValidationIssueCategory.parse("schema_mismatch"),
		).not.toThrow();
	});

	it("validates missing_event category", () => {
		expect(() => ValidationIssueCategory.parse("missing_event")).not.toThrow();
	});

	it("validates undefined_value category", () => {
		expect(() =>
			ValidationIssueCategory.parse("undefined_value"),
		).not.toThrow();
	});

	it("validates dashboard_render category", () => {
		expect(() =>
			ValidationIssueCategory.parse("dashboard_render"),
		).not.toThrow();
	});

	it("validates websocket_delivery category", () => {
		expect(() =>
			ValidationIssueCategory.parse("websocket_delivery"),
		).not.toThrow();
	});

	it("rejects invalid category", () => {
		expect(() => ValidationIssueCategory.parse("unknown")).toThrow();
	});
});

describe("ValidationIssueSchema", () => {
	it("validates a complete issue", () => {
		const issue = {
			severity: "error" as const,
			category: "schema_mismatch" as const,
			message: "Missing required field",
			location: {
				event_type: "worker_spawned",
				field: "worker_agent",
				component: "Dashboard",
			},
		};
		expect(() => ValidationIssueSchema.parse(issue)).not.toThrow();
	});

	it("validates issue without location", () => {
		const issue = {
			severity: "warning" as const,
			category: "undefined_value" as const,
			message: "Optional field is undefined",
		};
		expect(() => ValidationIssueSchema.parse(issue)).not.toThrow();
	});

	it("validates issue with partial location", () => {
		const issue = {
			severity: "info" as const,
			category: "dashboard_render" as const,
			message: "Component rendering",
			location: {
				component: "Dashboard",
			},
		};
		expect(() => ValidationIssueSchema.parse(issue)).not.toThrow();
	});

	it("requires severity", () => {
		const issue = {
			category: "schema_mismatch" as const,
			message: "Test",
		};
		expect(() => ValidationIssueSchema.parse(issue)).toThrow();
	});

	it("requires category", () => {
		const issue = {
			severity: "error" as const,
			message: "Test",
		};
		expect(() => ValidationIssueSchema.parse(issue)).toThrow();
	});

	it("requires message", () => {
		const issue = {
			severity: "error" as const,
			category: "schema_mismatch" as const,
		};
		expect(() => ValidationIssueSchema.parse(issue)).toThrow();
	});
});

// ============================================================================
// Validation Hook Tests
// ============================================================================

describe("runPostSwarmValidation", () => {
	let mockEmit: ReturnType<typeof vi.fn>;
	let ctx: ValidationContext;

	beforeEach(() => {
		mockEmit = vi.fn().mockResolvedValue(undefined);
		ctx = {
			epic_id: "cell-123",
			swarm_id: "swarm-456",
			started_at: new Date(),
			emit: mockEmit,
		};
	});

	it("emits validation_started event", async () => {
		await runPostSwarmValidation(ctx, []);

		expect(mockEmit).toHaveBeenCalledWith(
			expect.objectContaining({
				type: "validation_started",
				epic_id: "cell-123",
				swarm_id: "swarm-456",
			}),
		);
	});

	it("emits validation_completed event", async () => {
		await runPostSwarmValidation(ctx, []);

		expect(mockEmit).toHaveBeenCalledWith(
			expect.objectContaining({
				type: "validation_completed",
				epic_id: "cell-123",
				swarm_id: "swarm-456",
				passed: true,
				issue_count: 0,
			}),
		);
	});

	it("returns passed: true with no issues", async () => {
		const result = await runPostSwarmValidation(ctx, []);

		expect(result.passed).toBe(true);
		expect(result.issues).toEqual([]);
	});

	it("calculates duration in validation_completed event", async () => {
		await runPostSwarmValidation(ctx, []);

		const completedCall = mockEmit.mock.calls.find(
			(call) => call[0].type === "validation_completed",
		);
		expect(completedCall).toBeDefined();
		expect(completedCall![0].duration_ms).toBeGreaterThanOrEqual(0);
	});

	it("emits events in correct order", async () => {
		await runPostSwarmValidation(ctx, []);

		expect(mockEmit).toHaveBeenNthCalledWith(
			1,
			expect.objectContaining({ type: "validation_started" }),
		);
		expect(mockEmit).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({ type: "validation_completed" }),
		);
	});
});

// ============================================================================
// reportIssue Helper Tests
// ============================================================================

describe("reportIssue", () => {
	let mockEmit: ReturnType<typeof vi.fn>;
	let ctx: ValidationContext;

	beforeEach(() => {
		mockEmit = vi.fn().mockResolvedValue(undefined);
		ctx = {
			epic_id: "cell-123",
			swarm_id: "swarm-456",
			started_at: new Date(),
			emit: mockEmit,
		};
	});

	it("emits validation_issue event with issue details", async () => {
		const issue: ValidationIssue = {
			severity: "error",
			category: "schema_mismatch",
			message: "Missing required field",
			location: {
				event_type: "worker_spawned",
				field: "worker_agent",
			},
		};

		await reportIssue(ctx, issue);

		expect(mockEmit).toHaveBeenCalledWith(
			expect.objectContaining({
				type: "validation_issue",
				epic_id: "cell-123",
				severity: "error",
				category: "schema_mismatch",
				message: "Missing required field",
				location: {
					event_type: "worker_spawned",
					field: "worker_agent",
				},
			}),
		);
	});

	it("includes timestamp in event", async () => {
		const issue: ValidationIssue = {
			severity: "warning",
			category: "undefined_value",
			message: "Test",
		};

		await reportIssue(ctx, issue);

		const call = mockEmit.mock.calls[0][0];
		expect(call.timestamp).toBeDefined();
		expect(typeof call.timestamp).toBe("string");
	});

	it("handles issue without location", async () => {
		const issue: ValidationIssue = {
			severity: "info",
			category: "dashboard_render",
			message: "Rendering component",
		};

		await reportIssue(ctx, issue);

		expect(mockEmit).toHaveBeenCalledWith(
			expect.objectContaining({
				type: "validation_issue",
				severity: "info",
				category: "dashboard_render",
				message: "Rendering component",
			}),
		);
	});
});
