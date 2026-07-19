import { describe, it, expect } from "vitest";
import {
  insertEntry,
  listEntries,
  searchEntries,
  getEntry,
  deleteEntry,
  updateEntryEnrichment,
  listUnenriched,
  insertJournal,
  listJournals,
  getJournal,
  setActiveJournal,
  insertPhoto,
  listPhotosByEntry,
  getPhoto,
  deletePhotosByEntry,
  type QueryRunner,
} from "./db";
import type { EntryRecord, EntryEnrichment } from "./entry";
import type { EntryRow } from "./entry-sql";
import type { JournalRecord } from "./journal";
import type { PhotoRecord } from "./photo";

const rec: EntryRecord = {
  id: "01HXAMPLE0000000000000000",
  recordedAt: "2026-06-13T01:00:00.000Z",
  createdAt: "2026-06-13T01:00:05.000Z",
  updatedAt: "2026-06-13T01:00:05.000Z",
  durationSeconds: 42,
  transcript: "a walk and a thought",
  title: null,
  tags: [],
  summary: null,
  enrichedAt: null,
  enrichmentModel: null,
  audioUrl: "https://blob.example/x.webm",
  audioMime: "audio/webm",
  audioBytes: 12_345,
  audioComplete: null,
  journalId: null,
  writtenAt: null,
};

// Records every query and replays a canned result set — no live DB needed.
function fakeRunner(rows: EntryRow[] = []) {
  const calls: { text: string; values: unknown[] }[] = [];
  const runner: QueryRunner = {
    async query(text, values) {
      calls.push({ text, values });
      return rows;
    },
  };
  return { runner, calls };
}

const sampleRow: EntryRow = {
  id: "01HX",
  recorded_at: "2026-06-13T01:00:00.000Z",
  created_at: "2026-06-13T01:00:05.000Z",
  updated_at: "2026-06-13T01:00:05.000Z",
  duration_seconds: 42,
  transcript: "hello",
  title: null,
  tags: ["a"],
  audio_url: "https://blob/x.webm",
  audio_mime: "audio/webm",
  audio_bytes: 999,
};

describe("insertEntry", () => {
  it("runs a parameterized INSERT carrying the record's values, returns the record", async () => {
    const { runner, calls } = fakeRunner();
    const out = await insertEntry(rec, runner);
    expect(calls).toHaveLength(1);
    expect(calls[0].text).toMatch(/^INSERT INTO entries \(/);
    expect(calls[0].values).toContain(rec.id);
    expect(calls[0].values).toContain(rec.transcript);
    expect(out).toBe(rec);
  });
});

describe("listEntries", () => {
  it("runs the newest-first SELECT and maps rows to EntryRecords", async () => {
    const { runner, calls } = fakeRunner([sampleRow]);
    const out = await listEntries(10, runner);
    expect(calls[0].text).toContain("ORDER BY coalesce(written_at, recorded_at) DESC");
    expect(calls[0].values).toEqual([10]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ id: "01HX", transcript: "hello", tags: ["a"] });
  });

  it("defaults the limit to 50", async () => {
    const { runner, calls } = fakeRunner([]);
    await listEntries(undefined, runner);
    expect(calls[0].values).toEqual([50]);
  });
});

describe("searchEntries", () => {
  it("runs the full-text + range query and maps rows", async () => {
    const { runner, calls } = fakeRunner([sampleRow]);
    const out = await searchEntries({ query: "walk", from: "2026-06-01" }, runner);
    expect(calls[0].text).toContain("websearch_to_tsquery('english', $1)");
    expect(calls[0].values).toEqual(["walk", "2026-06-01", 50]);
    expect(out[0]).toMatchObject({ id: "01HX" });
  });

  it("with no filters falls back to the newest-first list", async () => {
    const { runner, calls } = fakeRunner([]);
    await searchEntries({}, runner);
    expect(calls[0].text).toContain("ORDER BY coalesce(written_at, recorded_at) DESC");
    expect(calls[0].values).toEqual([50]);
  });
});

describe("getEntry", () => {
  it("returns a mapped entry when a row exists", async () => {
    const { runner } = fakeRunner([sampleRow]);
    const out = await getEntry("01HX", runner);
    expect(out?.id).toBe("01HX");
  });

  it("returns null when no row matches", async () => {
    const { runner } = fakeRunner([]);
    expect(await getEntry("nope", runner)).toBeNull();
  });
});

describe("deleteEntry", () => {
  it("returns true when a row was deleted", async () => {
    const { runner, calls } = fakeRunner([{ id: "01HX" }]);
    const out = await deleteEntry("01HX", runner);
    expect(calls[0].text).toBe("DELETE FROM entries WHERE id = $1 RETURNING id");
    expect(calls[0].values).toEqual(["01HX"]);
    expect(out).toBe(true);
  });

  it("returns false when no row matched", async () => {
    const { runner } = fakeRunner([]);
    expect(await deleteEntry("nope", runner)).toBe(false);
  });
});

