import { describe, expect, test } from "bun:test";
import {
	BaseSwarmError,
	CheckpointError,
	DecompositionError,
	ReservationError,
	ValidationError,
} from "./index";

describe("BaseSwarmError", () => {
	test("constructs with minimal context", () => {
		const error = new BaseSwarmError("Something failed");

		expect(error.message).toBe("Something failed");
		expect(error.name).toBe("BaseSwarmError");
		expect(error.context.timestamp).toBeNumber();
		expect(error.context.suggestions).toBeArray();
		expect(error.context.suggestions).toHaveLength(0);
		expect(error.context.recent_events).toBeArray();
		expect(error.context.recent_events).toHaveLength(0);
	});

	test("constructs with full context", () => {
		const now = Date.now();
		const recentEvents = [
			{ type: "AGENT_REGISTERED", timestamp: now - 1000, data: {} },
			{ type: "MESSAGE_SENT", timestamp: now - 500, data: {} },
		];

		const error = new BaseSwarmError("Failed", {
			agent: "WiseStone",
			cell_id: "cell-123",
			epic_id: "cell-100",
			timestamp: now,
			sequence: 42,
			reason: "Test failure",
			recent_events: recentEvents,
			suggestions: ["Try this", "Or that"],
		});

		expect(error.context.agent).toBe("WiseStone");
		expect(error.context.cell_id).toBe("cell-123");
		expect(error.context.epic_id).toBe("cell-100");
		expect(error.context.timestamp).toBe(now);
		expect(error.context.sequence).toBe(42);
		expect(error.context.reason).toBe("Test failure");
		expect(error.context.recent_events).toEqual(recentEvents);
		expect(error.context.suggestions).toEqual(["Try this", "Or that"]);
	});

	test("toJSON produces valid serializable object", () => {
		const error = new BaseSwarmError("Test", {
			agent: "WiseStone",
			cell_id: "cell-123",
			suggestions: ["Fix it"],
		});

		const json = error.toJSON();

		expect(json).toHaveProperty("name");
		expect(json).toHaveProperty("message");
		expect(json).toHaveProperty("context");
		expect(json.context.agent).toBe("WiseStone");
		expect(json.context.cell_id).toBe("cell-123");

		// Verify it round-trips through JSON
		const serialized = JSON.stringify(json);
		const parsed = JSON.parse(serialized);
		expect(parsed.message).toBe("Test");
	});

	test("includes stack trace", () => {
		const error = new BaseSwarmError("Test");
		expect(error.stack).toBeDefined();
		expect(error.stack).toContain("BaseSwarmError");
	});
});

describe("ReservationError", () => {
	test("constructs with reservation context", () => {
		const error = new ReservationError("Path reserved by other agent", {
			agent: "WiseStone",
			cell_id: "cell-123",
			current_holder: {
				agent: "OtherAgent",
				expires_at: Date.now() + 3600000,
				reason: "Working on cell-456",
			},
			suggestions: ["Wait for reservation to expire", "Request access"],
		});

		expect(error.name).toBe("ReservationError");
		expect(error.message).toBe("Path reserved by other agent");
		expect(error.context.current_holder).toBeDefined();
		expect(error.context.current_holder?.agent).toBe("OtherAgent");
		expect(error.context.suggestions).toHaveLength(2);
	});

	test("error message includes holder information", () => {
		const error = new ReservationError("Path reserved", {
			current_holder: {
				agent: "OtherAgent",
				expires_at: Date.now() + 3600,
				reason: "Working on task",
			},
		});

		expect(error.message).toContain("reserved");
	});
});

describe("CheckpointError", () => {
	test("constructs with checkpoint context", () => {
		const error = new CheckpointError("Failed to save checkpoint", {
			agent: "WiseStone",
			cell_id: "cell-123",
			sequence: 10,
			reason: "Disk full",
			suggestions: ["Clear disk space", "Retry checkpoint"],
		});

		expect(error.name).toBe("CheckpointError");
		expect(error.context.sequence).toBe(10);
		expect(error.context.reason).toBe("Disk full");
	});

	test("includes recent events if provided", () => {
		const events = [
			{ type: "CHECKPOINT_STARTED", timestamp: Date.now(), data: {} },
		];

		const error = new CheckpointError("Failed", {
			recent_events: events,
		});

		expect(error.context.recent_events).toEqual(events);
	});
});

describe("ValidationError", () => {
	test("constructs with validation context", () => {
		const error = new ValidationError("Invalid epic structure", {
			agent: "WiseStone",
			epic_id: "cell-100",
			reason: "Missing required fields",
			suggestions: ["Add epic title", "Add subtasks array"],
		});

		expect(error.name).toBe("ValidationError");
		expect(error.message).toBe("Invalid epic structure");
		expect(error.context.epic_id).toBe("cell-100");
		expect(error.context.suggestions).toHaveLength(2);
	});

	test("works without suggestions", () => {
		const error = new ValidationError("Bad input");

		expect(error.context.suggestions).toBeArray();
		expect(error.context.suggestions).toHaveLength(0);
	});
});

describe("DecompositionError", () => {
	test("constructs with decomposition context", () => {
		const error = new DecompositionError("File conflicts detected", {
			agent: "WiseStone",
			epic_id: "cell-100",
			reason: "Multiple subtasks editing same file",
			suggestions: ["Split subtasks by file", "Merge conflicting subtasks"],
		});

		expect(error.name).toBe("DecompositionError");
		expect(error.message).toBe("File conflicts detected");
		expect(error.context.suggestions).toHaveLength(2);
	});

	test("serializes with all decomposition context", () => {
		const error = new DecompositionError("Invalid strategy", {
			epic_id: "cell-100",
			recent_events: [
				{
					type: "DECOMPOSITION_STARTED",
					timestamp: Date.now(),
					data: { strategy: "file-based" },
				},
			],
		});

		const json = error.toJSON();
		expect(json.context.epic_id).toBe("cell-100");
		expect(json.context.recent_events).toHaveLength(1);
	});
});

describe("Error context enrichment", () => {
	test("suggestions array is always present", () => {
		const errors = [
			new BaseSwarmError("test"),
			new ReservationError("test"),
			new CheckpointError("test"),
			new ValidationError("test"),
			new DecompositionError("test"),
		];

		for (const error of errors) {
			expect(error.context.suggestions).toBeArray();
		}
	});

	test("recent_events defaults to empty array", () => {
		const error = new BaseSwarmError("test");
		expect(error.context.recent_events).toBeArray();
		expect(error.context.recent_events).toHaveLength(0);
	});

	test("timestamp is always populated", () => {
		const before = Date.now();
		const error = new BaseSwarmError("test");
		const after = Date.now();

		expect(error.context.timestamp).toBeGreaterThanOrEqual(before);
		expect(error.context.timestamp).toBeLessThanOrEqual(after);
	});

	test("can override default timestamp", () => {
		const customTime = 1234567890;
		const error = new BaseSwarmError("test", { timestamp: customTime });

		expect(error.context.timestamp).toBe(customTime);
	});
});
