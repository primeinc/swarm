/**
 * Session Command - Hive session management (Chainlink-inspired)
 *
 * Commands:
 *   swarm session start [--cell <id>] [--json]
 *   swarm session end [--notes "..."] [--json]
 *   swarm session status [--json]
 *   swarm session history [--limit <n>] [--json]
 *
 * Inspired by: https://github.com/dollspace-gay/chainlink
 * Credit: @dollspace-gay for the session handoff pattern
 */

import * as p from "@clack/prompts";
import { createHiveAdapter, getSwarmMailLibSQL } from "swarm-mail";

// Color utilities (inline, same as swarm.ts)
const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;

/**
 * Main Hive session command handler
 */
export async function session() {
	const args = process.argv.slice(3);
	const subcommand = args[0];

	if (!subcommand || subcommand === "help" || subcommand === "--help") {
		showHelp();
		return;
	}

	switch (subcommand) {
		case "start":
			await startSession(args.slice(1));
			break;
		case "end":
			await endSession(args.slice(1));
			break;
		case "status":
			await sessionStatus(args.slice(1));
			break;
		case "history":
			await sessionHistory(args.slice(1));
			break;
		default:
			p.log.error(`Unknown session subcommand: ${subcommand}`);
			showHelp();
			process.exit(1);
	}
}

/**
 * Start a new session
 */
async function startSession(args: string[]) {
	// Parse arguments
	let cellId: string | null = null;
	let jsonOutput = false;

	for (let i = 0; i < args.length; i++) {
		const arg = args[i];

		if (arg === "--cell" && i + 1 < args.length) {
			cellId = args[++i];
		} else if (arg === "--json") {
			jsonOutput = true;
		}
	}

	const projectPath = process.cwd();

	try {
		const swarmMail = await getSwarmMailLibSQL(projectPath);
		const db = await swarmMail.getDatabase();
		const adapter = createHiveAdapter(db, projectPath);

		// Run migrations to ensure schema exists
		await adapter.runMigrations();

		// Start session
		const session = await adapter.startSession(projectPath, {
			active_cell_id: cellId || undefined,
		});

		if (jsonOutput) {
			console.log(JSON.stringify(session, null, 2));
			return;
		}

		// Pretty output
		p.log.success(green(`Session started: ${session.id}`));

		if (session.active_cell_id) {
			p.log.message(dim(`  Active cell: ${session.active_cell_id}`));
		}

		if (session.previous_handoff_notes) {
			p.log.message(
				`\n${yellow("Previous session notes:")}
${dim(session.previous_handoff_notes)}`,
			);
		} else {
			p.log.message(dim("\n  (No previous session notes)"));
		}
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		p.log.error(`Failed to start session: ${message}`);
		process.exit(1);
	}
}

/**
 * End the current session
 */
async function endSession(args: string[]) {
	// Parse arguments
	let notes: string | null = null;
	let jsonOutput = false;

	for (let i = 0; i < args.length; i++) {
		const arg = args[i];

		if (arg === "--notes" && i + 1 < args.length) {
			notes = args[++i];
		} else if (arg === "--json") {
			jsonOutput = true;
		}
	}

	const projectPath = process.cwd();

	try {
		const swarmMail = await getSwarmMailLibSQL(projectPath);
		const db = await swarmMail.getDatabase();
		const adapter = createHiveAdapter(db, projectPath);

		// Run migrations
		await adapter.runMigrations();

		// Get current session
		const currentSession = await adapter.getCurrentSession(projectPath);

		if (!currentSession) {
			p.log.error("No active session to end");
			process.exit(1);
		}

		// End session
		const endedSession = await adapter.endSession(
			projectPath,
			currentSession.id,
			{
				handoff_notes: notes || undefined,
			},
		);

		if (jsonOutput) {
			console.log(JSON.stringify(endedSession, null, 2));
			return;
		}

		// Pretty output
		p.log.success(green(`Session ended: ${endedSession.id}`));

		if (endedSession.handoff_notes) {
			p.log.message(
				dim(`  Handoff notes saved for next session:
${endedSession.handoff_notes}`),
			);
		}

		const duration = endedSession.ended_at! - endedSession.started_at;
		const durationStr = formatDuration(duration);
		p.log.message(dim(`  Duration: ${durationStr}`));
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		p.log.error(`Failed to end session: ${message}`);
		process.exit(1);
	}
}

/**
 * Show current session status
 */
