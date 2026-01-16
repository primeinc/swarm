/**
 * Cell Operations - High-level CRUD operations using HiveAdapter
 *
 * Convenience functions that wrap HiveAdapter with validation.
 * Plugin tools should use these operations instead of calling adapter directly.
 *
 * ## Layering
 * - HiveAdapter: Low-level event sourcing operations
 * - operations.ts: High-level validated CRUD (THIS FILE)
 * - Plugin tools: Type-safe Zod-validated wrappers
 */

import type {
	Cell,
	HiveAdapter,
	QueryCellsOptions,
} from "../types/hive-adapter.js";
import {
	type CreateCellOptions,
	type UpdateCellOptions,
	validateCreatecell,
	validateUpdatecell,
} from "./validation.js";

/**
 * Create a new cell with validation
 *
 * @throws {Error} If validation fails
 */
export async function createCell(
	adapter: HiveAdapter,
	projectKey: string,
	options: CreateCellOptions,
): Promise<Cell> {
	// Validate options
	const validation = validateCreatecell(options);
	if (!validation.valid) {
		throw new Error(validation.errors.join(", "));
	}

	// Create cell via adapter
	return adapter.createCell(projectKey, {
		title: options.title,
		type: options.type,
		priority: options.priority ?? 2,
		description: options.description,
		parent_id: options.parent_id,
		assignee: options.assignee,
		created_by: options.created_by,
	});
}

/**
 * Get a cell by ID
 *
 * @returns Cell or null if not found
 */
export async function getCell(
	adapter: HiveAdapter,
	projectKey: string,
	cellId: string,
): Promise<Cell | null> {
	return adapter.getCell(projectKey, cellId);
}

/**
 * Update a cell with validation
 *
 * @throws {Error} If validation fails or cell not found
 */
export async function updateCell(
	adapter: HiveAdapter,
	projectKey: string,
	cellId: string,
	updates: UpdateCellOptions,
): Promise<Cell> {
	// Validate updates
	const validation = validateUpdatecell(updates);
	if (!validation.valid) {
		throw new Error(validation.errors.join(", "));
	}

	// Update via adapter
	return adapter.updateCell(projectKey, cellId, updates);
}

/**
 * Close a cell
 *
 * @throws {Error} If cell not found
 */
export async function closeCell(
	adapter: HiveAdapter,
	projectKey: string,
	cellId: string,
	reason: string,
	closedBy?: string,
): Promise<Cell> {
	return adapter.closeCell(projectKey, cellId, reason, {
		closed_by: closedBy,
	});
}

/**
 * Reopen a closed cell
 *
 * @throws {Error} If cell not found or invalid transition
 */
export async function reopenCell(
	adapter: HiveAdapter,
	projectKey: string,
	cellId: string,
	reopenedBy?: string,
): Promise<Cell> {
	return adapter.reopenCell(projectKey, cellId, {
		reopened_by: reopenedBy,
	});
}

/**
 * Delete a cell (soft delete - creates tombstone)
 *
 * @throws {Error} If cell not found
 */
export async function deleteCell(
	adapter: HiveAdapter,
	projectKey: string,
	cellId: string,
	reason: string,
	deletedBy?: string,
): Promise<void> {
	await adapter.deleteCell(projectKey, cellId, {
		reason,
		deleted_by: deletedBy,
	});
}

/**
 * Search cells by title
 *
 * Simple text search across cell titles with optional filters.
 */
export async function searchcells(
	adapter: HiveAdapter,
	projectKey: string,
	query: string,
	filter?: QueryCellsOptions,
): Promise<Cell[]> {
	// Get all cells matching filter
	const allcells = await adapter.queryCells(projectKey, filter);

	// Filter by query string if provided
	if (!query || query.trim().length === 0) {
		return allcells;
	}

	const lowerQuery = query.toLowerCase();
	return allcells.filter(
		(cell) =>
			cell.title.toLowerCase().includes(lowerQuery) ||
			cell.description?.toLowerCase().includes(lowerQuery),
	);
}
