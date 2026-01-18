/**
 * FlushManager - Debounced JSONL export to file
 *
 * Automatically exports dirty cells to a JSONL file on a debounced timer.
 * Prevents excessive writes while ensuring changes are persisted.
 *
 * Based on steveyegge/cells flush_manager.go
 *
 * @module hive/flush-manager
 */

import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import type { HiveAdapter } from "../types/hive-adapter.js";
import {
	type CellExport,
	exportDirtyCells,
	parseJSONL,
	serializeToJSONL,
} from "./jsonl.js";
import { clearDirtyCell } from "./projections.js";

export interface FlushManagerOptions {
	adapter: HiveAdapter;
	projectKey: string;
	outputPath: string;
	debounceMs?: number; // Default 30000 (30s)
	onFlush?: (result: FlushResult) => void;
}

export interface FlushResult {
	cellsExported: number;
	bytesWritten: number;
	duration: number;
}

/**
 * FlushManager handles debounced export of dirty cells to JSONL
 *
 * Usage:
 * ```ts
 * const manager = new FlushManager({
 *   adapter,
 *   projectKey: "/path/to/project",
 *   outputPath: ".cells/issues.jsonl",
 *   debounceMs: 30000,
 * });
 *
 * // Schedule flushes as cells change
 * manager.scheduleFlush();
 *
 * // Clean up
 * manager.stop();
 * ```
 */
export class FlushManager {
	private adapter: HiveAdapter;
	private projectKey: string;
	private outputPath: string;
	private debounceMs: number;
	private onFlush?: (result: FlushResult) => void;
	private timer: NodeJS.Timeout | null = null;
	private flushing = false;

	constructor(options: FlushManagerOptions) {
		this.adapter = options.adapter;
		this.projectKey = options.projectKey;
		this.outputPath = options.outputPath;
		this.debounceMs = options.debounceMs ?? 30000;
		this.onFlush = options.onFlush;
	}

	/**
	 * Schedule a flush (debounced)
	 *
	 * If a flush is already scheduled, resets the timer.
	 */
	scheduleFlush(): void {
		// Clear existing timer
		if (this.timer) {
			clearTimeout(this.timer);
		}

		// Schedule new flush
		this.timer = setTimeout(() => {
			this.flush().catch((err) => {
				console.error("[FlushManager] Flush error:", err);
			});
		}, this.debounceMs);
	}

	/**
	 * Force immediate flush
	 *
	 * Exports all dirty cells to the output file, merging with existing content.
	 * Dirty cells overwrite existing cells with the same ID.
	 */
	async flush(): Promise<FlushResult> {
		const startTime = Date.now();

		// Prevent concurrent flushes
		if (this.flushing) {
			return {
				cellsExported: 0,
				bytesWritten: 0,
				duration: 0,
			};
		}

		this.flushing = true;

		try {
			// Clear pending timer
			if (this.timer) {
				clearTimeout(this.timer);
				this.timer = null;
			}

			// Export dirty cells
			const { jsonl: dirtyJsonl, cellIds } = await exportDirtyCells(
				this.adapter,
				this.projectKey,
			);

			if (cellIds.length === 0) {
				return {
					cellsExported: 0,
					bytesWritten: 0,
					duration: Date.now() - startTime,
				};
			}

			// Parse dirty cells
			const dirtyCells = parseJSONL(dirtyJsonl);
			const dirtyCellIds = new Set(dirtyCells.map((c) => c.id));

			// Read existing file and merge
			let existingCells: CellExport[] = [];
			if (existsSync(this.outputPath)) {
				try {
					const existingContent = await readFile(this.outputPath, "utf-8");
					existingCells = parseJSONL(existingContent);
				} catch {
					// File exists but can't be read/parsed - start fresh
					existingCells = [];
				}
			}

			// Merge: keep existing cells that aren't dirty, add all dirty cells
			const mergedCells: CellExport[] = [
				...existingCells.filter((c) => !dirtyCellIds.has(c.id)),
				...dirtyCells,
			];

			// Serialize merged result
			const mergedJsonl = mergedCells.map((c) => serializeToJSONL(c)).join("");

			// Write to file
			await writeFile(this.outputPath, mergedJsonl, "utf-8");
			const bytesWritten = Buffer.byteLength(mergedJsonl, "utf-8");

			// Clear dirty flags
			const db = await this.adapter.getDatabase();
			for (const cellId of cellIds) {
				await clearDirtyCell(db, this.projectKey, cellId);
			}

			const result: FlushResult = {
				cellsExported: cellIds.length,
				bytesWritten,
				duration: Date.now() - startTime,
			};

			// Notify callback
			if (this.onFlush) {
				this.onFlush(result);
			}

			return result;
		} finally {
			this.flushing = false;
		}
	}

	/**
	 * Stop the flush manager
	 *
	 * Clears any pending timers. Does NOT flush pending changes.
	 */
	stop(): void {
		if (this.timer) {
			clearTimeout(this.timer);
			this.timer = null;
		}
	}
}
