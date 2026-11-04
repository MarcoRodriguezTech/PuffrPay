import "dotenv/config";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { Pool } from "pg";

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set");
  }
  const pool = new Pool({
    connectionString,
    ssl:
      connectionString.includes("localhost") ||
      connectionString.includes("127.0.0.1")
        ? false
        : { rejectUnauthorized: false },
  });

  const dir = path.join(process.cwd(), "db", "migrations");
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  await pool.query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      name TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  const applied = new Set(
    (await pool.query<{ name: string }>("SELECT name FROM _migrations")).rows.map(
      (r) => r.name
    )
  );

  for (const file of files) {
    if (applied.has(file)) {
      console.log(`skip  ${file} (already applied)`);
      continue;
    }
    const sql = readFileSync(path.join(dir, file), "utf8");
    await pool.query("BEGIN");
    try {
      await pool.query(sql);
      await pool.query("INSERT INTO _migrations (name) VALUES ($1)", [file]);
      await pool.query("COMMIT");
      console.log(`apply ${file}`);
    } catch (err) {
      await pool.query("ROLLBACK");
      throw err;
    }
  }

  await pool.end();
  console.log("migrations done");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
