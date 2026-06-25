// Data-access layer — the thin glue that runs the tested SQL builders against
// Neon. All the logic (SQL text, params, row→EntryRecord) lives in entry-sql.ts
// and is unit-tested there; here we only execute and map. Each function takes
// an injectable QueryRunner so this layer is testable with a fake (no live DB).

import { neon } from "@neondatabase/serverless";
import {
  insertEntrySql,
  listEntriesSql,
  searchEntriesSql,
  getEntrySql,
  rowToEntry,
  type EntryRow,
  type SearchFilters,
} from "./entry-sql";
import type { EntryRecord } from "./entry";

// The one capability we need from the driver: run a parameterized query and get
// rows back. neon()'s `sql.query(text, params)` returns rows-by-default, which
// matches this shape exactly.
export interface QueryRunner {
  query(text: string, values: unknown[]): Promise<EntryRow[]>;
}

// Lazy + cached. neon() reads DATABASE_URL eagerly and throws if it's unset;
// since Next evaluates module top-level at build time, constructing it at import
// would crash `next build` before the env is provisioned. Build it on first use.
let cached: QueryRunner | null = null;
function defaultRunner(): QueryRunner {
  if (!cached) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    const sql = neon(url);
    cached = { query: (text, values) => sql.query(text, values) as Promise<EntryRow[]> };
  }
  return cached;
}

export async function insertEntry(
  rec: EntryRecord,
  runner: QueryRunner = defaultRunner(),
): Promise<EntryRecord> {
  const { text, values } = insertEntrySql(rec);
  await runner.query(text, values);
  return rec;
}

export async function listEntries(
  limit = 50,
  runner: QueryRunner = defaultRunner(),
): Promise<EntryRecord[]> {
  const { text, values } = listEntriesSql(limit);
  const rows = await runner.query(text, values);
  return rows.map(rowToEntry);
}

export async function searchEntries(
  filters: SearchFilters = {},
  runner: QueryRunner = defaultRunner(),
): Promise<EntryRecord[]> {
  const { text, values } = searchEntriesSql(filters);
  const rows = await runner.query(text, values);
  return rows.map(rowToEntry);
}

export async function getEntry(
  id: string,
  runner: QueryRunner = defaultRunner(),
): Promise<EntryRecord | null> {
  const { text, values } = getEntrySql(id);
  const rows = await runner.query(text, values);
  return rows.length ? rowToEntry(rows[0]) : null;
}
