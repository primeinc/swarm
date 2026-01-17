#!/usr/bin/env bun
/**
 * Scope ALL packages for fork publishing
 *
 * Takes UNSCOPED local package names and adds @owner/ prefix for publishing
 *
 * Local names (in repo):     Published as:
 * swarm                  ->  @owner/swarm
 * swarm-mail             ->  @owner/swarm-mail
 * swarm-path             ->  @owner/swarm-path
 * swarm-claude-code      ->  @owner/swarm-claude-code
 * swarm-evals            ->  @owner/swarm-evals
 * swarm-dashboard        ->  @owner/swarm-dashboard
 */

import { existsSync, readdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

const owner = process.argv[2];
if (!owner) {
	console.error("Usage: bun scripts/scope-packages.ts <owner>");
	process.exit(1);
}

const scope = `@${owner}`;

// ============================================================================
// PACKAGE NAME MAPPINGS
// ============================================================================
// Local unscoped name -> Scoped published name

const packageNameMappings: Record<string, string> = {
	swarm: `${scope}/swarm`,
	"swarm-mail": `${scope}/swarm-mail`,
	"swarm-path": `${scope}/swarm-path`,
	"swarm-claude-code": `${scope}/swarm-claude-code`,
	"swarm-evals": `${scope}/swarm-evals`,
	"swarm-dashboard": `${scope}/swarm-dashboard`,
};

// ============================================================================
// HELPERS
// ============================================================================

function updateDependencies(
	deps: Record<string, string> | undefined,
	mappings: Record<string, string>,
): { updated: Record<string, string>; changes: string[] } | undefined {
	if (!deps) return undefined;

	const updated: Record<string, string> = {};
	const changes: string[] = [];

	for (const [name, version] of Object.entries(deps)) {
		const newName = mappings[name];
		if (newName) {
			updated[newName] = version;
			changes.push(`${name} -> ${newName}`);
		} else {
			updated[name] = version;
		}
	}

	return { updated, changes };
}

// ============================================================================
// MAIN
// ============================================================================

console.log(`\n🔧 Scoping ALL packages to ${scope}\n`);

// Find all packages dynamically
const packagesDir = "packages";
const packageDirs = readdirSync(packagesDir)
	.map((dir) => join(packagesDir, dir))
	.filter((dir) => existsSync(join(dir, "package.json")));

console.log(`Found ${packageDirs.length} packages\n`);
console.log("=".repeat(60));

// Process each package
for (const dir of packageDirs) {
	const pkgPath = join(dir, "package.json");
	const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
	const oldName = pkg.name;
	let changed = false;

	console.log(`\n📦 ${dir}`);
	console.log(`   Current name: ${oldName}`);

	// Rename package if mapping exists
	const newName = packageNameMappings[oldName];
	if (newName && newName !== oldName) {
		pkg.name = newName;
		changed = true;
		console.log(`   Scoped name:  ${newName}`);
	} else if (!newName) {
		console.log(`   ⚠️  WARNING: No mapping for "${oldName}"`);
	}

	// Update all dependency types
	for (const depType of [
		"dependencies",
		"devDependencies",
		"peerDependencies",
		"optionalDependencies",
	]) {
		const deps = pkg[depType] as Record<string, string> | undefined;
		if (deps) {
			const result = updateDependencies(deps, packageNameMappings);
			if (result && result.changes.length > 0) {
				pkg[depType] = result.updated;
				changed = true;
				console.log(`   ${depType}:`);
				for (const change of result.changes) {
					console.log(`     - ${change}`);
				}
			}
		}
	}

	if (changed) {
		writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
		console.log(`   ✅ Updated`);
	} else {
		console.log(`   (no changes needed)`);
	}
}

// Update root package.json scripts
console.log("\n" + "=".repeat(60));
console.log("\n📄 Root package.json");

const rootPkgPath = "package.json";
if (existsSync(rootPkgPath)) {
	const rootPkg = JSON.parse(readFileSync(rootPkgPath, "utf-8"));
	let changed = false;
	const scriptChanges: string[] = [];

	if (rootPkg.scripts) {
		for (const [scriptName, scriptCmd] of Object.entries(rootPkg.scripts)) {
			let newCmd = scriptCmd as string;
			for (const [oldName, newName] of Object.entries(packageNameMappings)) {
				if (newCmd.includes(`--filter=${oldName}`)) {
					newCmd = newCmd.replace(`--filter=${oldName}`, `--filter=${newName}`);
				}
			}
			if (newCmd !== scriptCmd) {
				rootPkg.scripts[scriptName] = newCmd;
				changed = true;
				scriptChanges.push(`${scriptName}: updated filter`);
			}
		}
	}

	if (changed) {
		writeFileSync(rootPkgPath, JSON.stringify(rootPkg, null, 2) + "\n");
		for (const change of scriptChanges) {
			console.log(`   - ${change}`);
		}
		console.log(`   ✅ Updated`);
	} else {
		console.log(`   (no changes needed)`);
	}
}

console.log("\n" + "=".repeat(60));
console.log(`\n✨ All packages scoped to ${scope}\n`);
