import { spawn } from "bun";

async function run() {
	console.log("Starting direct spawn test...");

	const metadata = {
		criterion: "type_safe",
		type: "helpful",
		bead_id: "test-bead",
		timestamp: new Date().toISOString(),
	};

	const jsonMetadata = JSON.stringify(metadata).replace(/"/g, '\\"');
	console.log("Metadata JSON (escaped):", jsonMetadata);

	const args = [
		"bunx",
		"semantic-memory",
		"store",
		"test content",
		"--collection",
		"repro-direct",
		"--metadata",
		jsonMetadata,
	];
	console.log("Command:", args.join(" "));

	const proc = spawn(args, {
		stdout: "inherit",
		stderr: "inherit",
	});

	const exitCode = await proc.exited;
	console.log("Exit code:", exitCode);
}

run();
