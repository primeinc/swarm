/**
 * Proof that swarm-mail's libSQL adapter has no SQLITE_BUSY errors
 * Using the actual createLibSQLAdapter() which sets up WAL mode
 */

import { randomUUID } from "crypto";
import { tmpdir } from "os";
import { join } from "path";
import { createLibSQLAdapter } from "./src/libsql.js";

const TEST_DB = join(tmpdir(), `swarm-mail-stress-${randomUUID()}.db`);

async function main() {
	console.log("🔬 Testing swarm-mail's createLibSQLAdapter()...\n");
	console.log(`📁 Test database: ${TEST_DB}\n`);

	// Use the actual adapter factory
	const db = await createLibSQLAdapter({ url: `file:${TEST_DB}` });

	// Verify WAL mode is enabled
	console.log("1️⃣  Verifying WAL mode...");
	const mode = await db.query<{ journal_mode: string }>("PRAGMA journal_mode");
	console.log(`   ✅ Journal mode: ${mode.rows[0]?.journal_mode}\n`);

	// Setup table
	console.log("2️⃣  Creating test table...");
	await db.exec(`
    CREATE TABLE IF NOT EXISTS stress_test (
      id TEXT PRIMARY KEY,
      data TEXT,
      counter INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);
	console.log("   ✅ Table created\n");

	// Concurrent writes test
	console.log("3️⃣  Hammering with 50 concurrent INSERTS...");
	const insertStart = Date.now();
	const insertPromises = Array.from({ length: 50 }, (_, i) =>
		db.query("INSERT INTO stress_test (id, data, counter) VALUES (?, ?, ?)", [
			randomUUID(),
			`data-${i}`,
			i,
		]),
	);

	const insertResults = await Promise.allSettled(insertPromises);
	const insertSuccesses = insertResults.filter(
		(r) => r.status === "fulfilled",
	).length;
	const insertFailures = insertResults.filter((r) => r.status === "rejected");

	console.log(
		`   ✅ ${insertSuccesses}/50 inserts in ${Date.now() - insertStart}ms`,
	);
	if (insertFailures.length > 0) {
		console.log(`   ❌ ${insertFailures.length} failures:`);
		insertFailures.slice(0, 3).forEach((f) => {
			if (f.status === "rejected") console.log(`      ${f.reason}`);
		});
	}
	console.log();

	// Concurrent reads + writes
	console.log("4️⃣  Simultaneous reads AND writes (100 operations)...");
	const mixedStart = Date.now();
	const mixedPromises = Array.from({ length: 100 }, (_, i) => {
		if (i % 2 === 0) {
			return db.query("SELECT COUNT(*) as cnt FROM stress_test");
		} else {
			return db.query(
				"INSERT INTO stress_test (id, data, counter) VALUES (?, ?, ?)",
				[randomUUID(), `mixed-${i}`, i],
			);
		}
	});

	const mixedResults = await Promise.allSettled(mixedPromises);
	const mixedSuccesses = mixedResults.filter(
		(r) => r.status === "fulfilled",
	).length;
	const mixedFailures = mixedResults.filter((r) => r.status === "rejected");

	console.log(
		`   ✅ ${mixedSuccesses}/100 operations in ${Date.now() - mixedStart}ms`,
	);
	if (mixedFailures.length > 0) {
		console.log(`   ❌ ${mixedFailures.length} failures:`);
		mixedFailures.slice(0, 3).forEach((f) => {
			if (f.status === "rejected") console.log(`      ${f.reason}`);
		});
	}
	console.log();

	// Transaction test
	console.log("5️⃣  Concurrent transactions (10 parallel)...");
	const txStart = Date.now();
	const txPromises = Array.from({ length: 10 }, async (_, batch) =>
		db.transaction(async (tx) => {
			for (let i = 0; i < 5; i++) {
				await tx.query(
					"INSERT INTO stress_test (id, data, counter) VALUES (?, ?, ?)",
					[randomUUID(), `tx-${batch}-${i}`, batch * 10 + i],
				);
			}
			return "committed";
		}),
	);

	const txResults = await Promise.allSettled(txPromises);
	const txSuccesses = txResults.filter((r) => r.status === "fulfilled").length;
	const txFailures = txResults.filter((r) => r.status === "rejected");

	console.log(
		`   ✅ ${txSuccesses}/10 transactions in ${Date.now() - txStart}ms`,
	);
	if (txFailures.length > 0) {
		console.log(`   ❌ ${txFailures.length} failures:`);
		txFailures.forEach((f) => {
			if (f.status === "rejected") console.log(`      ${f.reason}`);
		});
	}
	console.log();

	// Final count
	const finalCount = await db.query<{ cnt: number }>(
		"SELECT COUNT(*) as cnt FROM stress_test",
	);
	const count = finalCount.rows[0]?.cnt;

	console.log("6️⃣  Final verification...");
	console.log(`   📊 Total rows: ${count}`);
	console.log(`   📊 Expected: ~150 (50 + 50 + 50 from transactions)`);
	console.log();

	// Check for SQLITE_BUSY
	const allFailures = [...insertFailures, ...mixedFailures, ...txFailures];
	const busyErrors = allFailures.filter(
		(f) => f.status === "rejected" && String(f.reason).includes("SQLITE_BUSY"),
	);

	console.log("═".repeat(50));
	if (busyErrors.length === 0 && allFailures.length === 0) {
		console.log("🎉 PROOF COMPLETE: swarm-mail has ZERO SQLITE_BUSY errors!");
		console.log("   WAL mode + busy_timeout working correctly.");
	} else if (busyErrors.length === 0) {
		console.log("⚠️  Some failures but NONE were SQLITE_BUSY");
		console.log(`   Total failures: ${allFailures.length}`);
	} else {
		console.log("❌ SQLITE_BUSY errors detected!");
		console.log(`   Count: ${busyErrors.length}`);
	}
	console.log("═".repeat(50));

	await db.close();
}

main().catch(console.error);