async function sessionStatus(args: string[]) {
	const jsonOutput = args.includes("--json");
	const projectPath = process.cwd();

	try {
		const swarmMail = await getSwarmMailLibSQL(projectPath);
		const db = await swarmMail.getDatabase();
		const adapter = createHiveAdapter(db, projectPath);

		// Run migrations
		await adapter.runMigrations();

		// Get current session
		const currentSession = await adapter.getCurrentSession(projectPath);

		if (!currentSession) {
			if (jsonOutput) {
				console.log(JSON.stringify({ active: false }, null, 2));
			} else {
				p.log.message("No active session");
			}
			return;
		}

		if (jsonOutput) {
			console.log(
				JSON.stringify({ active: true, session: currentSession }, null, 2),
			);
			return;
		}

		// Pretty output
		p.log.message(green("Active session:"));
		p.log.message(dim(`  ID: ${currentSession.id}`));
		p.log.message(
			dim(`  Started: ${new Date(currentSession.started_at).toLocaleString()}`),
		);

		if (currentSession.active_cell_id) {
			p.log.message(dim(`  Active cell: ${currentSession.active_cell_id}`));
		}

		const elapsed = Date.now() - currentSession.started_at;
		p.log.message(dim(`  Elapsed: ${formatDuration(elapsed)}`));
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		p.log.error(`Failed to get session status: ${message}`);
		process.exit(1);
	}
}

/**
 * Show session history
 */
async function sessionHistory(args: string[]) {
	// Parse arguments
	let limit = 10;
	let jsonOutput = false;

	for (let i = 0; i < args.length; i++) {
		const arg = args[i];

		if (arg === "--limit" && i + 1 < args.length) {
			limit = parseInt(args[++i], 10);
			if (isNaN(limit) || limit <= 0) {
				p.log.error(`Invalid limit: ${args[i]}`);
				process.exit(1);
			}
		} else if (arg === "--json") {
			jsonOutput = true;
		}
	}

	const projectPath = process.cwd();

	try {
		const swarmMail = await getSwarmMailLibSQL(projectPath);
		const db = await swarmMail.getDatabase();
		const adapter = createHiveAdapter(db, projectPath);

		// Run migrations
		await adapter.runMigrations();

		// Get history
		const sessions = await adapter.getSessionHistory(projectPath, { limit });

		if (jsonOutput) {
			console.log(JSON.stringify(sessions, null, 2));
			return;
		}

		// Pretty output
		if (sessions.length === 0) {
			p.log.message("No session history");
			return;
		}

		p.log.message(cyan(`Recent sessions (${sessions.length}):\n`));

		for (const session of sessions) {
			const startedAt = new Date(session.started_at).toLocaleString();
			const status = session.ended_at ? "ended" : green("active");

			p.log.message(`  ${dim(`#${session.id}`)} - ${status}`);
			p.log.message(dim(`    Started: ${startedAt}`));

			if (session.ended_at) {
				const duration = session.ended_at - session.started_at;
				p.log.message(dim(`    Duration: ${formatDuration(duration)}`));
			}

			if (session.active_cell_id) {
				p.log.message(dim(`    Cell: ${session.active_cell_id}`));
			}

			if (session.handoff_notes) {
				p.log.message(
					dim(`    Notes: ${session.handoff_notes.slice(0, 60)}...`),
				);
			}

			p.log.message(""); // Blank line
		}
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		p.log.error(`Failed to get session history: ${message}`);
		process.exit(1);
	}
}

/**
 * Format duration in human-readable format
 */
function formatDuration(ms: number): string {
	const seconds = Math.floor(ms / 1000);
	const minutes = Math.floor(seconds / 60);
	const hours = Math.floor(minutes / 60);
	const days = Math.floor(hours / 24);

	if (days > 0) {
		return `${days}d ${hours % 24}h`;
	}
	if (hours > 0) {
		return `${hours}h ${minutes % 60}m`;
	}
	if (minutes > 0) {
		return `${minutes}m ${seconds % 60}s`;
	}
	return `${seconds}s`;
}

/**
 * Show help
 */
function showHelp() {
	console.log(`
${cyan("swarm session")} - Manage Hive work sessions with handoff notes

${cyan("Commands:")}
  swarm session start [--cell <id>]  Start a new Hive session
  swarm session end [--notes "..."]  End current Hive session with optional handoff notes
  swarm session status               Show current Hive session info
  swarm session history [--limit n]  Show Hive session history (default: 10)

${cyan("Options:")}
  --json                             Output as JSON
  --cell <id>                        Set active cell when starting session
  --notes "..."                      Save handoff notes for next session
  --limit <n>                        Limit history results

${cyan("Examples:")}
  ${dim("# Start session")}
  swarm session start

  ${dim("# Start session with active cell")}
  swarm session start --cell opencode-swarm-monorepo-lf2p4u-mk2uv4j7u3o

  ${dim("# End session with handoff notes")}
  swarm session end --notes "Completed auth flow. Next: add error handling"

  ${dim("# Check current session")}
  swarm session status

  ${dim("# View recent sessions")}
  swarm session history --limit 5

${dim("Inspired by Chainlink: https://github.com/dollspace-gay/chainlink")}
`);
}
