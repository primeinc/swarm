#!/usr/bin/env bun
/**
 * swarm-db CLI - Human-facing analytics and SQL queries
 *
 * Commands:
 *   query <sql>             Execute raw SQL (read-only, max 1000 rows)
 *   analytics <command>     Run pre-built analytics query
 *   list                    List available analytics commands
 *
 * Flags:
 *   --format <fmt>          Output format: table (default), json, csv, jsonl
 *   --db <path>             Database path (default: ~/.config/swarm-tools/swarm.db)
 *   --since <range>         Time range filter (e.g., 7d, 24h, 30m)
 *   --until <range>         End time filter (e.g., 1d, 12h)
 *   --project <key>         Filter by project key
 *   --epic <id>             Filter by epic ID
 *   --help, -h              Show help
 *
 * Examples:
 *   swarm-db query "SELECT type, COUNT(*) FROM events GROUP BY type"
 *   swarm-db analytics failed-decompositions --format json
 *   swarm-db analytics agent-activity --since 7d --format table
 *   swarm-db list
 */

import { homedir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import type { OutputFormat } from "../src/analytics/types.js";
import {
	executeAnalyticsCommand,
	executeQueryCommand,
	listAnalyticsCommands,
} from "../src/cli/db.js";

const DEFAULT_DB = join(homedir(), ".config/swarm-tools/swarm.db");

function showHelp() {
	console.log(`
swarm-db - Analytics and SQL queries for swarm coordination database

USAGE
  swarm-db <command> [options]

COMMANDS
  query <sql>             Execute raw SQL query (read-only, max 1000 rows)
  analytics <command>     Run pre-built analytics query
  list                    List all available analytics commands

ANALYTICS COMMANDS
  Run 'swarm-db list' to see all available analytics commands with descriptions.

FLAGS
  --format <fmt>          Output format: table (default), json, csv, jsonl
  --db <path>             Database path (default: ~/.config/swarm-tools/swarm.db)
  --since <range>         Time range filter (e.g., 7d, 24h, 30m)
  --until <range>         End time filter (e.g., 1d, 12h)
  --project <key>         Filter by project key
  --epic <id>             Filter by epic ID
  -h, --help              Show this help message

EXAMPLES
  # Raw SQL query
  swarm-db query "SELECT type, COUNT(*) FROM events GROUP BY type"

  # Analytics with default table format
  swarm-db analytics failed-decompositions

  # Analytics with time filter and JSON output
  swarm-db analytics agent-activity --since 7d --format json

  # Analytics filtered by project
  swarm-db analytics lock-contention --project /path/to/project --format csv

  # List all available analytics commands
  swarm-db list

NOTES
  - SQL queries are read-only for safety (SELECT only)
  - Maximum 1000 rows returned for raw queries
  - Analytics queries have built-in limits
  - Time ranges: d=days, h=hours, m=minutes (e.g., 7d, 24h, 30m)
`);
}

async function main() {
	const { values, positionals } = parseArgs({
		args: process.argv.slice(2),
		options: {
			format: { type: "string", default: "table" },
			db: { type: "string", default: DEFAULT_DB },
			since: { type: "string" },
			until: { type: "string" },
			project: { type: "string" },
			epic: { type: "string" },
			help: { type: "boolean", short: "h", default: false },
		},
		allowPositionals: true,
	});

	if (values.help || positionals.length === 0) {
		showHelp();
		process.exit(0);
	}

	const command = positionals[0];
	const format = values.format as OutputFormat;

	try {
		if (command === "list") {
			// List analytics commands
			const commands = listAnalyticsCommands();
			console.log("\nAvailable Analytics Commands:\n");
			for (const cmd of commands) {
				console.log(`  ${cmd.name.padEnd(25)} ${cmd.description}`);
			}
			console.log(
				`\nRun 'swarm-db analytics <command>' to execute a command.\n`,
			);
		} else if (command === "query") {
			// Execute raw SQL
			const sql = positionals[1];
			if (!sql) {
				console.error("Error: SQL query required");
				console.error("Usage: swarm-db query <sql>");
				process.exit(1);
			}

			const output = await executeQueryCommand({
				sql,
				db: values.db,
				format,
			});

			console.log(output);
		} else if (command === "analytics") {
			// Execute analytics command
			const analyticsCmd = positionals[1];
			if (!analyticsCmd) {
				console.error("Error: Analytics command required");
				console.error("Usage: swarm-db analytics <command>");
				console.error("Run 'swarm-db list' to see available commands");
				process.exit(1);
			}

			const output = await executeAnalyticsCommand({
				command: analyticsCmd,
				db: values.db,
				format,
				since: values.since,
				until: values.until,
				project: values.project,
				epic: values.epic,
			});

			console.log(output);
		} else {
			console.error(`Unknown command: ${command}`);
			console.error("Run 'swarm-db --help' for usage information");
			process.exit(1);
		}
	} catch (error) {
		console.error(
			`Error: ${error instanceof Error ? error.message : String(error)}`,
		);
		process.exit(1);
	}
}

main();
