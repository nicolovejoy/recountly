import { describe, it, expect } from "vitest";
import {
  validateJournalInput,
  validateJournalUpdate,
  insertJournalSql,
  listJournalsSql,
  getJournalSql,
  updateJournalSql,
  countJournalEntriesSql,
  clearJournalMoveRefsSql,
  deleteJournalSql,
  setActiveJournalSql,
  rowToJournal,
  journalSummariesSql,
  unfiledCountSql,
  rowToJournalSummary,
  type JournalRecord,
} from "./journal";

const journal: JournalRecord = {
  id: "01JRNL",
  label: "Red notebook 1994",
  notes: null,
  active: false,
  createdAt: "2026-07-16T10:00:00.000Z",
  startedOn: null,
  endedOn: null,
  kind: null,
};

describe("validateJournalInput", () => {
  it("accepts a non-empty label with optional notes", () => {
    expect(validateJournalInput({ label: "Red notebook" })).toEqual([]);
    expect(validateJournalInput({ label: "Red", notes: "college years" })).toEqual([]);
  });
  it("rejects a missing or blank label", () => {
    expect(validateJournalInput({})).toContain("label is required");
    expect(validateJournalInput({ label: "   " })).toContain("label is required");
  });
  it("rejects non-string notes", () => {
    expect(validateJournalInput({ label: "ok", notes: 42 })).toContain(
      "notes must be a string",
    );
  });
});

describe("validateJournalUpdate", () => {
  it("requires at least one field", () => {
    expect(validateJournalUpdate({})).toContain("at least one field is required");
  });

  it("accepts a label-only patch", () => {
    expect(validateJournalUpdate({ label: "New label" })).toEqual([]);
  });

  it("rejects a blank or missing-type label when provided", () => {
    expect(validateJournalUpdate({ label: "   " })).toContain("label is required");
    expect(validateJournalUpdate({ label: 42 })).toContain("label is required");
  });

  it("accepts notes: null (clearing) or a string", () => {
    expect(validateJournalUpdate({ notes: null })).toEqual([]);
    expect(validateJournalUpdate({ notes: "college years" })).toEqual([]);
  });

  it("rejects non-string, non-null notes", () => {
    expect(validateJournalUpdate({ notes: 42 })).toContain("notes must be a string or null");
  });

  it("accepts YYYY-MM-DD dates or null for startedOn/endedOn", () => {
    expect(validateJournalUpdate({ startedOn: "1994-03-01" })).toEqual([]);
    expect(validateJournalUpdate({ startedOn: null })).toEqual([]);
    expect(validateJournalUpdate({ endedOn: "1994-06-01" })).toEqual([]);
    expect(validateJournalUpdate({ endedOn: null })).toEqual([]);
  });

  it("rejects malformed dates", () => {
    expect(validateJournalUpdate({ startedOn: "03/01/1994" })).toContain(
      "startedOn must be YYYY-MM-DD or null",
    );
    expect(validateJournalUpdate({ endedOn: "1994-6-1" })).toContain(
      "endedOn must be YYYY-MM-DD or null",
    );
  });

  it("accepts startedOn <= endedOn when both are provided", () => {
    expect(
      validateJournalUpdate({ startedOn: "1994-03-01", endedOn: "1994-06-01" }),
    ).toEqual([]);
    expect(
      validateJournalUpdate({ startedOn: "1994-03-01", endedOn: "1994-03-01" }),
    ).toEqual([]);
  });

  it("rejects startedOn after endedOn when both are provided", () => {
    expect(
      validateJournalUpdate({ startedOn: "1994-06-01", endedOn: "1994-03-01" }),
    ).toContain("startedOn must not be after endedOn");
  });

  it("doesn't compare dates against a prior row when only one is patched", () => {
    expect(validateJournalUpdate({ startedOn: "1994-06-01" })).toEqual([]);
    expect(validateJournalUpdate({ endedOn: "1994-03-01" })).toEqual([]);
  });

  it("accepts kind: 'archive' or null", () => {
    expect(validateJournalUpdate({ kind: "archive" })).toEqual([]);
    expect(validateJournalUpdate({ kind: null })).toEqual([]);
  });

  it("rejects any other kind value", () => {
    expect(validateJournalUpdate({ kind: "live" })).toContain(
      'kind must be "archive" or null',
    );
  });

  it("collects multiple problems from one patch", () => {
    const errors = validateJournalUpdate({ label: "", kind: "nope" });
    expect(errors).toContain("label is required");
    expect(errors).toContain('kind must be "archive" or null');
  });
});

