/**
 * Legacy Semantic Memory Migration Tool - STUB
 *
 * PGLite support has been removed. This module now contains stubs for
 * backward compatibility that perform no-op operations.
 */

import type { DatabaseAdapter } from "../types/database.js";

export interface MigrationOptions {
	legacyPath?: string;
	targetDb: DatabaseAdapter;
	dryRun?: boolean;
	onProgress?: (message: string) => void;
}

export interface MigrationResult {
	migrated: number;
	skipped: number;
	failed: number;
	errors: string[];
	dryRun: boolean;
}

export function getDefaultLegacyPath(): string {
	return "";
}

export function legacyDatabaseExists(_path?: string): boolean {
	return false;
}

export async function migrateLegacyMemories(
	options: MigrationOptions,
): Promise<MigrationResult> {
	return {
		migrated: 0,
		skipped: 0,
		failed: 0,
		errors: [
			"PGLite support has been removed. Migration is no longer possible.",
		],
		dryRun: !!options.dryRun,
	};
}

export async function getMigrationStatus(
	_legacyPath?: string,
): Promise<{ total: number; withEmbeddings: number } | null> {
	return null;
}

/**
 * Check if target database already has memories
 *
 * @param targetDb - Target database adapter
 * @returns true if memories exist, false if empty
 */
export async function targetHasMemories(
	targetDb: DatabaseAdapter,
): Promise<boolean> {
	const result = await targetDb.query<{ count: string }>(`
    SELECT COUNT(id) as count FROM memories
  `);
	return parseInt(result.rows[0]?.count || "0") > 0;
}
