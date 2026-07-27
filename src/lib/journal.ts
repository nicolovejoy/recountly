// Physical-journal archive (issue #15): the journals table groups readings by
// the paper notebook they came from. Same layering as entries — pure SQL
// builders + row mapping here (unit-tested, no driver), executed by db.ts.
// `active` marks the notebook currently being read so captures default to it;
// setActiveJournalSql keeps "at most one active" atomic in a single UPDATE.
//
// Journal management (PR A, 2026-07-27): rename/edit + delete. startedOn/
// endedOn/kind are additive columns (see db/schema.sql) — startedOn/endedOn
// hold an owner-set date range that overrides the computed-from-entries range
// where set (date-range.ts's resolveJournalDateRange); kind is "archive" |
// null (null = live capture) and is a column only for now — Library
// grouping/badging by kind is deliberately deferred.

import { toIso, type SqlQuery } from "./entry-sql";

export interface JournalRecord {
  id: string;
  label: string;
  notes: string | null;
  active: boolean;
  createdAt: string;
  startedOn: string | null; // YYYY-MM-DD
  endedOn: string | null; // YYYY-MM-DD
  kind: string | null; // "archive" | null
}

// Partial update payload for PATCH /api/journals/[id] — every key optional,
// but the route requires at least one (validateJournalUpdate enforces it).
export interface JournalUpdate {
  label?: string;
  notes?: string | null;
  startedOn?: string | null;
  endedOn?: string | null;
  kind?: string | null;
}

// Human-readable problems; empty means valid (same contract as validateEntryInput).
export function validateJournalInput(input: { label?: unknown; notes?: unknown }): string[] {
  const errors: string[] = [];
  if (typeof input.label !== "string" || input.label.trim().length === 0) {
    errors.push("label is required");
  }
  if (input.notes != null && typeof input.notes !== "string") {
    errors.push("notes must be a string");
  }
  return errors;
}

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

function isValidDateOrNull(v: unknown): boolean {
  return v === null || (typeof v === "string" && DATE_ONLY_RE.test(v));
}

// Human-readable problems; empty means valid. Pure/stateless — when both
// startedOn and endedOn are present in the SAME patch it checks their order,
// but doesn't reach into the existing row (a patch that only touches endedOn
// isn't compared against a previously-stored startedOn).
export function validateJournalUpdate(patch: {
  label?: unknown;
  notes?: unknown;
  startedOn?: unknown;
  endedOn?: unknown;
  kind?: unknown;
}): string[] {
  const errors: string[] = [];
  const provided = (["label", "notes", "startedOn", "endedOn", "kind"] as const).filter((k) =>
    Object.prototype.hasOwnProperty.call(patch, k),
  );
  if (provided.length === 0) {
    errors.push("at least one field is required");
    return errors;
  }

  if ("label" in patch) {
    if (typeof patch.label !== "string" || patch.label.trim().length === 0) {
      errors.push("label is required");
    }
  }
  if ("notes" in patch) {
    if (patch.notes !== null && typeof patch.notes !== "string") {
      errors.push("notes must be a string or null");
    }
  }
  if ("startedOn" in patch && !isValidDateOrNull(patch.startedOn)) {
    errors.push("startedOn must be YYYY-MM-DD or null");
  }
  if ("endedOn" in patch && !isValidDateOrNull(patch.endedOn)) {
    errors.push("endedOn must be YYYY-MM-DD or null");
  }
  if (
    typeof patch.startedOn === "string" &&
    typeof patch.endedOn === "string" &&
    patch.startedOn > patch.endedOn
  ) {
    errors.push("startedOn must not be after endedOn");
  }
  if ("kind" in patch && patch.kind !== null && patch.kind !== "archive") {
    errors.push('kind must be "archive" or null');
  }
  return errors;
}

// Insert only sets the original columns — startedOn/endedOn/kind are always
// null on creation (column default) and only ever set later via PATCH.
const INSERT_COLUMNS = "id, label, notes, active, created_at";

