// Driver-agnostic SQL for the entries table (unit-tested in entry-sql.test.ts).
// Each builder returns a parameterized { text, values } that any node-postgres
// -style client can run (pg, @neondatabase/serverless, @vercel/postgres's
// .query). Keeping the SQL and the row→EntryRecord mapping pure means they're
// testable without a live database; the chosen driver just executes them.

import type { EntryRecord, EntryEnrichment } from "./entry";

export interface SqlQuery {
  text: string;
  values: unknown[];
}

// Column list shared by reads so SELECT order stays in lockstep with rowToEntry.
// Enrichment columns (summary, enriched_at, enrichment_model — Phase 4) append
// at the end; title/tags predate them. journal_id/written_at (physical-journal
// archive) append after those.
const COLUMNS =
  "id, recorded_at, created_at, updated_at, duration_seconds, transcript, title, tags, audio_url, audio_mime, audio_bytes, audio_complete, summary, enriched_at, enrichment_model, journal_id, written_at";

export function insertEntrySql(rec: EntryRecord): SqlQuery {
  return {
    text: `INSERT INTO entries (${COLUMNS}) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)`,
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
      rec.audioComplete,
      rec.summary,
      rec.enrichedAt,
      rec.enrichmentModel,
      rec.journalId,
      rec.writtenAt,
    ],
  };
}

// Newest-first list for the entry index (Phase 2). Uses the effective date
// (coalesce(written_at, recorded_at)) so archived journal pages sort by when
// they were written, not when they were transcribed in.
export function listEntriesSql(limit = 50): SqlQuery {
  return {
    text: `SELECT ${COLUMNS} FROM entries ORDER BY coalesce(written_at, recorded_at) DESC LIMIT $1`,
    values: [limit],
  };
}

// Phase 3 search. Free-text over the generated transcript_tsv (title+transcript)
// plus an optional inclusive recorded_at date range. With no filters it degrades
// to the same newest-first list as listEntriesSql.
export interface SearchFilters {
  query?: string; // free text; matched via websearch_to_tsquery
  journalId?: string; // exact match on entries.journal_id
  from?: string; // YYYY-MM-DD, inclusive lower bound on the effective date
  to?: string; // YYYY-MM-DD, inclusive — covers the whole day
  limit?: number;
}

export function searchEntriesSql(f: SearchFilters = {}): SqlQuery {
  const EFFECTIVE_AT = "coalesce(written_at, recorded_at)";
  const where: string[] = [];
  const values: unknown[] = [];
  let p = 0;
  const next = (v: unknown) => {
    values.push(v);
    return `$${++p}`;
  };

  const query = f.query?.trim();
  let rankExpr = "";
  if (query) {
    // One placeholder reused in both the filter and the ranking expression.
    const ph = next(query);
    where.push(`transcript_tsv @@ websearch_to_tsquery('english', ${ph})`);
    rankExpr = `ts_rank(transcript_tsv, websearch_to_tsquery('english', ${ph}))`;
  }
  if (f.journalId) where.push(`journal_id = ${next(f.journalId)}`);
  if (f.from) where.push(`${EFFECTIVE_AT} >= ${next(f.from)}::date`);
  if (f.to) where.push(`${EFFECTIVE_AT} < (${next(f.to)}::date + 1)`);

  const whereSql = where.length ? ` WHERE ${where.join(" AND ")}` : "";
  const orderSql = rankExpr
    ? ` ORDER BY ${rankExpr} DESC, ${EFFECTIVE_AT} DESC`
    : ` ORDER BY ${EFFECTIVE_AT} DESC`;
  const limitPh = next(f.limit ?? 50);
  return {
    text: `SELECT ${COLUMNS} FROM entries${whereSql}${orderSql} LIMIT ${limitPh}`,
    values,
  };
}

export function getEntrySql(id: string): SqlQuery {
  return {
    text: `SELECT ${COLUMNS} FROM entries WHERE id = $1`,
    values: [id],
  };
}

// Phase 4 enrichment backfill: write the LLM fields onto an existing row and
// bump updated_at. Takes the enrichment plus the id and a now-ISO timestamp.
export function updateEnrichmentSql(
  id: string,
  e: EntryEnrichment,
  nowIso: string,
): SqlQuery {
  return {
    text: `UPDATE entries SET title = $1, tags = $2, summary = $3, enriched_at = $4, enrichment_model = $5, updated_at = $6 WHERE id = $7`,
    values: [e.title, e.tags, e.summary, nowIso, e.model, nowIso, id],
  };
}

// Rows that have never been enriched (newest-first), for the backfill endpoint.
export function listUnenrichedSql(limit = 50): SqlQuery {
  return {
    text: `SELECT ${COLUMNS} FROM entries WHERE enriched_at IS NULL ORDER BY recorded_at DESC LIMIT $1`,
    values: [limit],
  };
}

// A row as returned by the driver: snake_case columns; timestamptz comes back
// as a Date (node-postgres) or an ISO string (some HTTP drivers) — handle both.
export type EntryRow = Record<string, unknown>;

export function toIso(v: unknown): string {
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
    summary: row.summary == null ? null : String(row.summary),
    enrichedAt: row.enriched_at == null ? null : toIso(row.enriched_at),
    enrichmentModel: row.enrichment_model == null ? null : String(row.enrichment_model),
    audioUrl: row.audio_url == null ? null : String(row.audio_url),
    audioMime: row.audio_mime == null ? null : String(row.audio_mime),
    audioBytes: row.audio_bytes == null ? null : Number(row.audio_bytes),
    audioComplete: row.audio_complete == null ? null : Boolean(row.audio_complete),
    journalId: row.journal_id == null ? null : String(row.journal_id),
    writtenAt: row.written_at == null ? null : toIso(row.written_at),
  };
}
