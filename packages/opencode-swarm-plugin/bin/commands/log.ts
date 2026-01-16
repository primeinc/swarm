/**
 * Log Command - View and tail Hive swarm logs
 *
 * Commands:
 *   swarm log [type]                    - Show recent logs (all types or specific: tools, swarmmail, errors, compaction)
 *   swarm log --since <time>            - Show logs since time (e.g., 30s, 5m, 2h, 24h)
 *   swarm log --watch                   - Watch mode (live tail)
 *   swarm log --level <level>           - Filter by level (info, debug, warn, error)
 *   swarm log --limit <n>               - Limit output lines (default: 50)
 *   swarm log --json                    - JSON output
 *
 * Log files:
 *   ~/.config/swarm-tools/logs/tools-YYYY-MM-DD.log
 *   ~/.config/swarm-tools/logs/swarmmail-YYYY-MM-DD.log
 *   ~/.config/swarm-tools/logs/errors-YYYY-MM-DD.log
 *   ~/.config/swarm-tools/logs/compaction.log (Hive context management)
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import * as p from "@clack/prompts";

// Color utilities (inline)
const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const gray = (s: string) => `\x1b[90m${s}\x1b[0m`;

const LOG_DIR = join(homedir(), ".config", "swarm-tools", "logs");

interface LogEntry {
	time: string;
	level: string;
	msg: string;
	[key: string]: any;
}

interface LogOptions {
	type?: string; // tools, swarmmail, errors, compaction
	since?: number; // milliseconds
	watch?: boolean;
	level?: string; // info, debug, warn, error
	limit?: number;
	json?: boolean;
}

/**
 * Main log command handler
 */
export async function log() {
	const args = process.argv.slice(3);

	if (args.includes("--help") || args.includes("help")) {
		showHelp();
		return;
	}

	const options = parseOptions(args);

	if (options.watch) {
		await watchLogs(options);
	} else {
		await showLogs(options);
	}
}

/**
 * Parse command-line arguments
 */
function parseOptions(args: string[]): LogOptions {
	const options: LogOptions = {
		limit: 50,
	};

	for (let i = 0; i < args.length; i++) {
		const arg = args[i];

		if (arg === "--since" && i + 1 < args.length) {
			options.since = parseSince(args[++i]);
		} else if (arg === "--watch" || arg === "-w") {
			options.watch = true;
		} else if (arg === "--level" && i + 1 < args.length) {
			options.level = args[++i];
		} else if (arg === "--limit" && i + 1 < args.length) {
			options.limit = parseInt(args[++i], 10);
		} else if (arg === "--json") {
			options.json = true;
		} else if (!arg.startsWith("--")) {
			// Positional argument - log type
			options.type = arg;
		}
	}

	return options;
}

/**
 * Parse --since time string (e.g., "30s", "5m", "2h", "24h")
 */
function parseSince(since: string): number {
	const match = since.match(/^(\d+)([smhd])$/);
	if (!match) {
		p.log.error(`Invalid --since format: ${since}. Use: 30s, 5m, 2h, 24h`);
		process.exit(1);
	}

	const [, value, unit] = match;
	const num = parseInt(value, 10);

	const units: Record<string, number> = {
		s: 1000,
		m: 60 * 1000,
		h: 60 * 60 * 1000,
		d: 24 * 60 * 60 * 1000,
	};

	return num * units[unit];
}

/**
 * Get log files for a specific type
 */
function getLogFiles(type?: string): string[] {
	if (!existsSync(LOG_DIR)) {
		return [];
	}

	const files = readdirSync(LOG_DIR);
	const today = new Date().toISOString().split("T")[0];

	if (type === "compaction") {
		// Legacy single file
		return files
			.filter((f) => f === "compaction.log")
			.map((f) => join(LOG_DIR, f));
	}

	// Date-stamped log files
	const pattern = type
		? new RegExp(`^${type}-\\d{4}-\\d{2}-\\d{2}\\.log$`)
		: /^(tools|swarmmail|errors)-\d{4}-\d{2}-\d{2}\.log$/;

	return files
		.filter((f) => pattern.test(f))
		.map((f) => join(LOG_DIR, f))
		.sort((a, b) => {
			// Sort by modification time (newest first)
			const statA = statSync(a);
			const statB = statSync(b);
			return statB.mtimeMs - statA.mtimeMs;
		});
}

/**
 * Read and parse log entries from a file
 */
function readLogEntries(filePath: string): LogEntry[] {
	if (!existsSync(filePath)) {
		return [];
	}

	const content = readFileSync(filePath, "utf-8");
	const lines = content.split("\n").filter((line) => line.trim());

	return lines
		.map((line) => {
			try {
				return JSON.parse(line) as LogEntry;
			} catch {
				return null;
			}
		})
		.filter((entry): entry is LogEntry => entry !== null);
}

