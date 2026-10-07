/**
 * Version is read from package.json at runtime to prevent drift.
 * This was previously a hardcoded constant that would get out of sync.
 */
// In built code, package.json is one level up from dist/
// In source, it's also one level up from src/
// Use a static path so bundlers can resolve it at build time
import packageJson from "../package.json";

export const SWARM_MAIL_VERSION: string = packageJson.version;
