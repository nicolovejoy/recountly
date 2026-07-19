import { describe, it, expect } from "vitest";
import {
  validateJournalInput,
  insertJournalSql,
  listJournalsSql,
  getJournalSql,
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

describe("insertJournalSql", () => {
  it("inserts all five columns parameterized", () => {
    const q = insertJournalSql(journal);
    expect(q.text).toBe(
      "INSERT INTO journals (id, label, notes, active, created_at) VALUES ($1, $2, $3, $4, $5)",
    );
    expect(q.values).toEqual(["01JRNL", "Red notebook 1994", null, false, "2026-07-16T10:00:00.000Z"]);
  });
});

describe("listJournalsSql", () => {
  it("lists active-first, then newest-first", () => {
    const q = listJournalsSql();
    expect(q.text).toContain("ORDER BY active DESC, created_at DESC");
    expect(q.values).toEqual([]);
  });
});

describe("getJournalSql", () => {
  it("selects one journal by id", () => {
    const q = getJournalSql("01JRNL");
    expect(q.text).toBe(
      "SELECT id, label, notes, active, created_at FROM journals WHERE id = $1",
    );
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

  it("aggregates count + effective-date min/max, grouped, ordered like listJournalsSql", () => {
    const q = journalSummariesSql();
    expect(q.text).toContain("count(e.id)::int AS entry_count");
    expect(q.text).toContain("min(coalesce(e.written_at, e.recorded_at)) AS first_at");
    expect(q.text).toContain("max(coalesce(e.written_at, e.recorded_at)) AS last_at");
    expect(q.text).toContain("GROUP BY j.id, j.label, j.active, j.created_at");
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
  it("maps snake_case, coercing timestamps to ISO and the count to a number", () => {
    expect(
      rowToJournalSummary({
        id: "01JRNL",
        label: "Red notebook 1994",
        active: true,
        created_at: new Date("2026-07-16T10:00:00.000Z"),
        entry_count: "3",
        first_at: new Date("1994-03-02T00:00:00.000Z"),
        last_at: new Date("1995-06-01T00:00:00.000Z"),
      }),
    ).toEqual({
      id: "01JRNL",
      label: "Red notebook 1994",
      active: true,
      createdAt: "2026-07-16T10:00:00.000Z",
      entryCount: 3,
      firstEntryAt: "1994-03-02T00:00:00.000Z",
      lastEntryAt: "1995-06-01T00:00:00.000Z",
    });
  });

  it("maps a 0-count journal to null first/last dates", () => {
    const s = rowToJournalSummary({
      id: "01JRNL",
      label: "Empty notebook",
      active: false,
      created_at: "2026-07-16T10:00:00.000Z",
      entry_count: 0,
      first_at: null,
      last_at: null,
    });
    expect(s.entryCount).toBe(0);
    expect(s.firstEntryAt).toBeNull();
    expect(s.lastEntryAt).toBeNull();
  });
});

describe("rowToJournal", () => {
  it("maps snake_case and coerces the timestamp to ISO", () => {
    expect(
      rowToJournal({
        id: "01JRNL",
        label: "Red notebook 1994",
        notes: null,
        active: true,
        created_at: new Date("2026-07-16T10:00:00.000Z"),
      }),
    ).toEqual({
      id: "01JRNL",
      label: "Red notebook 1994",
      notes: null,
      active: true,
      createdAt: "2026-07-16T10:00:00.000Z",
    });
  });
});
