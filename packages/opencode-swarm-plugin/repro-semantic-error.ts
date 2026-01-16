import type { FeedbackEvent } from "./src/learning";
import { SemanticMemoryStorage } from "./src/storage";

const mockEvent: FeedbackEvent = {
	id: "test-id",
	criterion: "type_safe",
	type: "helpful",
	timestamp: new Date().toISOString(),
	raw_value: 1,
	bead_id: "test-bead",
};

async function run() {
	console.log("Starting reproduction script...");

	// Force semantic-memory backend
	const storage = new SemanticMemoryStorage({
		backend: "semantic-memory",
		collections: {
			feedback: "repro-feedback",
			patterns: "repro-patterns",
			maturity: "repro-maturity",
		},
	});

	try {
		console.log("Attempting to store feedback...");
		await storage.storeFeedback(mockEvent);
		console.log("Success!");
	} catch (error) {
		console.error("Failed:", error);
	}
}

run();
