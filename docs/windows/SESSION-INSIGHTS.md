# Specialized Session Insights & Technical Discoveries

**Generated:** 2026-01-14  
**Epic:** `swarm-tools--lcljz-mkdcme939ao` (Windows Testing & Hardening)  
**Context:** Learnings from specialized Oracle reviews and deep implementation tasks.

---

## 1. DDP Protocol Implementation Gotchas

### Outbound Message Queueing
- **Discovery**: Messages sent while the client is in `CONNECTING` state were silently dropped.
- **Fix**: Implemented a `messageQueue` and `connectionState` tracker. Messages are now buffered and flushed automatically upon successful handshake.
- **Why it matters**: Prevents race conditions where extension logic calls methods immediately after `connect()` before the socket is fully ready.

### Precise RTT Calculation
- **Discovery**: Simple `ping/pong` without unique IDs leads to inaccurate Round Trip Time (RTT) if pings overlap or arrive out of order.
- **Fix**: Added unique `pingId` (sequential counter) and a `pendingPings` Map storing timestamps.
- **Pattern**: `id` field in DDP ping messages is optional but critical for concurrent pings.

### SockJS Framing Enforcement
- **Discovery**: Permissive parsing of SockJS frames (falling back to raw payload) can lead to "double-parsing" bugs or protocol confusion.
- **Best Practice**: Strictly reject frames that don't match expected SockJS types (`a`, `o`, `h`, `c`, `m`) when using SockJS transport.

---

## 2. Authentication & Automation Security

### Playwright Sandbox Risk
- **Discovery**: Common developer flags like `--no-sandbox` and `--disable-setuid-sandbox` bypass critical browser security layers.
- **Decision**: Excised these from `BrowserLogin.ts` and `DiscoverySession.ts`. Windows desktop environments rarely require these bypasses compared to restricted Docker environments.

### Redaction in Error Stacks
- **Discovery**: Redacting just the log output isn't enough. Error objects thrown by libraries (like Playwright) often embed sensitive variables in the `.stack` or `.message`.
- **Solution**: Implemented a redaction wrapper that sanitizes error messages and stacks before they are logged or surfaced to the user.

### Type Guarding DDP Events
- **Discovery**: Reliance on `as` type assertions for DDP messages (`AddedEvent`, `ChangedEvent`) hides runtime errors if the protocol shape changes.
- **Recommendation**: Use explicit type guards (e.g., `isDDPMessage(obj)`) to validate payload shapes before processing.

---

## 3. Tool-Specific Schema Quirks

### Hive Task Priority
- **Observation**: `hive_create` and `hive_update` require `priority` as a **NUMBER**.
- **Failure Mode**: Passing `"1"` (string) results in a Zod validation error.
- **Workaround**: Always use raw numbers in tool calls.

### Swarm Review Feedback Parsing
- **Observation**: `swarm_review_feedback` parses the `issues` string manually.
- **Failure Mode**: On Windows, passing an empty array `[]` as a string can get mangled by shell quoting.
- **Optimized Usage**: Omit the `issues` parameter entirely for approvals (`status: "approved"`) to bypass the parser.

---

## 4. Ingest Agent Production Hardening

### MongoDB Write Concern Mapping
- **Discovery**: Configurations stored in Zod as enums (`'1' | 'majority'`) must be cast to types MongoDB understands (`1 | 'majority'`).
- **Correction**: `this.config.MONGO_WRITE_CONCERN === '1' ? 1 : 'majority'`

### Disk Fallback Rotation
- **Discovery**: Size-based rotation (`fs.promises.stat`) on Windows is atomic for renames (`.bak`), but `appendFile` handles concurrent access differently than Linux.
- **Status**: Verified that the 100MB rotation logic creates backup files correctly without blocking the main event loop.

---

## 🚀 Future Recommendations (Oracle Seal)
1. **DDP Disposal**: Always call `client.dispose()` to clear all event listeners (EventEmitter leak prevention).
2. **Whitelist Redaction**: Never trust a blocklist for sensitive keys; only log keys you explicitly know are safe.
3. **Manual Verification**: After migrating tokens from `settings.json`, always prompt the user to manually verify the deletion, as some settings levels might still persist data.

---

## 5. Swarm Operational Failures

### Task Description Drift
- **Discovery**: Workers were assigned tasks (like adding a config key) that were already implemented in a previous turn.
- **Root Cause**: Coordinator context didn't reflect the true state of the filesystem or the worker's prompt was generated from an outdated plan.
- **Workaround**: Workers must perform a "Discovery Phase" (Step 2 in survival checklist) to verify if the task is already complete before writing code.

### SQLite Recovery Locks (SQLITE_BUSY_RECOVERY)
- **Discovery**: Occurs when a previous process crashed or was killed, leaving the database in a recovery state that blocks all new connections.
- **Fix**: Brief wait (500ms+) usually allows SQLite to finish recovery. In persistent cases, manually removing `.db-wal` or `.db-shm` files (if safe) may be required.

---

## 6. Advanced TypeScript & Concurrency

### noUncheckedIndexedAccess
- **Discovery**: Accessing `args[1]` in CLI tools threw errors even if length was checked.
- **Pattern**: `const val = args[1]; if (val === undefined) throw ...` or use a type guard.
- **Why**: The `noUncheckedIndexedAccess` compiler flag forces safety but increases boilerplate.

### MongoDB same-millisecond write race
- **Discovery**: Versioned upserts using `{ version: { $lt: newVersion } }` fail if two agents write in the same millisecond.
- **Fix**: Use `{ version: { $not: { $gt: newVersion } } }` to allow same-timestamp updates (last-writer-wins) while still preventing older data from overwriting newer data.

### DDP Resume Ordering Race
- **Discovery**: During `ddpClient.resume()`, the flag `isPaused` was set to `false` *before* the buffer was flushed, allowing new messages to jump the queue.
- **Fix**: Keep `isPaused = true` until the `pausedBuffer` is completely splice-d and processed.

---
*Capture verified by Sisyphus coordinator.*
