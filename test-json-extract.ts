import { createClient } from "@libsql/client";

const client = createClient({ url: "file:./test-json.db" });

async function test() {
  await client.execute("CREATE TABLE IF NOT EXISTS test (id INTEGER PRIMARY KEY, data TEXT)");
  await client.execute("DELETE FROM test");
  await client.execute("INSERT INTO test (id, data) VALUES (1, ?)", [
    JSON.stringify({ to: ["coordinator"] }),
  ]);

  // Test json_extract on array - using '$.' path
  const r1 = await client.execute(`SELECT json_extract(data, '$.to') as to_field FROM test`);
  console.log("json_extract result:", r1.rows[0]);
  console.log("type:", typeof r1.rows[0].to_field);

  // Test getting full data and parsing
  const r2 = await client.execute("SELECT data FROM test");
  const parsed = JSON.parse(r2.rows[0].data as string);
  console.log("Full parse result:", parsed);
  console.log("to is array:", Array.isArray(parsed.to));
}

test().catch(console.error);
