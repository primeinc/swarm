/**
 * Proof that libSQL eliminates SQLITE_BUSY errors
 * 
 * This test hammers the database with concurrent reads and writes
 * to prove the connection handling is solid.
 */
import { createClient } from "@libsql/client";
import { join } from "path";
import { tmpdir } from "os";
import { randomUUID } from "crypto";

const TEST_DB = join(tmpdir(), `libsql-stress-${randomUUID()}.db`);

async function main() {
  console.log("🔬 Proving SQLITE_BUSY is gone with libSQL...\n");
  console.log(`📁 Test database: ${TEST_DB}\n`);

  // Create client
  const client = createClient({
    url: `file:${TEST_DB}`,
  });

  // Setup table
  console.log("1️⃣  Creating test table...");
  await client.execute(`
    CREATE TABLE IF NOT EXISTS stress_test (
      id TEXT PRIMARY KEY,
      data TEXT,
      counter INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);
  console.log("   ✅ Table created\n");

  // Concurrent writes test
  console.log("2️⃣  Hammering with 50 concurrent INSERTS...");
  const insertStart = Date.now();
  const insertPromises = Array.from({ length: 50 }, (_, i) =>
    client.execute({
      sql: "INSERT INTO stress_test (id, data, counter) VALUES (?, ?, ?)",
      args: [randomUUID(), `data-${i}`, i],
    })
  );

  const insertResults = await Promise.allSettled(insertPromises);
  const insertSuccesses = insertResults.filter((r) => r.status === "fulfilled").length;
  const insertFailures = insertResults.filter((r) => r.status === "rejected");
  
  console.log(`   ✅ ${insertSuccesses}/50 inserts succeeded in ${Date.now() - insertStart}ms`);
  if (insertFailures.length > 0) {
    console.log(`   ❌ ${insertFailures.length} failures:`);
    insertFailures.forEach((f) => {
      if (f.status === "rejected") console.log(`      ${f.reason}`);
    });
  }
  console.log();

  // Concurrent reads + writes test
  console.log("3️⃣  Simultaneous reads AND writes (100 operations)...");
  const mixedStart = Date.now();
  const mixedPromises = Array.from({ length: 100 }, (_, i) => {
    if (i % 2 === 0) {
      // Read
      return client.execute("SELECT COUNT(*) as cnt FROM stress_test");
    } else {
      // Write
      return client.execute({
        sql: "INSERT INTO stress_test (id, data, counter) VALUES (?, ?, ?)",
        args: [randomUUID(), `mixed-${i}`, i],
      });
    }
  });

  const mixedResults = await Promise.allSettled(mixedPromises);
  const mixedSuccesses = mixedResults.filter((r) => r.status === "fulfilled").length;
  const mixedFailures = mixedResults.filter((r) => r.status === "rejected");

  console.log(`   ✅ ${mixedSuccesses}/100 operations succeeded in ${Date.now() - mixedStart}ms`);
  if (mixedFailures.length > 0) {
    console.log(`   ❌ ${mixedFailures.length} failures:`);
    mixedFailures.slice(0, 5).forEach((f) => {
      if (f.status === "rejected") console.log(`      ${f.reason}`);
    });
  }
  console.log();

  // Transaction test
  console.log("4️⃣  Concurrent transactions (10 parallel batches)...");
  const txStart = Date.now();
  const txPromises = Array.from({ length: 10 }, async (_, batch) => {
    const tx = await client.transaction("write");
    try {
      for (let i = 0; i < 5; i++) {
        await tx.execute({
          sql: "INSERT INTO stress_test (id, data, counter) VALUES (?, ?, ?)",
          args: [randomUUID(), `tx-${batch}-${i}`, batch * 10 + i],
        });
      }
      await tx.commit();
      return "committed";
    } catch (e) {
      await tx.rollback();
      throw e;
    }
  });

  const txResults = await Promise.allSettled(txPromises);
  const txSuccesses = txResults.filter((r) => r.status === "fulfilled").length;
  const txFailures = txResults.filter((r) => r.status === "rejected");

  console.log(`   ✅ ${txSuccesses}/10 transactions committed in ${Date.now() - txStart}ms`);
  if (txFailures.length > 0) {
    console.log(`   ❌ ${txFailures.length} transaction failures:`);
    txFailures.forEach((f) => {
      if (f.status === "rejected") console.log(`      ${f.reason}`);
    });
  }
  console.log();

  // Final count
  const finalCount = await client.execute("SELECT COUNT(*) as cnt FROM stress_test");
  const count = finalCount.rows[0]?.cnt;

  console.log("5️⃣  Final verification...");
  console.log(`   📊 Total rows in database: ${count}`);
  console.log(`   📊 Expected: ~150 (50 + 50 writes + 50 from transactions)`);
  console.log();

  // Check for any SQLITE_BUSY in the failures
  const allFailures = [...insertFailures, ...mixedFailures, ...txFailures];
  const busyErrors = allFailures.filter(
    (f) => f.status === "rejected" && String(f.reason).includes("SQLITE_BUSY")
  );

  console.log("═".repeat(50));
  if (busyErrors.length === 0 && allFailures.length === 0) {
    console.log("🎉 PROOF COMPLETE: Zero SQLITE_BUSY errors!");
    console.log("   libSQL handles concurrency properly.");
  } else if (busyErrors.length === 0) {
    console.log("⚠️  Some failures occurred but NONE were SQLITE_BUSY");
    console.log(`   Total failures: ${allFailures.length}`);
  } else {
    console.log("❌ SQLITE_BUSY errors detected!");
    console.log(`   Count: ${busyErrors.length}`);
  }
  console.log("═".repeat(50));

  client.close();
}

main().catch(console.error);
