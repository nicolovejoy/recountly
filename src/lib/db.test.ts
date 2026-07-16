import { describe, it, expect } from "vitest";
import {
  insertEntry,
  listEntries,
  searchEntries,
  getEntry,
  updateEntryEnrichment,
  listUnenriched,
  type QueryRunner,
} from "./db";
import type { EntryRecord, EntryEnrichment } from "./entry";
import type { EntryRow } from "./entry-sql";

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
