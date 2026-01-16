import {
	copyFileSync,
	existsSync,
	mkdirSync,
	readdirSync,
	renameSync,
	rmSync,
	unlinkSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { normalize } from "swarm-cross-path";

/**
 * Database File Operations
 *
 * Safe filesystem operations for SQLite databases.
 * Handles auxiliary files (-wal, -shm) and implements
 * retries for Windows file locking.
 */
export class DbFileOps {
	private static readonly MAX_RETRIES = 60;
	private static readonly RETRY_DELAY_MS = 1000;

	/**
	 * Safe rename of a database file
	 */
	static async rename(oldPath: string, newPath: string): Promise<void> {
		const oldNorm = normalize(oldPath);
		const newNorm = normalize(newPath);

		// Ensure target directory exists
		const targetDir = dirname(newNorm);
		if (!existsSync(targetDir)) {
			mkdirSync(targetDir, { recursive: true });
		}

		// List of files to move (main DB + sidecars)
		const filesToMove = [
			{ old: oldNorm, new: newNorm },
			{ old: `${oldNorm}-wal`, new: `${newNorm}-wal` },
			{ old: `${oldNorm}-shm`, new: `${newNorm}-shm` },
		];

		for (const pair of filesToMove) {
			if (existsSync(pair.old)) {
				await DbFileOps.withRetry(() => renameSync(pair.old, pair.new));
			}
		}
	}

	/**
	 * Safe removal of a database file
	 */
	static async remove(
		path: string,
		options: { recursive?: boolean } = {},
	): Promise<void> {
		const norm = normalize(path);
		const filesToRemove = [norm, `${norm}-wal`, `${norm}-shm`];

		for (const file of filesToRemove) {
			if (existsSync(file)) {
				await DbFileOps.withRetry(() =>
					rmSync(file, { force: true, recursive: options.recursive }),
				);
			}
		}
	}

	static exists(path: string): boolean {
		return existsSync(normalize(path));
	}

	static readdir(path: string): string[] {
		const norm = normalize(path);
		if (!existsSync(norm)) return [];
		return readdirSync(norm);
	}

	/**
	 * Safe creation of a directory
	 */
	static async mkdir(
		path: string,
		options: { recursive?: boolean } = { recursive: true },
	): Promise<void> {
		const norm = normalize(path);
		if (!existsSync(norm)) {
			await DbFileOps.withRetry(() =>
				mkdirSync(norm, { recursive: options.recursive }),
			);
		}
	}

	/**
	 * Execute an operation with retries for Windows locking
	 */
	private static async withRetry(fn: () => void): Promise<void> {
		let lastError: unknown;
		// Exponential backoff with jitter
		// Max total wait: ~60 seconds
		for (let i = 0; i < DbFileOps.MAX_RETRIES; i++) {
			try {
				fn();
				return;
			} catch (e: unknown) {
				lastError = e;
				if (
					e &&
					typeof e === "object" &&
					"code" in e &&
					(e.code === "EBUSY" || e.code === "EPERM" || e.code === "EACCES")
				) {
					// Force garbage collection if available to release handles
					if (global.gc) {
						try {
							global.gc();
						} catch {}
					}

					// Exponential backoff: 100ms, 200ms, 400ms... up to 2000ms
					const delay = Math.min(2000, 100 * 1.5 ** i + Math.random() * 100);
					await new Promise((resolve) => setTimeout(resolve, delay));
					continue;
				}
				throw e;
			}
		}
		throw lastError;
	}
}
