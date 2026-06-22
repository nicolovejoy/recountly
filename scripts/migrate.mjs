// Apply db/schema.sql to the Neon database in DATABASE_URL.
// Idempotent (schema uses IF NOT EXISTS). Run with env loaded, e.g.:
//   node --env-file=.env.local scripts/migrate.mjs
// or via the package script: pnpm db:migrate
//
// The neon HTTP driver runs one statement per call. Strip `--` comments first
// (an inline comment contains a `;`, which would otherwise split a statement
// mid-way), then split on `;`.

import { neon } from "@neondatabase/serverless";
import { readFileSync } from "node:fs";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set (run with `node --env-file=.env.local`)");
  process.exit(1);
}

const sql = neon(url);
const schema = readFileSync(new URL("../db/schema.sql", import.meta.url), "utf8");

const withoutComments = schema
  .split("\n")
  .map((line) => {
    const i = line.indexOf("--");
    return i >= 0 ? line.slice(0, i) : line;
  })
  .join("\n");

const statements = withoutComments
  .split(";")
  .map((s) => s.trim())
  .filter(Boolean);

for (const stmt of statements) {
  await sql.query(stmt);
  console.log("ok:", stmt.replace(/\s+/g, " ").slice(0, 70));
}
console.log(`\nschema applied (${statements.length} statements)`);
