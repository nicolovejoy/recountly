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
  deleteEntrySql,
  softDeleteEntrySql,
  listTrashedSql,
  restoreEntrySql,
  updateEnrichmentSql,
  listUnenrichedSql,
  rowToEntry,
  type EntryRow,
  type SearchFilters,
} from "./entry-sql";
import type { EntryRecord, EntryEnrichment } from "./entry";
import {
  insertJournalSql,
  listJournalsSql,
  getJournalSql,
  setActiveJournalSql,
  rowToJournal,
  type JournalRecord,
} from "./journal";
import {
  insertPhotoSql,
  listPhotosByEntrySql,
  getPhotoSql,
  deletePhotosByEntrySql,
  rowToPhoto,
  type PhotoRecord,
} from "./photo";

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

// Issue #9 delete. Returns whether a row was actually deleted (false = no such
// id), via RETURNING id rather than a separate existence check.
export async function deleteEntry(
  id: string,
  runner: QueryRunner = defaultRunner(),
): Promise<boolean> {
  const { text, values } = deleteEntrySql(id);
  const rows = await runner.query(text, values);
  return rows.length > 0;
}

// Soft-delete (trash): marks the row deleted_at rather than removing it.
// Returns whether a live row was actually trashed (false = unknown id or
// already trashed), via RETURNING id rather than a separate existence check.
export async function softDeleteEntry(
  id: string,
  runner: QueryRunner = defaultRunner(),
): Promise<boolean> {
  const { text, values } = softDeleteEntrySql(id);
  const rows = await runner.query(text, values);
  return rows.length > 0;
}

// Trash view (issue #27): trashed rows only, newest-trashed first.
export async function listTrashedEntries(
  limit = 50,
  runner: QueryRunner = defaultRunner(),
): Promise<EntryRecord[]> {
  const { text, values } = listTrashedSql(limit);
  const rows = await runner.query(text, values);
  return rows.map(rowToEntry);
}

// Un-trash: clears deleted_at. Returns whether a trashed row was actually
// restored (false = unknown id or not trashed), via RETURNING id.
export async function restoreEntry(
  id: string,
  runner: QueryRunner = defaultRunner(),
): Promise<boolean> {
  const { text, values } = restoreEntrySql(id);
  const rows = await runner.query(text, values);
  return rows.length > 0;
}

// Phase 4 enrichment: write the LLM fields onto an existing row.
export async function updateEntryEnrichment(
  id: string,
  enrichment: EntryEnrichment,
  nowIso: string,
  runner: QueryRunner = defaultRunner(),
): Promise<void> {
  const { text, values } = updateEnrichmentSql(id, enrichment, nowIso);
  await runner.query(text, values);
}

// Rows never enriched (newest-first), for the backfill endpoint.
export async function listUnenriched(
  limit = 50,
  runner: QueryRunner = defaultRunner(),
): Promise<EntryRecord[]> {
  const { text, values } = listUnenrichedSql(limit);
  const rows = await runner.query(text, values);
  return rows.map(rowToEntry);
}

// Journals (physical-journal archive).
export async function insertJournal(
  j: JournalRecord,
  runner: QueryRunner = defaultRunner(),
): Promise<JournalRecord> {
  const { text, values } = insertJournalSql(j);
  await runner.query(text, values);
  return j;
}

export async function listJournals(
  runner: QueryRunner = defaultRunner(),
): Promise<JournalRecord[]> {
  const { text, values } = listJournalsSql();
  const rows = await runner.query(text, values);
  return rows.map(rowToJournal);
}

export async function getJournal(
  id: string,
  runner: QueryRunner = defaultRunner(),
): Promise<JournalRecord | null> {
  const { text, values } = getJournalSql(id);
  const rows = await runner.query(text, values);
  return rows.length ? rowToJournal(rows[0]) : null;
}

// Returns whether the activation actually matched a journal (true always for
// id == null — clearing the lock has nothing to 404 on), so the route can
// tell an unknown id apart from a successful activation.
export async function setActiveJournal(
  id: string | null,
  runner: QueryRunner = defaultRunner(),
): Promise<boolean> {
  const { text, values } = setActiveJournalSql(id);
  const rows = await runner.query(text, values);
  return id == null ? true : rows.length > 0;
}

// Photos (physical-journal archive). NOT best-effort — callers let errors throw.
export async function insertPhoto(
  p: PhotoRecord,
  runner: QueryRunner = defaultRunner(),
): Promise<PhotoRecord> {
  const { text, values } = insertPhotoSql(p);
  await runner.query(text, values);
  return p;
}

export async function listPhotosByEntry(
  entryId: string,
  runner: QueryRunner = defaultRunner(),
): Promise<PhotoRecord[]> {
  const { text, values } = listPhotosByEntrySql(entryId);
  const rows = await runner.query(text, values);
  return rows.map(rowToPhoto);
}

export async function getPhoto(
  id: string,
  runner: QueryRunner = defaultRunner(),
): Promise<PhotoRecord | null> {
  const { text, values } = getPhotoSql(id);
  const rows = await runner.query(text, values);
  return rows.length ? rowToPhoto(rows[0]) : null;
}

// Issue #9 delete: must run before deleteEntry (no ON DELETE CASCADE on
// photos.entry_id).
export async function deletePhotosByEntry(
  entryId: string,
  runner: QueryRunner = defaultRunner(),
): Promise<void> {
  const { text, values } = deletePhotosByEntrySql(entryId);
  await runner.query(text, values);
}
