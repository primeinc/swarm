import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Database Path Resolver
 *
 * Single source of truth for all database file locations.
 * Enforces the global singleton architecture (~/.config/swarm-tools/swarm.db).
 */
export class DbPathResolver {
	/**
	 * Get the path to the global swarm database
	 *
	 * @returns Absolute path to the global .db file
	 */
	static getGlobalPath(): string {
		const configDir = join(homedir(), ".config", "swarm-tools");
		if (!existsSync(configDir)) {
			mkdirSync(configDir, { recursive: true });
		}
		return join(configDir, "swarm.db");
	}

	/**
	 * Get the path to a session-specific database
	 *
	 * @param sessionId - Unique session ID
	 * @returns Absolute path to the session .db file
	 */
	static getSessionPath(sessionId: string): string {
		const sessionDir = join(homedir(), ".config", "swarm-tools", "sessions");
		if (!existsSync(sessionDir)) {
			mkdirSync(sessionDir, { recursive: true });
		}
		return join(sessionDir, `${sessionId}.db`);
	}
}