describe("updateEntryEnrichment", () => {
  it("runs a parameterized UPDATE carrying the enrichment + id", async () => {
    const { runner, calls } = fakeRunner();
    const enrichment: EntryEnrichment = {
      title: "Walk",
      tags: ["walk"],
      summary: "A walk.",
      model: "claude-haiku-4-5",
    };
    await updateEntryEnrichment("01HX", enrichment, "2026-06-25T12:00:00.000Z", runner);
    expect(calls).toHaveLength(1);
    expect(calls[0].text).toMatch(/^UPDATE entries SET/);
    expect(calls[0].values).toContain("01HX");
    expect(calls[0].values).toContain("Walk");
    expect(calls[0].values).toContain("claude-haiku-4-5");
  });
});

describe("listUnenriched", () => {
  it("runs the unenriched SELECT and maps rows", async () => {
    const { runner, calls } = fakeRunner([sampleRow]);
    const out = await listUnenriched(5, runner);
    expect(calls[0].text).toContain("WHERE enriched_at IS NULL");
    expect(calls[0].values).toEqual([5]);
    expect(out[0]).toMatchObject({ id: "01HX" });
  });

  it("defaults the limit to 50", async () => {
    const { runner, calls } = fakeRunner([]);
    await listUnenriched(undefined, runner);
    expect(calls[0].values).toEqual([50]);
  });
});

describe("journal data access", () => {
  const j: JournalRecord = {
    id: "01JRNL",
    label: "Red notebook 1994",
    notes: null,
    active: false,
    createdAt: "2026-07-16T10:00:00.000Z",
  };

  it("insertJournal runs the parameterized INSERT", async () => {
    const { runner, calls } = fakeRunner();
    await insertJournal(j, runner);
    expect(calls[0].text).toContain("INSERT INTO journals");
    expect(calls[0].values[0]).toBe("01JRNL");
  });

  it("listJournals maps rows to JournalRecords", async () => {
    const { runner } = fakeRunner([
      { id: "01JRNL", label: "Red", notes: null, active: true, created_at: "2026-07-16T10:00:00.000Z" },
    ]);
    const out = await listJournals(runner);
    expect(out).toEqual([
      { id: "01JRNL", label: "Red", notes: null, active: true, createdAt: "2026-07-16T10:00:00.000Z" },
    ]);
  });

  it("setActiveJournal runs the single-statement toggle and returns true when the id matched", async () => {
    const { runner, calls } = fakeRunner([{ id: "01JRNL" }]);
    const ok = await setActiveJournal("01JRNL", runner);
    expect(calls[0].text).toContain("UPDATE journals SET active = (id = $1)");
    expect(ok).toBe(true);
  });

  it("setActiveJournal returns false when no journal matched the id", async () => {
    const { runner } = fakeRunner([]);
    expect(await setActiveJournal("nope", runner)).toBe(false);
  });

  it("setActiveJournal(null) always returns true (clearing the lock has nothing to 404 on)", async () => {
    const { runner } = fakeRunner([]);
    expect(await setActiveJournal(null, runner)).toBe(true);
  });

  it("getJournal returns a mapped journal when a row exists", async () => {
    const { runner } = fakeRunner([
      { id: "01JRNL", label: "Red", notes: null, active: true, created_at: "2026-07-16T10:00:00.000Z" },
    ]);
    expect(await getJournal("01JRNL", runner)).toEqual({
      id: "01JRNL",
      label: "Red",
      notes: null,
      active: true,
      createdAt: "2026-07-16T10:00:00.000Z",
    });
  });

  it("getJournal returns null when no row matches", async () => {
    const { runner } = fakeRunner([]);
    expect(await getJournal("nope", runner)).toBeNull();
  });
});

describe("photo data access", () => {
  const p: PhotoRecord = {
    id: "01PHOTO",
    entryId: "01ENTRY",
    mime: "image/jpeg",
    bytes: 5,
    createdAt: "2026-07-16T10:00:00.000Z",
  };
  const row = {
    id: "01PHOTO",
    entry_id: "01ENTRY",
    mime: "image/jpeg",
    bytes: 5,
    created_at: "2026-07-16T10:00:00.000Z",
  };

  it("insertPhoto runs the parameterized INSERT", async () => {
    const { runner, calls } = fakeRunner();
    await insertPhoto(p, runner);
    expect(calls[0].text).toContain("INSERT INTO photos");
    expect(calls[0].values[0]).toBe("01PHOTO");
  });

  it("listPhotosByEntry maps rows", async () => {
    const { runner } = fakeRunner([row]);
    expect(await listPhotosByEntry("01ENTRY", runner)).toEqual([p]);
  });

  it("getPhoto returns null when absent", async () => {
    const { runner } = fakeRunner([]);
    expect(await getPhoto("01PHOTO", runner)).toBeNull();
  });

  it("deletePhotosByEntry runs the parameterized DELETE", async () => {
    const { runner, calls } = fakeRunner();
    await deletePhotosByEntry("01ENTRY", runner);
    expect(calls[0].text).toBe("DELETE FROM photos WHERE entry_id = $1");
    expect(calls[0].values).toEqual(["01ENTRY"]);
  });
});
