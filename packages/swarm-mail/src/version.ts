/**
 * Version is read from package.json at runtime to prevent drift.
 * This was previously a hardcoded constant that would get out of sync.
 */
import { createRequire } from "module";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

// Use createRequire to load package.json (works with ESM)
const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

// In built code, package.json is one level up from dist/
// In source, it's also one level up from src/
const packageJson = require(join(__dirname, "..", "package.json"));

export const SWARM_MAIL_VERSION: string = packageJson.version;