/**
 * Filter log entries by options
 */
function filterEntries(entries: LogEntry[], options: LogOptions): LogEntry[] {
	let filtered = entries;

	// Filter by time
	if (options.since) {
		const cutoff = Date.now() - options.since;
		filtered = filtered.filter((e) => new Date(e.time).getTime() >= cutoff);
	}

	// Filter by level
	if (options.level) {
		filtered = filtered.filter((e) => e.level === options.level);
	}

	return filtered;
}

/**
 * Format log entry for display
 */
function formatEntry(entry: LogEntry): string {
	const time = new Date(entry.time).toLocaleTimeString();
	const level = formatLevel(entry.level);
	const msg = entry.msg;

	// Extract additional fields (excluding time, level, msg)
	const { time: _, level: __, msg: ___, ...rest } = entry;
	const extra = Object.keys(rest).length > 0 ? dim(JSON.stringify(rest)) : "";

	return `${gray(time)} ${level} ${msg} ${extra}`;
}

/**
 * Format log level with color
 */
function formatLevel(level: string): string {
	switch (level) {
		case "error":
			return red("[ERROR]");
		case "warn":
			return yellow("[WARN] ");
		case "info":
			return green("[INFO] ");
		case "debug":
			return cyan("[DEBUG]");
		default:
			return `[${level}]`;
	}
}

/**
 * Show logs (non-watch mode)
 */
async function showLogs(options: LogOptions) {
	const files = getLogFiles(options.type);

	if (files.length === 0) {
		if (options.type) {
			p.log.warn(`No logs found for type: ${options.type}`);
		} else {
			p.log.warn("No logs found. Run a swarm command to generate logs.");
		}
		return;
	}

	// Read all entries from all files
	const allEntries = files.flatMap((f) => readLogEntries(f));

	// Filter
	const filtered = filterEntries(allEntries, options);

	// Sort by time (newest last for tail-like output)
	const sorted = filtered.sort(
		(a, b) => new Date(a.time).getTime() - new Date(b.time).getTime(),
	);

	// Limit
	const limited =
		options.limit && options.limit > 0 ? sorted.slice(-options.limit) : sorted;

	if (options.json) {
		console.log(JSON.stringify(limited, null, 2));
		return;
	}

	// Pretty output
	if (limited.length === 0) {
		p.log.warn("No matching log entries");
		return;
	}

	p.log.message(dim(`Showing ${limited.length} log entries`));
	console.log("");

	for (const entry of limited) {
		console.log(formatEntry(entry));
	}
}

/**
 * Watch logs (live tail)
 */
async function watchLogs(options: LogOptions) {
	p.log.info("Watching logs (Ctrl+C to stop)...");
	console.log("");

	// Track last read position for each file
	const filePositions = new Map<string, number>();

	// eslint-disable-next-line no-constant-condition
	while (true) {
		const files = getLogFiles(options.type);

		for (const file of files) {
			const lastPos = filePositions.get(file) ?? 0;
			const content = readFileSync(file, "utf-8");

			if (content.length > lastPos) {
				const newContent = content.slice(lastPos);
				const newLines = newContent.split("\n").filter((line) => line.trim());

				for (const line of newLines) {
					try {
						const entry = JSON.parse(line) as LogEntry;
						const filtered = filterEntries([entry], options);

						if (filtered.length > 0) {
							if (options.json) {
								console.log(JSON.stringify(entry));
							} else {
								console.log(formatEntry(entry));
							}
						}
					} catch {
						// Skip invalid lines
					}
				}

				filePositions.set(file, content.length);
			}
		}

		// Poll interval (500ms)
		await new Promise((resolve) => setTimeout(resolve, 500));
	}
}

/**
 * Show help
 */
function showHelp() {
	console.log(`
${cyan("swarm log")} - View and tail Hive swarm logs

${yellow("USAGE:")}
  swarm log [type] [options]

${yellow("TYPES:")}
  tools       Hive and swarm tool invocations (hive_*, swarm_*, etc.)
  swarmmail   Inter-agent messages (Swarm Mail)
  errors      Error logs
  compaction  Context compaction events (Hive context management)

${yellow("OPTIONS:")}
  --since <time>   Show logs since time (e.g., 30s, 5m, 2h, 24h)
  --watch, -w      Watch mode (live tail)
  --level <level>  Filter by level (info, debug, warn, error)
  --limit <n>      Limit output lines (default: 50)
  --json           JSON output

${yellow("EXAMPLES:")}
  swarm log                           # Show recent logs (all types)
  swarm log tools                     # Show tool invocations
  swarm log --since 5m                # Show logs from last 5 minutes
  swarm log errors --watch            # Live tail error logs
  swarm log --level error --limit 20  # Show last 20 error-level logs
  swarm log compaction --json         # Show compaction logs as JSON
`);
}
