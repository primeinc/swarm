# Swarm-Mail Experiments

Proof-of-concept scripts and research spikes. These files are **NOT production code** - they're explorations, learning tools, and validation tests.

## Files

### Vector Embeddings

**`prove-it.ts`** - Local embeddings without Ollama

Tests using `@huggingface/transformers` for in-process embedding generation. Demonstrates:
- 23MB model download (Xenova/all-MiniLM-L6-v2)
- In-process embeddings (no external Ollama dependency)
- Cosine similarity calculations
- Semantic vs unrelated text discrimination

**Run:**
```bash
bun add @huggingface/transformers  # First time only
bun run prove-it.ts
```

**Why it matters:** Could eliminate Ollama requirement for hivemind semantic memory, making setup simpler for users.

---

### SQLite Concurrency

**`prove-no-busy.ts`** - libSQL eliminates SQLITE_BUSY errors

Stress test demonstrating libSQL's concurrent operation handling:
- 50 concurrent INSERTs
- 100 mixed read/write operations
- 10 parallel transactions

**Run:**
```bash
bun run prove-no-busy.ts
```

**Why it matters:** Proves libSQL can handle multi-agent swarm coordination without database locking errors that plagued the PGLite implementation.

---

**`prove-wal-mode.ts`** - WAL mode + batch operations pattern

Demonstrates recommended SQLite pattern for swarm-mail:
- `PRAGMA journal_mode = WAL` - Write-Ahead Logging for concurrency
- `PRAGMA busy_timeout = 5000` - Graceful retry on contention
- `client.batch()` - Multi-statement operations instead of transactions

**Run:**
```bash
bun run prove-wal-mode.ts
```

**Why it matters:** Shows the **correct** way to use SQLite in multi-agent systems. Transactions are serialized; batches are the recommended approach.

---

### High-Level Adapter Tests

**`../prove-adapter-no-busy.ts`** - SwarmMailAdapter concurrency test

Tests the SwarmMailAdapter (full system) under concurrent load. Located in parent directory (`packages/swarm-mail/`).

**Run:**
```bash
cd packages/swarm-mail
bun run prove-adapter-no-busy.ts
```

---

## Running All Experiments

```bash
# From packages/swarm-mail directory
cd packages/swarm-mail/experiments

bun run prove-it.ts         # Embeddings
bun run prove-no-busy.ts    # Low-level libSQL stress test
bun run prove-wal-mode.ts   # WAL + batch pattern
cd .. && bun run prove-adapter-no-busy.ts  # High-level adapter test
```

---

## Dependencies

Most experiments use only dependencies already in `package.json`. Exception:

- `prove-it.ts` requires `@huggingface/transformers` (NOT in package.json - experimental)

---

## When to Run These

- **Before architecture changes** - Validate assumptions still hold
- **Debugging concurrency issues** - Isolate whether problem is in libSQL layer or adapter
- **Onboarding new contributors** - Show how the concurrency model works
- **Performance tuning** - Baseline before/after optimization

---

## Not Tests

These are **NOT** unit tests (no assertions, no test framework). They're **proofs** - you run them, read the output, and judge success visually.

For actual tests, see `src/**/*.test.ts` files.