describe("insertJournalSql", () => {
  it("inserts only the original five columns, parameterized", () => {
    const q = insertJournalSql(journal);
    expect(q.text).toBe(
      "INSERT INTO journals (id, label, notes, active, created_at) VALUES ($1, $2, $3, $4, $5)",
    );
    expect(q.values).toEqual(["01JRNL", "Red notebook 1994", null, false, "2026-07-16T10:00:00.000Z"]);
  });
});

describe("listJournalsSql", () => {
  it("lists active-first, then newest-first, selecting the full row", () => {
    const q = listJournalsSql();
    expect(q.text).toContain(
      "SELECT id, label, notes, active, created_at, started_on, ended_on, kind FROM journals",
    );
    expect(q.text).toContain("ORDER BY active DESC, created_at DESC");
    expect(q.values).toEqual([]);
  });
});

describe("getJournalSql", () => {
  it("selects one journal's full row by id", () => {
    const q = getJournalSql("01JRNL");
    expect(q.text).toBe(
      "SELECT id, label, notes, active, created_at, started_on, ended_on, kind FROM journals WHERE id = $1",
    );
    expect(q.values).toEqual(["01JRNL"]);
  });
});

describe("updateJournalSql", () => {
  it("builds a single-field SET + RETURNING the full row", () => {
    const q = updateJournalSql("01JRNL", { label: "New label" });
    expect(q.text).toBe(
      "UPDATE journals SET label = $2 WHERE id = $1 RETURNING id, label, notes, active, created_at, started_on, ended_on, kind",
    );
    expect(q.values).toEqual(["01JRNL", "New label"]);
  });

  it("trims the label like validateJournalInput/insertJournalSql do", () => {
    const q = updateJournalSql("01JRNL", { label: "  New label  " });
    expect(q.values).toEqual(["01JRNL", "New label"]);
  });

  it("builds a multi-field SET in a fixed column order regardless of patch key order", () => {
    const q = updateJournalSql("01JRNL", {
      kind: "archive",
      startedOn: "1994-03-01",
      label: "Red notebook",
    });
    expect(q.text).toBe(
      "UPDATE journals SET label = $2, started_on = $3, kind = $4 WHERE id = $1 RETURNING id, label, notes, active, created_at, started_on, ended_on, kind",
    );
    expect(q.values).toEqual(["01JRNL", "Red notebook", "1994-03-01", "archive"]);
  });

  it("passes null through for clearing a field", () => {
    const q = updateJournalSql("01JRNL", { notes: null, endedOn: null });
    expect(q.text).toBe(
      "UPDATE journals SET notes = $2, ended_on = $3 WHERE id = $1 RETURNING id, label, notes, active, created_at, started_on, ended_on, kind",
    );
    expect(q.values).toEqual(["01JRNL", null, null]);
  });
});

describe("countJournalEntriesSql", () => {
  it("counts total and trashed entries referencing the journal", () => {
    const q = countJournalEntriesSql("01JRNL");
    expect(q.text).toBe(
      "SELECT count(*)::int AS total, count(*) FILTER (WHERE deleted_at IS NOT NULL)::int AS trashed FROM entries WHERE journal_id = $1",
    );
    expect(q.values).toEqual(["01JRNL"]);
  });
});

describe("clearJournalMoveRefsSql", () => {
  it("nulls out just this journal's side of each entry_moves row", () => {
    const q = clearJournalMoveRefsSql("01JRNL");
    expect(q.text).toBe(
      "UPDATE entry_moves SET from_journal_id = CASE WHEN from_journal_id = $1 THEN NULL ELSE from_journal_id END, to_journal_id = CASE WHEN to_journal_id = $1 THEN NULL ELSE to_journal_id END WHERE from_journal_id = $1 OR to_journal_id = $1",
    );
    expect(q.values).toEqual(["01JRNL"]);
  });
});

describe("deleteJournalSql", () => {
  it("deletes by id, returning the id", () => {
    const q = deleteJournalSql("01JRNL");
    expect(q.text).toBe("DELETE FROM journals WHERE id = $1 RETURNING id");
    expect(q.values).toEqual(["01JRNL"]);
  });
});

describe("setActiveJournalSql", () => {
  it("activates one journal and deactivates the rest in a single atomic statement, touching no rows on an unknown id", () => {
    const q = setActiveJournalSql("01JRNL");
    expect(q.text).toBe(
      "UPDATE journals SET active = (id = $1) WHERE EXISTS (SELECT 1 FROM journals WHERE id = $1) RETURNING id",
    );
    expect(q.values).toEqual(["01JRNL"]);
  });
  it("null deactivates all", () => {
    const q = setActiveJournalSql(null);
    expect(q.text).toBe("UPDATE journals SET active = false WHERE active");
    expect(q.values).toEqual([]);
  });
});