// Full row shape, shared by every SELECT (get/list) and by updateJournalSql's
// RETURNING so callers always see the complete record.
const SELECT_COLUMNS = "id, label, notes, active, created_at, started_on, ended_on, kind";

export function insertJournalSql(j: JournalRecord): SqlQuery {
  return {
    text: `INSERT INTO journals (${INSERT_COLUMNS}) VALUES ($1, $2, $3, $4, $5)`,
    values: [j.id, j.label, j.notes, j.active, j.createdAt],
  };
}

// Active journal first (the picker's default), then newest-first.
export function listJournalsSql(): SqlQuery {
  return {
    text: `SELECT ${SELECT_COLUMNS} FROM journals ORDER BY active DESC, created_at DESC`,
    values: [],
  };
}

export function getJournalSql(id: string): SqlQuery {
  return {
    text: `SELECT ${SELECT_COLUMNS} FROM journals WHERE id = $1`,
    values: [id],
  };
}

// Column each JournalUpdate key writes to; also fixes iteration order so a
// multi-field patch's placeholders ($2, $3, ...) are deterministic regardless
// of key order in the incoming object.
const UPDATE_COLUMNS: { key: keyof JournalUpdate; column: string }[] = [
  { key: "label", column: "label" },
  { key: "notes", column: "notes" },
  { key: "startedOn", column: "started_on" },
  { key: "endedOn", column: "ended_on" },
  { key: "kind", column: "kind" },
];

// Dynamic SET over only the provided keys; RETURNING the full row so the
// route can respond with the up-to-date JournalRecord in one query. Assumes
// the caller already ran validateJournalUpdate (label trimmed here to match
// validateJournalInput/insertJournalSql's trim-on-write behavior).
export function updateJournalSql(id: string, patch: JournalUpdate): SqlQuery {
  const present = UPDATE_COLUMNS.filter(({ key }) =>
    Object.prototype.hasOwnProperty.call(patch, key),
  );
  const sets = present.map(({ column }, i) => `${column} = $${i + 2}`);
  const values = present.map(({ key }) => {
    const v = patch[key];
    return key === "label" && typeof v === "string" ? v.trim() : v;
  });
  return {
    text: `UPDATE journals SET ${sets.join(", ")} WHERE id = $1 RETURNING ${SELECT_COLUMNS}`,
    values: [id, ...values],
  };
}

// Every entry referencing this journal — live and trashed (the FK doesn't
// care about trash; a trashed row still blocks a hard delete). The route's
// 409 body separates the two so its message can call out the confusing case
// where the visible (live) count is 0 but trashed entries still exist.
export function countJournalEntriesSql(id: string): SqlQuery {
  return {
    text:
      "SELECT count(*)::int AS total, count(*) FILTER (WHERE deleted_at IS NOT NULL)::int AS trashed " +
      "FROM entries WHERE journal_id = $1",
    values: [id],
  };
}

// entry_moves.from_journal_id/to_journal_id FK journals with no ON DELETE, so
// even an empty journal (zero current entries) can have move history — same
// manual-cleanup idiom as src/lib/purge.ts. Nulls out just the references to
// this journal, keeping the audit row (and its other side) intact.
export function clearJournalMoveRefsSql(id: string): SqlQuery {
  return {
    text:
      "UPDATE entry_moves SET " +
      "from_journal_id = CASE WHEN from_journal_id = $1 THEN NULL ELSE from_journal_id END, " +
      "to_journal_id = CASE WHEN to_journal_id = $1 THEN NULL ELSE to_journal_id END " +
      "WHERE from_journal_id = $1 OR to_journal_id = $1",
    values: [id],
  };
}

export function deleteJournalSql(id: string): SqlQuery {
  return { text: "DELETE FROM journals WHERE id = $1 RETURNING id", values: [id] };
}

