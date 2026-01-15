#!/usr/bin/env bun
/**
 * Scope packages for fork publishing
 * 
 * Renames packages to @owner/swarm and @owner/swarm-mail
 * Updates internal workspace:* references to match
 */

import { readFileSync, writeFileSync } from "fs";
import { join } from "path";

const owner = process.argv[2];
if (!owner) {
  console.error("Usage: bun scripts/scope-packages.ts <owner>");
  process.exit(1);
}

const scope = `@${owner}`;

// Package mappings: directory -> new name
const packages = {
  "packages/opencode-swarm-plugin": `${scope}/swarm`,
  "packages/swarm-mail": `${scope}/swarm-mail`,
};

// First pass: collect versions
const versions: Record<string, string> = {};
for (const [dir, newName] of Object.entries(packages)) {
  const pkgPath = join(dir, "package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
  versions[newName] = pkg.version;
}

// Second pass: update packages
for (const [dir, newName] of Object.entries(packages)) {
  const pkgPath = join(dir, "package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
  
  const oldName = pkg.name;
  pkg.name = newName;
  
  // Update internal dependency references - resolve workspace:* to actual version
  if (pkg.dependencies?.["swarm-mail"]) {
    const swarmMailVersion = versions[`${scope}/swarm-mail`];
    pkg.dependencies[`${scope}/swarm-mail`] = swarmMailVersion || pkg.dependencies["swarm-mail"];
    delete pkg.dependencies["swarm-mail"];
  }
  
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
  console.log(`✅ ${oldName} → ${newName}`);
}

// Update turbo.json if it has package filters
const turboPath = "turbo.json";
try {
  const turbo = JSON.parse(readFileSync(turboPath, "utf-8"));
  writeFileSync(turboPath, JSON.stringify(turbo, null, 2) + "\n");
} catch {
  // turbo.json may not exist or be valid
}

console.log(`\n📦 Packages scoped to ${scope}`);
