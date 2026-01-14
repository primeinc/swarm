#!/usr/bin/env bun
/**
 * Dynamically scopes all publishable packages based on repository owner.
 * This makes the repo fork-friendly - anyone can publish to their own npm scope.
 *
 * Usage: bun scripts/scope-packages.ts <owner>
 * Example: bun scripts/scope-packages.ts joelhooks
 *
 * This will transform:
 *   - "swarm-mail" → "@joelhooks/swarm-mail"
 *   - "opencode-swarm-plugin" → "@joelhooks/swarm"
 *   - workspace:* references updated accordingly
 */

import { readFileSync, writeFileSync, readdirSync, statSync } from "fs";
import { join } from "path";

const owner = process.argv[2];

if (!owner) {
  console.error("Usage: bun scripts/scope-packages.ts <owner>");
  process.exit(1);
}

const ROOT = process.cwd();
const PACKAGES_DIR = join(ROOT, "packages");

// Map of original names to scoped names
// opencode-swarm-plugin becomes @owner/swarm for brevity
const NAME_MAP: Record<string, (owner: string) => string> = {
  "swarm-mail": (o) => `@${o}/swarm-mail`,
  "opencode-swarm-plugin": (o) => `@${o}/swarm`,
  "@swarmtools/evals": (o) => `@${o}/swarm-evals`,
  "swarm-dashboard": (o) => `@${o}/swarm-dashboard`,
};

// Packages that should be published (not private)
const PUBLISHABLE = ["swarm-mail", "opencode-swarm-plugin", "@swarmtools/evals"];

function getPackageDirs(): string[] {
  return readdirSync(PACKAGES_DIR)
    .map((name) => join(PACKAGES_DIR, name))
    .filter((path) => {
      try {
        return statSync(path).isDirectory() &&
               statSync(join(path, "package.json")).isFile();
      } catch {
        return false;
      }
    });
}

function readPackageJson(dir: string): any {
  return JSON.parse(readFileSync(join(dir, "package.json"), "utf-8"));
}

function writePackageJson(dir: string, pkg: any): void {
  writeFileSync(join(dir, "package.json"), JSON.stringify(pkg, null, 2) + "\n");
}

// Build the name mapping for this owner
const nameMapping: Record<string, string> = {};
for (const [original, transform] of Object.entries(NAME_MAP)) {
  nameMapping[original] = transform(owner);
}

console.log(`\n🐝 Scoping packages for @${owner}\n`);

// First pass: collect all package names and their new names
const packages = getPackageDirs();
for (const dir of packages) {
  const pkg = readPackageJson(dir);
  const originalName = pkg.name;

  if (nameMapping[originalName]) {
    console.log(`  ${originalName} → ${nameMapping[originalName]}`);
  }
}

// Second pass: update all package.json files
console.log("\n📦 Updating package.json files...\n");

for (const dir of packages) {
  const pkg = readPackageJson(dir);
  const originalName = pkg.name;
  let modified = false;

  // Update package name if it's in our mapping
  if (nameMapping[originalName]) {
    pkg.name = nameMapping[originalName];
    modified = true;
  }

  // Update dependencies that reference workspace packages
  for (const depType of ["dependencies", "devDependencies", "peerDependencies"]) {
    if (!pkg[depType]) continue;

    for (const [depName, depVersion] of Object.entries(pkg[depType] as Record<string, string>)) {
      if (nameMapping[depName]) {
        // Replace workspace:* with the actual version of the package in the workspace
        // This is necessary because 'bun pm pack' (and npm pack) cannot resolve 'workspace:*'
        // once the package name has been changed and we are outside a workspace context.
        let depDirName = depName;
        if (depName === "opencode-swarm-plugin") depDirName = "opencode-swarm-plugin";
        else if (depName === "swarm-mail") depDirName = "swarm-mail";
        else if (depName === "swarm-dashboard") depDirName = "swarm-dashboard";
        else if (depName === "@swarmtools/evals") depDirName = "swarm-evals";

        const depPkg = readPackageJson(join(PACKAGES_DIR, depDirName));
        
        delete pkg[depType][depName];
        pkg[depType][nameMapping[depName]] = depPkg.version;
        modified = true;
      }
    }
  }

  if (modified) {
    writePackageJson(dir, pkg);
    console.log(`  ✓ ${originalName}`);
  }
}

// Update changeset config with the correct repo
const changesetConfigPath = join(ROOT, ".changeset", "config.json");
try {
  const changesetConfig = JSON.parse(readFileSync(changesetConfigPath, "utf-8"));

  // Get repo from GITHUB_REPOSITORY env var if available
  const repo = process.env.GITHUB_REPOSITORY || `${owner}/swarm-tools`;
  changesetConfig.changelog[1].repo = repo;

  writeFileSync(changesetConfigPath, JSON.stringify(changesetConfig, null, 2) + "\n");
  console.log(`\n✓ Updated .changeset/config.json repo to ${repo}`);
} catch (e) {
  console.warn(`\n⚠ Could not update changeset config: ${e}`);
}

// Third pass: update all changeset files (.changeset/*.md)
console.log("\n📝 Updating changeset files...\n");
const changesetDir = join(ROOT, ".changeset");
try {
  const changesetFiles = readdirSync(changesetDir)
    .filter(f => f.endsWith(".md") && f !== "README.md")
    .map(f => join(changesetDir, f));

  for (const file of changesetFiles) {
    let content = readFileSync(file, "utf-8");
    let modified = false;

    for (const [original, scoped] of Object.entries(nameMapping)) {
      // Changesets look like:
      // ---
      // "package-name": patch
      // ---
      // We only want to replace the package name in the frontmatter (between the --- markers)
      // The regex targets "package-name" followed by a colon, ensuring we don't hit prose.
      const regex = new RegExp(`^"${original}":`, "m");
      if (regex.test(content)) {
        content = content.replace(regex, `"${scoped}":`);
        modified = true;
      }
    }

    if (modified) {
      writeFileSync(file, content);
      console.log(`  ✓ Updated ${join(".changeset", file.split(/[\\/]/).pop()!)}`);
    }
  }
} catch (e) {
  console.warn(`\n⚠ Could not update changeset files: ${e}`);
}

console.log("\n✅ Done! Packages are now scoped to @" + owner + "\n");