// Activating one journal deactivates every other row in the same statement;
// null means "no active journal". The EXISTS guard keeps a nonexistent id from
// touching any row (without it, the no-WHERE UPDATE would deactivate every
// journal and only then report the miss): unknown id → zero rows updated →
// zero rows returned, while a hit updates every row and RETURNING is non-empty.
export function setActiveJournalSql(id: string | null): SqlQuery {
  if (id == null) {
    return { text: "UPDATE journals SET active = false WHERE active", values: [] };
  }
  return {
    text: "UPDATE journals SET active = (id = $1) WHERE EXISTS (SELECT 1 FROM journals WHERE id = $1) RETURNING id",
    values: [id],
  };
}

// Library page (issue #29): one row per journal with live-entry aggregates.
// The deleted_at filter lives in the JOIN condition — not WHERE — so journals
// with zero live entries still appear (with entry_count 0 and null dates).
// notes/startedOn/endedOn/kind (PR A) ride along so LibraryView/JournalView
// can render the manage panel and the resolved date range without a second
// fetch per journal.
export interface JournalSummary {
  id: string;
  label: string;
  notes: string | null;
  active: boolean;
  createdAt: string;
  startedOn: string | null; // YYYY-MM-DD
  endedOn: string | null; // YYYY-MM-DD
  kind: string | null; // "archive" | null
  entryCount: number; // live entries only (deleted_at IS NULL)
  firstEntryAt: string | null; // min effective date; null when entryCount is 0
  lastEntryAt: string | null; // max effective date
}

export function journalSummariesSql(): SqlQuery {
  return {
    text:
      "SELECT j.id, j.label, j.notes, j.active, j.created_at, j.started_on, j.ended_on, j.kind, " +
      "count(e.id)::int AS entry_count, " +
      "min(coalesce(e.written_at, e.recorded_at)) AS first_at, " +
      "max(coalesce(e.written_at, e.recorded_at)) AS last_at " +
      "FROM journals j LEFT JOIN entries e ON e.journal_id = j.id AND e.deleted_at IS NULL " +
      "GROUP BY j.id, j.label, j.notes, j.active, j.created_at, j.started_on, j.ended_on, j.kind " +
      "ORDER BY j.active DESC, j.created_at DESC",
    values: [],
  };
}

export function unfiledCountSql(): SqlQuery {
  return {
    text: "SELECT count(*)::int AS unfiled FROM entries WHERE journal_id IS NULL AND deleted_at IS NULL",
    values: [],
  };
}

// `date` columns come back as either a Date (node-postgres) or a "YYYY-MM-DD"
// string (some HTTP drivers) — normalize both to the date-only string form
// JournalRecord/JournalUpdate use throughout.
function toDateOnly(v: unknown): string | null {
  if (v == null) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).slice(0, 10);
}

export function rowToJournalSummary(row: Record<string, unknown>): JournalSummary {
  return {
    id: String(row.id),
    label: String(row.label),
    notes: row.notes == null ? null : String(row.notes),
    active: Boolean(row.active),
    createdAt: toIso(row.created_at),
    startedOn: toDateOnly(row.started_on),
    endedOn: toDateOnly(row.ended_on),
    kind: row.kind == null ? null : String(row.kind),
    entryCount: Number(row.entry_count),
    firstEntryAt: row.first_at == null ? null : toIso(row.first_at),
    lastEntryAt: row.last_at == null ? null : toIso(row.last_at),
  };
}

export function rowToJournal(row: Record<string, unknown>): JournalRecord {
  return {
    id: String(row.id),
    label: String(row.label),
    notes: row.notes == null ? null : String(row.notes),
    active: Boolean(row.active),
    createdAt: toIso(row.created_at),
    startedOn: toDateOnly(row.started_on),
    endedOn: toDateOnly(row.ended_on),
    kind: row.kind == null ? null : String(row.kind),
  };
}
