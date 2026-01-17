---
"swarm": patch
"swarm-mail": patch
---

> "Software design is an exercise in human relationships."
> — Kent Beck, *Tidy First?*

This release fixes a critical module resolution error on Windows when the `swarm` CLI is installed globally via Bun.

**The Fix:**
- **Build-time Metadata**: The `package.json` is now copied into the `dist/` directory during the build process. This ensures Bun's Windows shim can find the necessary package metadata without relying on repository-relative paths.
- **Static Versioning**: Switched `swarm-mail` to use static ES module imports for versioning. This prevents runtime filesystem probes that often fail in global installation contexts.
- **Improved Pathing**: Optimized CLI path resolution to handle bundled and global installation layouts more gracefully.

**Why it matters:**
Windows users installing via `bun add -g @primeinc/swarm` previously encountered "Cannot find module 'package.json'" errors because the runtime was looking for metadata that wasn't included in the `dist` folder.
