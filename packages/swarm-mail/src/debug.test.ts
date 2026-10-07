import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import debug from "debug";

describe("debug logging", () => {
	let originalDebug: string | undefined;
	let logs: string[] = [];
	let originalStderr: typeof process.stderr.write;

	beforeEach(() => {
		// Save original DEBUG env var
		originalDebug = process.env.DEBUG;

		// Capture stderr output
		logs = [];
		originalStderr = process.stderr.write;
		process.stderr.write = ((chunk: Buffer | string) => {
			logs.push(chunk.toString());
			return true;
		}) as typeof process.stderr.write;
	});

	afterEach(() => {
		// Restore original DEBUG env var
		if (originalDebug !== undefined) {
			process.env.DEBUG = originalDebug;
		} else {
			delete process.env.DEBUG;
		}

		// Restore stderr
		process.stderr.write = originalStderr;

		// Clear debug state
		debug.disable();
	});

	test("DEBUG=swarm:* enables all subsystems", async () => {
		// Arrange
		debug.enable("swarm:*");

		// Act - dynamically import to pick up debug state
		const { log } = await import("./debug.ts");
		log.events("test event");
		log.reservations("test reservation");
		log.messages("test message");
		log.checkpoints("test checkpoint");

		// Assert
		const output = logs.join("");
		expect(output).toContain("test event");
		expect(output).toContain("test reservation");
		expect(output).toContain("test message");
		expect(output).toContain("test checkpoint");
	});

	test("DEBUG=swarm:events enables only events subsystem", async () => {
		// Arrange
		debug.enable("swarm:events");

		// Act
		const { log } = await import("./debug.ts");
		log.events("event message");
		log.reservations("reservation message");
		log.messages("mail message");
		log.checkpoints("checkpoint message");

		// Assert
		const output = logs.join("");
		expect(output).toContain("event message");
		expect(output).not.toContain("reservation message");
		expect(output).not.toContain("mail message");
		expect(output).not.toContain("checkpoint message");
	});

	test("no DEBUG env var produces no output", async () => {
		// Arrange
		debug.disable();

		// Act
		const { log } = await import("./debug.ts");
		log.events("should not appear");
		log.reservations("should not appear");
		log.messages("should not appear");
		log.checkpoints("should not appear");

		// Assert
		const output = logs.join("");
		expect(output).toBe("");
	});

	test("multiple subsystems can be enabled with comma-separated list", async () => {
		// Arrange
		debug.enable("swarm:events,swarm:messages");

		// Act
		const { log } = await import("./debug.ts");
		log.events("event here");
		log.reservations("no reservation");
		log.messages("message here");
		log.checkpoints("no checkpoint");

		// Assert
		const output = logs.join("");
		expect(output).toContain("event here");
		expect(output).toContain("message here");
		expect(output).not.toContain("no reservation");
		expect(output).not.toContain("no checkpoint");
	});

	test("log output includes subsystem prefix", async () => {
		// Arrange
		debug.enable("swarm:events");

		// Act
		const { log } = await import("./debug.ts");
		log.events("test");

		// Assert
		const output = logs.join("");
		expect(output).toContain("swarm:events");
		expect(output).toContain("test");
	});
});
