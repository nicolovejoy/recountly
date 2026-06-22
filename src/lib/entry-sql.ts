// Driver-agnostic SQL for the entries table (unit-tested in entry-sql.test.ts).
// Each builder returns a parameterized { text, values } that any node-postgres
// -style client can run (pg, @neondatabase/serverless, @vercel/postgres's
// .query). Keeping the SQL and the row→EntryRecord mapping pure means they're
// testable without a live database; the chosen driver just executes them.

import type { EntryRecord } from "./entry";

export interface SqlQuery {
  text: string;
  values: unknown[];
}

// Column list shared by reads so SELECT order stays in lockstep with rowToEntry.
const COLUMNS =
  "id, recorded_at, created_at, updated_at, duration_seconds, transcript, title, tags, audio_url, audio_mime, audio_bytes";

export function insertEntrySql(rec: EntryRecord): SqlQuery {
  return {
    text: `INSERT INTO entries (${COLUMNS}) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    values: [
      rec.id,
      rec.recordedAt,
      rec.createdAt,
      rec.updatedAt,
      rec.durationSeconds,
      rec.transcript,
      rec.title,
      rec.tags,
      rec.audioUrl,
      rec.audioMime,
      rec.audioBytes,
    ],
  };
}

// Newest-first list for the entry index (Phase 2).
export function listEntriesSql(limit = 50): SqlQuery {
  return {
    text: `SELECT ${COLUMNS} FROM entries ORDER BY recorded_at DESC LIMIT $1`,
    values: [limit],
  };
}

export function getEntrySql(id: string): SqlQuery {
  return {
    text: `SELECT ${COLUMNS} FROM entries WHERE id = $1`,
    values: [id],
  };
}

// A row as returned by the driver: snake_case columns; timestamptz comes back
// as a Date (node-postgres) or an ISO string (some HTTP drivers) — handle both.
export type EntryRow = Record<string, unknown>;

function toIso(v: unknown): string {
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

export function rowToEntry(row: EntryRow): EntryRecord {
  return {
    id: String(row.id),
    recordedAt: toIso(row.recorded_at),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
    durationSeconds: Number(row.duration_seconds),
    transcript: String(row.transcript),
    title: row.title == null ? null : String(row.title),
    tags: Array.isArray(row.tags) ? (row.tags as string[]) : [],
    audioUrl: row.audio_url == null ? null : String(row.audio_url),
    audioMime: row.audio_mime == null ? null : String(row.audio_mime),
    audioBytes: row.audio_bytes == null ? null : Number(row.audio_bytes),
  };
}
