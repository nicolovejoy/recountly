import { describe, it, expect } from "vitest";
import {
  insertEntrySql,
  listEntriesSql,
  searchEntriesSql,
  getEntrySql,
  rowToEntry,
} from "./entry-sql";
import type { EntryRecord } from "./entry";

const rec: EntryRecord = {
  id: "01HXAMPLE0000000000000000",
  recordedAt: "2026-06-13T01:00:00.000Z",
  createdAt: "2026-06-13T01:00:05.000Z",
  updatedAt: "2026-06-13T01:00:05.000Z",
  durationSeconds: 42,
  transcript: "a walk and a thought",
  title: null,
  tags: [],
  audioUrl: "https://blob.example/x.webm",
  audioMime: "audio/webm",
  audioBytes: 12_345,
};

describe("insertEntrySql", () => {
  it("parameterizes all 11 columns in order", () => {
    const q = insertEntrySql(rec);
    expect(q.text).toMatch(/^INSERT INTO entries \(/);
    expect(q.text).toContain("VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)");
    expect(q.values).toEqual([
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
    ]);
  });

  it("never inlines user text into the SQL (injection-safe)", () => {
    const q = insertEntrySql({ ...rec, transcript: "'; DROP TABLE entries; --" });
    expect(q.text).not.toContain("DROP TABLE");
    expect(q.values).toContain("'; DROP TABLE entries; --");
  });
});

describe("listEntriesSql", () => {
  it("orders newest-first and parameterizes the limit", () => {
    const q = listEntriesSql(25);
    expect(q.text).toContain("ORDER BY recorded_at DESC");
    expect(q.text).toContain("LIMIT $1");
    expect(q.values).toEqual([25]);
  });

  it("defaults the limit to 50", () => {
    expect(listEntriesSql().values).toEqual([50]);
  });
});

describe("searchEntriesSql", () => {
  it("with no filters behaves like the newest-first list", () => {
    const q = searchEntriesSql();
    expect(q.text).not.toContain("WHERE");
    expect(q.text).toContain("ORDER BY recorded_at DESC");
    expect(q.text).toContain("LIMIT $1");
    expect(q.values).toEqual([50]);
  });

  it("ranks by relevance when a query is present, reusing one placeholder", () => {
    const q = searchEntriesSql({ query: "morning walk" });
    expect(q.text).toContain("transcript_tsv @@ websearch_to_tsquery('english', $1)");
    expect(q.text).toContain("ORDER BY ts_rank(transcript_tsv, websearch_to_tsquery('english', $1)) DESC");
    expect(q.text).toContain(", recorded_at DESC");
    expect(q.text).toContain("LIMIT $2");
    expect(q.values).toEqual(["morning walk", 50]);
  });

  it("ignores a blank/whitespace query", () => {
    const q = searchEntriesSql({ query: "   " });
    expect(q.text).not.toContain("websearch_to_tsquery");
    expect(q.values).toEqual([50]);
  });

  it("applies an inclusive date range (to covers the whole day)", () => {
    const q = searchEntriesSql({ from: "2026-06-01", to: "2026-06-13" });
    expect(q.text).toContain("recorded_at >= $1::date");
    expect(q.text).toContain("recorded_at < ($2::date + 1)");
    expect(q.text).toContain("LIMIT $3");
    expect(q.values).toEqual(["2026-06-01", "2026-06-13", 50]);
  });

  it("combines query + range with placeholders in order", () => {
    const q = searchEntriesSql({ query: "walk", from: "2026-06-01", to: "2026-06-13", limit: 20 });
    expect(q.values).toEqual(["walk", "2026-06-01", "2026-06-13", 20]);
    expect(q.text).toContain("websearch_to_tsquery('english', $1)");
    expect(q.text).toContain("recorded_at >= $2::date");
    expect(q.text).toContain("recorded_at < ($3::date + 1)");
    expect(q.text).toContain("LIMIT $4");
  });

  it("never inlines the user query into the SQL (injection-safe)", () => {
    const q = searchEntriesSql({ query: "'; DROP TABLE entries; --" });
    expect(q.text).not.toContain("DROP TABLE");
    expect(q.values).toContain("'; DROP TABLE entries; --");
  });
});

describe("getEntrySql", () => {
  it("filters by id via a placeholder", () => {
    const q = getEntrySql("abc");
    expect(q.text).toContain("WHERE id = $1");
    expect(q.values).toEqual(["abc"]);
  });
});

describe("rowToEntry", () => {
  it("maps a Date-typed row (node-postgres) to camelCase ISO strings", () => {
    const entry = rowToEntry({
      id: "01HX",
      recorded_at: new Date("2026-06-13T01:00:00.000Z"),
      created_at: new Date("2026-06-13T01:00:05.000Z"),
      updated_at: new Date("2026-06-13T01:00:05.000Z"),
      duration_seconds: 42,
      transcript: "hello",
      title: null,
      tags: ["a", "b"],
      audio_url: "https://blob/x.webm",
      audio_mime: "audio/webm",
      audio_bytes: 999,
    });
    expect(entry).toEqual({
      id: "01HX",
      recordedAt: "2026-06-13T01:00:00.000Z",
      createdAt: "2026-06-13T01:00:05.000Z",
      updatedAt: "2026-06-13T01:00:05.000Z",
      durationSeconds: 42,
      transcript: "hello",
      title: null,
      tags: ["a", "b"],
      audioUrl: "https://blob/x.webm",
      audioMime: "audio/webm",
      audioBytes: 999,
    });
  });

  it("accepts string timestamps (HTTP drivers) and null tags", () => {
    const entry = rowToEntry({
      id: "01HX",
      recorded_at: "2026-06-13T01:00:00.000Z",
      created_at: "2026-06-13T01:00:05.000Z",
      updated_at: "2026-06-13T01:00:05.000Z",
      duration_seconds: "42",
      transcript: "hello",
      title: "A title",
      tags: null,
      audio_url: "https://blob/x.webm",
      audio_mime: "audio/webm",
      audio_bytes: "999",
    });
    expect(entry.recordedAt).toBe("2026-06-13T01:00:00.000Z");
    expect(entry.durationSeconds).toBe(42);
    expect(entry.audioBytes).toBe(999);
    expect(entry.title).toBe("A title");
    expect(entry.tags).toEqual([]);
  });

  it("maps null audio columns to nulls (best-effort audio not saved)", () => {
    const entry = rowToEntry({
      id: "01HX",
      recorded_at: "2026-06-13T01:00:00.000Z",
      created_at: "2026-06-13T01:00:05.000Z",
      updated_at: "2026-06-13T01:00:05.000Z",
      duration_seconds: 10,
      transcript: "hello",
      title: null,
      tags: [],
      audio_url: null,
      audio_mime: null,
      audio_bytes: null,
    });
    expect(entry.audioUrl).toBeNull();
    expect(entry.audioMime).toBeNull();
    expect(entry.audioBytes).toBeNull();
  });
});
