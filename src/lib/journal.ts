// Physical-journal archive (issue #15): the journals table groups readings by
// the paper notebook they came from. Same layering as entries — pure SQL
// builders + row mapping here (unit-tested, no driver), executed by db.ts.
// `active` marks the notebook currently being read so captures default to it;
// setActiveJournalSql keeps "at most one active" atomic in a single UPDATE.

import { toIso, type SqlQuery } from "./entry-sql";

export interface JournalRecord {
  id: string;
  label: string;
  notes: string | null;
  active: boolean;
  createdAt: string;
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

const COLUMNS = "id, label, notes, active, created_at";

export function insertJournalSql(j: JournalRecord): SqlQuery {
  return {
    text: `INSERT INTO journals (${COLUMNS}) VALUES ($1, $2, $3, $4, $5)`,
    values: [j.id, j.label, j.notes, j.active, j.createdAt],
  };
}

// Active journal first (the picker's default), then newest-first.
export function listJournalsSql(): SqlQuery {
  return {
    text: `SELECT ${COLUMNS} FROM journals ORDER BY active DESC, created_at DESC`,
    values: [],
  };
}

export function getJournalSql(id: string): SqlQuery {
  return {
    text: `SELECT ${COLUMNS} FROM journals WHERE id = $1`,
    values: [id],
  };
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

export function rowToJournal(row: Record<string, unknown>): JournalRecord {
  return {
    id: String(row.id),
    label: String(row.label),
    notes: row.notes == null ? null : String(row.notes),
    active: Boolean(row.active),
    createdAt: toIso(row.created_at),
  };
}