describe("journalSummariesSql", () => {
  it("keeps the deleted_at filter in the JOIN condition, not WHERE, so empty journals still appear", () => {
    const q = journalSummariesSql();
    expect(q.text).toContain(
      "LEFT JOIN entries e ON e.journal_id = j.id AND e.deleted_at IS NULL",
    );
    expect(q.text).not.toContain("WHERE");
    expect(q.values).toEqual([]);
  });

  it("selects notes/startedOn/endedOn/kind alongside the existing columns", () => {
    const q = journalSummariesSql();
    expect(q.text).toContain(
      "SELECT j.id, j.label, j.notes, j.active, j.created_at, j.started_on, j.ended_on, j.kind,",
    );
    expect(q.text).toContain(
      "GROUP BY j.id, j.label, j.notes, j.active, j.created_at, j.started_on, j.ended_on, j.kind",
    );
  });

  it("aggregates count + effective-date min/max, grouped, ordered like listJournalsSql", () => {
    const q = journalSummariesSql();
    expect(q.text).toContain("count(e.id)::int AS entry_count");
    expect(q.text).toContain("min(coalesce(e.written_at, e.recorded_at)) AS first_at");
    expect(q.text).toContain("max(coalesce(e.written_at, e.recorded_at)) AS last_at");
    expect(q.text).toContain("ORDER BY j.active DESC, j.created_at DESC");
  });
});

describe("unfiledCountSql", () => {
  it("counts live unfiled entries only", () => {
    const q = unfiledCountSql();
    expect(q.text).toBe(
      "SELECT count(*)::int AS unfiled FROM entries WHERE journal_id IS NULL AND deleted_at IS NULL",
    );
    expect(q.values).toEqual([]);
  });
});

describe("rowToJournalSummary", () => {
  it("maps snake_case, coercing timestamps to ISO, dates to YYYY-MM-DD, and the count to a number", () => {
    expect(
      rowToJournalSummary({
        id: "01JRNL",
        label: "Red notebook 1994",
        notes: "college years",
        active: true,
        created_at: new Date("2026-07-16T10:00:00.000Z"),
        started_on: new Date("1994-03-02T00:00:00.000Z"),
        ended_on: "1995-06-01",
        kind: "archive",
        entry_count: "3",
        first_at: new Date("1994-03-02T00:00:00.000Z"),
        last_at: new Date("1995-06-01T00:00:00.000Z"),
      }),
    ).toEqual({
      id: "01JRNL",
      label: "Red notebook 1994",
      notes: "college years",
      active: true,
      createdAt: "2026-07-16T10:00:00.000Z",
      startedOn: "1994-03-02",
      endedOn: "1995-06-01",
      kind: "archive",
      entryCount: 3,
      firstEntryAt: "1994-03-02T00:00:00.000Z",
      lastEntryAt: "1995-06-01T00:00:00.000Z",
    });
  });

  it("maps a 0-count journal to null first/last dates and null notes/dates/kind", () => {
    const s = rowToJournalSummary({
      id: "01JRNL",
      label: "Empty notebook",
      notes: null,
      active: false,
      created_at: "2026-07-16T10:00:00.000Z",
      started_on: null,
      ended_on: null,
      kind: null,
      entry_count: 0,
      first_at: null,
      last_at: null,
    });
    expect(s.entryCount).toBe(0);
    expect(s.firstEntryAt).toBeNull();
    expect(s.lastEntryAt).toBeNull();
    expect(s.notes).toBeNull();
    expect(s.startedOn).toBeNull();
    expect(s.endedOn).toBeNull();
    expect(s.kind).toBeNull();
  });
});

describe("rowToJournal", () => {
  it("maps snake_case, coerces the timestamp to ISO, and dates to YYYY-MM-DD", () => {
    expect(
      rowToJournal({
        id: "01JRNL",
        label: "Red notebook 1994",
        notes: null,
        active: true,
        created_at: new Date("2026-07-16T10:00:00.000Z"),
        started_on: new Date("1994-03-01T00:00:00.000Z"),
        ended_on: null,
        kind: null,
      }),
    ).toEqual({
      id: "01JRNL",
      label: "Red notebook 1994",
      notes: null,
      active: true,
      createdAt: "2026-07-16T10:00:00.000Z",
      startedOn: "1994-03-01",
      endedOn: null,
      kind: null,
    });
  });
});
