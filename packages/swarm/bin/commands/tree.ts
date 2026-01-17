/**
 * @fileoverview Tree command for visualizing Hive cell hierarchies
 *
 * Inspired by Chainlink's tree visualization.
 * Credit: https://github.com/dollspace-gay/chainlink
 *
 * Usage:
 *   swarm tree                 - Show all Hive cells as tree
 *   swarm tree --status open   - Filter by status
 *   swarm tree --epic <id>     - Show specific Hive epic subtree
 *   swarm tree --json          - JSON output
 */

import * as p from "@clack/prompts";
import type { Cell } from "swarm-mail";
import { createHiveAdapter, getSwarmMailLibSQL } from "swarm-mail";
import {
	buildTreeStructure,
	renderTree,
} from "../../src/utils/tree-renderer.js";

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;

export interface TreeOptions {
	status?: string;
	epic?: string;
	json?: boolean;
}

/**
 * Parse tree command arguments
 */
export function parseTreeArgs(args: string[]): TreeOptions {
	const options: TreeOptions = {};

	for (let i = 0; i < args.length; i++) {
		const arg = args[i];

		if (arg === "--status" && i + 1 < args.length) {
			options.status = args[++i];
		} else if (arg === "--epic" && i + 1 < args.length) {
			options.epic = args[++i];
		} else if (arg === "--json") {
			options.json = true;
		}
	}

	return options;
}

/**
 * Execute Hive tree command
 */
export async function tree(args: string[] = []) {
	const options = parseTreeArgs(args);

	const projectPath = process.cwd();

	try {
		const swarmMail = await getSwarmMailLibSQL(projectPath);
		const db = await swarmMail.getDatabase();
		const adapter = createHiveAdapter(db, projectPath);

		// Run migrations to ensure schema exists
		await adapter.runMigrations();

		// Query cells with filters
		let cells: Cell[];

		if (options.epic) {
			// Get epic and its descendants
			const epic = await adapter.getCell(projectPath, options.epic);
			if (!epic) {
				p.log.error(`Epic not found: ${options.epic}`);
				process.exit(1);
			}

			// Get all cells that are children of this epic
			const allCells = await adapter.queryCells(projectPath, {
				limit: 1000,
			});

			// Filter to epic and its descendants
			cells = [epic];
			const childIds = new Set([epic.id]);

			// Iteratively find all descendants
			let foundNew = true;
			while (foundNew) {
				foundNew = false;
				for (const cell of allCells) {
					if (
						cell.parent_id &&
						childIds.has(cell.parent_id) &&
						!childIds.has(cell.id)
					) {
						cells.push(cell);
						childIds.add(cell.id);
						foundNew = true;
					}
				}
			}
		} else {
			// Get all cells
			cells = await adapter.queryCells(projectPath, {
				status: options.status as any,
				limit: 1000,
			});
		}

		if (cells.length === 0) {
			p.log.message(dim("No Hive cells found"));
			return;
		}

		// Output
		if (options.json) {
			const tree = buildTreeStructure(cells);
			console.log(JSON.stringify(tree, null, 2));
		} else {
			const tree = buildTreeStructure(cells);
			const output = renderTree(tree);
			console.log(output);
		}
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		p.log.error(`Failed to render tree: ${message}`);
		process.exit(1);
	}
}
