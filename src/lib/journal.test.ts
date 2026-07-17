import { describe, it, expect } from "vitest";
import {
  validateJournalInput,
  insertJournalSql,
  listJournalsSql,
  setActiveJournalSql,
  rowToJournal,
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

describe("setActiveJournalSql", () => {
  it("activates one journal and deactivates the rest in a single statement", () => {
    const q = setActiveJournalSql("01JRNL");
    expect(q.text).toBe("UPDATE journals SET active = (id = $1)");
    expect(q.values).toEqual(["01JRNL"]);
  });
  it("null deactivates all", () => {
    const q = setActiveJournalSql(null);
    expect(q.text).toBe("UPDATE journals SET active = false WHERE active");
    expect(q.values).toEqual([]);
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
