/**
 * Integration test for thread event emissions
 */
import { expect, test } from "bun:test";
import { createInMemorySwarmMailLibSQL } from "../libsql.convenience";
import { readEvents } from "./store";
import {
	emitThreadActivity,
	initSwarmAgent,
	sendSwarmMessage,
} from "./swarm-mail";

test("thread events: message_sent enrichment + thread_created + thread_activity", async () => {
	const swarmMail = await createInMemorySwarmMailLibSQL("test-threads");
	const db = await swarmMail.getDatabase();
	const projectPath = "/test/project";

	// Initialize agents
	await initSwarmAgent({
		projectPath,
		agentName: "Alice",
		dbOverride: db,
	});

	await initSwarmAgent({
		projectPath,
		agentName: "Bob",
		dbOverride: db,
	});

	// Send first message in thread (should create thread_created event)
	await sendSwarmMessage({
		projectPath,
		fromAgent: "Alice",
		toAgents: ["Bob"],
		subject: "Progress: feature X",
		body: "Implemented the auth layer. ETA 10min for tests.",
		threadId: "epic-123",
		importance: "normal",
		dbOverride: db,
	});

	// Read events to verify
	const events = await readEvents({ projectKey: projectPath }, projectPath, db);

	// Should have: agent_registered x2, message_sent, thread_created
	expect(events.length).toBeGreaterThanOrEqual(4);

	const messageSent = events.find((e) => e.type === "message_sent");
	expect(messageSent).toBeDefined();
	expect(messageSent?.epic_id).toBe("epic-123");
	expect(messageSent?.message_type).toBe("progress");
	expect(messageSent?.body_length).toBe(48);
	expect(messageSent?.recipient_count).toBe(1);
	expect(messageSent?.is_broadcast).toBe(false);

	const threadCreated = events.find((e) => e.type === "thread_created");
	expect(threadCreated).toBeDefined();
	expect(threadCreated?.thread_id).toBe("epic-123");
	expect(threadCreated?.creator_agent).toBe("Alice");
	expect(threadCreated?.initial_subject).toBe("Progress: feature X");

	// Send second message (should NOT create thread_created)
	await sendSwarmMessage({
		projectPath,
		fromAgent: "Bob",
		toAgents: ["Alice"],
		subject: "Re: Progress: feature X",
		body: "Great! I'll start the API integration.",
		threadId: "epic-123",
		dbOverride: db,
	});

	const events2 = await readEvents(
		{ projectKey: projectPath },
		projectPath,
		db,
	);

	const threadCreatedEvents = events2.filter(
		(e) => e.type === "thread_created",
	);
	expect(threadCreatedEvents.length).toBe(1); // Still only 1

	// Emit thread activity
	await emitThreadActivity(projectPath, "epic-123", db);

	const events3 = await readEvents(
		{ projectKey: projectPath },
		projectPath,
		db,
	);

	const threadActivity = events3.find((e) => e.type === "thread_activity");
	expect(threadActivity).toBeDefined();
	expect(threadActivity?.thread_id).toBe("epic-123");
	expect(threadActivity?.message_count).toBe(2);
	expect(threadActivity?.participant_count).toBe(2);
	expect(threadActivity?.last_message_agent).toBe("Bob");

	await swarmMail.close();
});

test("message_type classification from subject", async () => {
	const swarmMail = await createInMemorySwarmMailLibSQL("test-message-types");
	const db = await swarmMail.getDatabase();
	const projectPath = "/test/project2";

	await initSwarmAgent({
		projectPath,
		agentName: "Worker",
		dbOverride: db,
	});

	// Test different message types
	const testCases = [
		{ subject: "Progress: 50% done", expected: "progress" },
		{ subject: "BLOCKED: waiting for DB schema", expected: "blocked" },
		{ subject: "Can you review this?", expected: "question" },
		{ subject: "Status update", expected: "status" },
		{ subject: "Found a bug", expected: "general" },
	];

	for (const tc of testCases) {
		await sendSwarmMessage({
			projectPath,
			fromAgent: "Worker",
			toAgents: ["Coordinator"],
			subject: tc.subject,
			body: "Test body",
			threadId: `thread-${tc.expected}`,
			dbOverride: db,
		});
	}

	const events = await readEvents(
		{ projectKey: projectPath, types: ["message_sent"] },
		projectPath,
		db,
	);

	const progressMsg = events.find((e) => e.subject?.includes("Progress"));
	expect(progressMsg?.message_type).toBe("progress");

	const blockedMsg = events.find((e) => e.subject?.includes("BLOCKED"));
	expect(blockedMsg?.message_type).toBe("blocked");

	const questionMsg = events.find((e) => e.subject?.includes("?"));
	expect(questionMsg?.message_type).toBe("question");

	const statusMsg = events.find((e) => e.subject?.includes("Status"));
	expect(statusMsg?.message_type).toBe("status");

	const generalMsg = events.find((e) => e.subject?.includes("bug"));
	expect(generalMsg?.message_type).toBe("general");

	await swarmMail.close();
});

test("is_broadcast flag based on recipient count", async () => {
	const swarmMail = await createInMemorySwarmMailLibSQL("test-broadcast");
	const db = await swarmMail.getDatabase();
	const projectPath = "/test/project3";

	await initSwarmAgent({
		projectPath,
		agentName: "Sender",
		dbOverride: db,
	});

	// Direct message (1 recipient)
	await sendSwarmMessage({
		projectPath,
		fromAgent: "Sender",
		toAgents: ["Alice"],
		subject: "Direct message",
		body: "Hi",
		threadId: "thread-1",
		dbOverride: db,
	});

	// Small group (2 recipients)
	await sendSwarmMessage({
		projectPath,
		fromAgent: "Sender",
		toAgents: ["Alice", "Bob"],
		subject: "Small group",
		body: "Hi both",
		threadId: "thread-2",
		dbOverride: db,
	});

	// Broadcast (3+ recipients)
	await sendSwarmMessage({
		projectPath,
		fromAgent: "Sender",
		toAgents: ["Alice", "Bob", "Charlie"],
		subject: "Broadcast",
		body: "Hi everyone",
		threadId: "thread-3",
		dbOverride: db,
	});

	const events = await readEvents(
		{ projectKey: projectPath, types: ["message_sent"] },
		projectPath,
		db,
	);

	const directMsg = events.find((e) => e.subject === "Direct message");
	expect(directMsg?.is_broadcast).toBe(false);
	expect(directMsg?.recipient_count).toBe(1);

	const groupMsg = events.find((e) => e.subject === "Small group");
	expect(groupMsg?.is_broadcast).toBe(false);
	expect(groupMsg?.recipient_count).toBe(2);

	const broadcastMsg = events.find((e) => e.subject === "Broadcast");
	expect(broadcastMsg?.is_broadcast).toBe(true);
	expect(broadcastMsg?.recipient_count).toBe(3);

	await swarmMail.close();
});
