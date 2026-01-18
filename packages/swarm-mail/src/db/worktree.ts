import { existsSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { normalize } from "swarm-path";

/**
 * Detects if a path is inside a git worktree.
 *
 * In a worktree, `.git` is a FILE (not a directory) containing:
 * `gitdir: /path/to/main/.git/worktrees/<name>`
 *
 * @param path - Path to check
 * @returns true if path is in a git worktree
 */
export function isWorktree(path: string): boolean {
	const gitPath = join(path, ".git");

	if (!existsSync(gitPath)) {
		return false;
	}

	try {
		const stats = statSync(gitPath);
		// Worktree has .git as a file, main repo has .git as a directory
		return stats.isFile();
	} catch {
		return false;
	}
}

/**
 * Resolves the main repository path from a worktree or main repo path.
 *
 * If already in main repo, returns the same path.
 * If in a worktree, parses the `.git` file to find the main repo location.
 *
 * @param path - Path to worktree or main repo
 * @returns Path to the main repository
 * @throws Error if .git file cannot be parsed
 */
export function getMainRepoPath(path: string): string {
	if (!isWorktree(path)) {
		return normalize(path);
	}

	const gitFilePath = join(path, ".git");
	const gitFileContent = readFileSync(gitFilePath, "utf-8");

	// Parse "gitdir: /path/to/main/.git/worktrees/<name>"
	const match = gitFileContent.match(/^gitdir:\s*(.+)$/m);

	if (!match || !match[1]) {
		throw new Error(
			`Failed to parse .git file at ${gitFilePath}. Expected format: "gitdir: <path>"`,
		);
	}

	const gitdirPath = match[1].trim();

	// gitdirPath is like: /path/to/main/.git/worktrees/<name>
	// We need to go up three levels to get to main repo: /path/to/main
	// 1: <name> -> worktrees, 2: worktrees -> .git, 3: .git -> main
	const mainRepoPath = resolve(gitdirPath, "..", "..", "..");

	return normalize(mainRepoPath);
}

/**
 * Resolves the database path to the main repository for consistent access across worktrees.
 *
 * @param path - Current path
 * @param relativeDbPath - Path to database relative to repo root (default: .opencode/swarm.db)
 * @returns Absolute path to the database in the main repository
 */
export function resolveDbPath(
	path: string,
	relativeDbPath = ".opencode/swarm.db",
): string {
	const mainPath = getMainRepoPath(path);
	return normalize(join(mainPath, relativeDbPath));
}
