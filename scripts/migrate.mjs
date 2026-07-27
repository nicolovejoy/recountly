// Apply db/schema.sql to the Neon database in DATABASE_URL.
// Idempotent (schema uses IF NOT EXISTS). Run with env loaded, e.g.:
//   node --env-file=.env.local scripts/migrate.mjs
// or via the package script: pnpm db:migrate
//
// The neon HTTP driver runs one statement per call, so the file is split on
// `;` (see sql-split.mjs, unit-tested) — dollar-quoted blocks (`DO $$ ... $$`,
// needed by the PR B FTS rebuild) are kept intact so their internal `;`s
// don't split the block apart.

import { neon } from "@neondatabase/serverless";
import { readFileSync } from "node:fs";
import { splitSqlStatements } from "./sql-split.mjs";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set (run with `node --env-file=.env.local`)");
  process.exit(1);
}

const sql = neon(url);
const schema = readFileSync(new URL("../db/schema.sql", import.meta.url), "utf8");

const statements = splitSqlStatements(schema);

for (const stmt of statements) {
  await sql.query(stmt);
  console.log("ok:", stmt.replace(/\s+/g, " ").slice(0, 70));
}
console.log(`\nschema applied (${statements.length} statements)`);
