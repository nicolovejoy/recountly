import { describe, it, expect } from "vitest";
import {
  insertEntrySql,
  listEntriesSql,
  searchEntriesSql,
  getEntrySql,
  deleteEntrySql,
  softDeleteEntrySql,
  listTrashedSql,
  restoreEntrySql,
  updateEnrichmentSql,
  listUnenrichedSql,
  rowToEntry,
} from "./entry-sql";
import type { EntryRecord, EntryEnrichment } from "./entry";

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
  audioComplete: true,
  journalId: null,
  writtenAt: null,
};

describe("insertEntrySql", () => {
  it("parameterizes all 17 columns in order", () => {
    const q = insertEntrySql(rec);
    expect(q.text).toMatch(/^INSERT INTO entries \(/);
    expect(q.text).toContain(
      "VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)",
    );
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
      rec.audioComplete,
      rec.summary,
      rec.enrichedAt,
      rec.enrichmentModel,
      rec.journalId,
      rec.writtenAt,
    ]);
  });

  it("never inlines user text into the SQL (injection-safe)", () => {
    const q = insertEntrySql({ ...rec, transcript: "'; DROP TABLE entries; --" });
    expect(q.text).not.toContain("DROP TABLE");
    expect(q.values).toContain("'; DROP TABLE entries; --");
  });
});

describe("listEntriesSql", () => {
  it("orders newest-first (effective date) and parameterizes the limit", () => {
    const q = listEntriesSql(25);
    expect(q.text).toContain("ORDER BY coalesce(written_at, recorded_at) DESC");
    expect(q.text).toContain("LIMIT $1");
    expect(q.values).toEqual([25]);
  });

  it("defaults the limit to 50", () => {
    expect(listEntriesSql().values).toEqual([50]);
  });

  it("excludes trashed entries", () => {
    const q = listEntriesSql();
    expect(q.text).toContain("WHERE deleted_at IS NULL");
  });

  it("includes a photo_count subselect", () => {
    const q = listEntriesSql();
    expect(q.text).toContain(
      "(SELECT count(*)::int FROM photos p WHERE p.entry_id = entries.id) AS photo_count",
    );
  });
});

describe("searchEntriesSql", () => {
  it("with no filters excludes trashed entries and behaves like the newest-first list", () => {
    const q = searchEntriesSql();
    expect(q.text).toContain("WHERE deleted_at IS NULL");
    expect(q.text).toContain("ORDER BY coalesce(written_at, recorded_at) DESC");
    expect(q.text).toContain("LIMIT $1");
    expect(q.values).toEqual([50]);
  });

  it("always excludes trashed entries alongside other filters", () => {
    const q = searchEntriesSql({ query: "walk", journalId: "01JRNL" });
    expect(q.text).toContain("deleted_at IS NULL");
    // No placeholder is consumed by the exclusion — the query text placeholder stays $1.
    expect(q.values).toEqual(["walk", "01JRNL", 50]);
  });

  it("includes a photo_count subselect", () => {
    const q = searchEntriesSql();
    expect(q.text).toContain(
      "(SELECT count(*)::int FROM photos p WHERE p.entry_id = entries.id) AS photo_count",
    );
  });

  it("ranks by relevance when a query is present, reusing one placeholder", () => {
    const q = searchEntriesSql({ query: "morning walk" });
    expect(q.text).toContain("transcript_tsv @@ websearch_to_tsquery('english', $1)");
    expect(q.text).toContain("ORDER BY ts_rank(transcript_tsv, websearch_to_tsquery('english', $1)) DESC");
    expect(q.text).toContain(", coalesce(written_at, recorded_at) DESC");
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
    expect(q.text).toContain("coalesce(written_at, recorded_at) >= $1::date");
    expect(q.text).toContain("coalesce(written_at, recorded_at) < ($2::date + 1)");
    expect(q.text).toContain("LIMIT $3");
    expect(q.values).toEqual(["2026-06-01", "2026-06-13", 50]);
  });

  it("combines query + range with placeholders in order", () => {
    const q = searchEntriesSql({ query: "walk", from: "2026-06-01", to: "2026-06-13", limit: 20 });
    expect(q.values).toEqual(["walk", "2026-06-01", "2026-06-13", 20]);
    expect(q.text).toContain("websearch_to_tsquery('english', $1)");
    expect(q.text).toContain("coalesce(written_at, recorded_at) >= $2::date");
    expect(q.text).toContain("coalesce(written_at, recorded_at) < ($3::date + 1)");
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

  it("selects deleted_at so callers (purge) can tell trashed from live", () => {
    const q = getEntrySql("abc");
    expect(q.text).toContain("deleted_at");
  });
});

describe("deleteEntrySql", () => {
  it("deletes by id, returning the id", () => {
    const q = deleteEntrySql("abc");
    expect(q.text).toBe("DELETE FROM entries WHERE id = $1 RETURNING id");
    expect(q.values).toEqual(["abc"]);
  });
});

describe("softDeleteEntrySql", () => {
  it("marks the entry trashed (deleted_at + updated_at = now), returning the id", () => {
    const q = softDeleteEntrySql("abc");
    expect(q.text).toBe(
      "UPDATE entries SET deleted_at = now(), updated_at = now() WHERE id = $1 AND deleted_at IS NULL RETURNING id",
    );
    expect(q.values).toEqual(["abc"]);
  });
});

describe("listTrashedSql", () => {
  it("selects only trashed rows, newest-trashed first, with a parameterized limit", () => {
    const q = listTrashedSql(25);
    expect(q.text).toContain("WHERE deleted_at IS NOT NULL");
    expect(q.text).toContain("ORDER BY deleted_at DESC");
    expect(q.text).toContain("LIMIT $1");
    expect(q.values).toEqual([25]);
  });

  it("defaults the limit to 50", () => {
    expect(listTrashedSql().values).toEqual([50]);
  });

  it("selects deleted_at alongside the shared column list", () => {
    const q = listTrashedSql();
    expect(q.text).toContain(", deleted_at,");
  });

  it("includes a photo_count subselect", () => {
    const q = listTrashedSql();
    expect(q.text).toContain(
      "(SELECT count(*)::int FROM photos p WHERE p.entry_id = entries.id) AS photo_count",
    );
  });
});

describe("restoreEntrySql", () => {
  it("un-trashes the entry (clears deleted_at, bumps updated_at), returning the id", () => {
    const q = restoreEntrySql("abc");
    expect(q.text).toBe(
      "UPDATE entries SET deleted_at = NULL, updated_at = now() WHERE id = $1 AND deleted_at IS NOT NULL RETURNING id",
    );
    expect(q.values).toEqual(["abc"]);
  });
});

describe("updateEnrichmentSql", () => {
  const enrichment: EntryEnrichment = {
    title: "A Morning Walk",
    tags: ["walk", "reflection"],
    summary: "Walked and reflected.",
    model: "claude-haiku-4-5",
  };

  it("updates the enrichment columns + updated_at, filtered by id", () => {
    const q = updateEnrichmentSql("01HX", enrichment, "2026-06-25T12:00:00.000Z");
    expect(q.text).toMatch(/^UPDATE entries SET/);
    expect(q.text).toContain("title = $1");
    expect(q.text).toContain("tags = $2");
    expect(q.text).toContain("summary = $3");
    expect(q.text).toContain("enriched_at = $4");
    expect(q.text).toContain("enrichment_model = $5");
    expect(q.text).toContain("updated_at = $6");
    expect(q.text).toContain("WHERE id = $7");
    expect(q.values).toEqual([
      "A Morning Walk",
      ["walk", "reflection"],
      "Walked and reflected.",
      "2026-06-25T12:00:00.000Z",
      "claude-haiku-4-5",
      "2026-06-25T12:00:00.000Z",
      "01HX",
    ]);
  });
});

describe("listUnenrichedSql", () => {
  it("selects never-enriched rows newest-first with a limit", () => {
    const q = listUnenrichedSql(10);
    expect(q.text).toContain("WHERE enriched_at IS NULL");
    expect(q.text).toContain("ORDER BY recorded_at DESC");
    expect(q.text).toContain("LIMIT $1");
    expect(q.values).toEqual([10]);
  });

  it("excludes trashed entries (don't enrich trash)", () => {
    const q = listUnenrichedSql();
    expect(q.text).toContain("deleted_at IS NULL");
  });

  it("defaults the limit to 50", () => {
    expect(listUnenrichedSql().values).toEqual([50]);
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
      audio_complete: true,
      summary: "A short reflection.",
      enriched_at: new Date("2026-06-13T02:00:00.000Z"),
      enrichment_model: "claude-haiku-4-5",
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
      summary: "A short reflection.",
      enrichedAt: "2026-06-13T02:00:00.000Z",
      enrichmentModel: "claude-haiku-4-5",
      audioUrl: "https://blob/x.webm",
      audioMime: "audio/webm",
      audioBytes: 999,
      audioComplete: true,
      journalId: null,
      writtenAt: null,
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
    expect(entry.audioComplete).toBeNull();
  });

  it("maps a false audio_complete (partial audio after a pause)", () => {
    const entry = rowToEntry({
      id: "01HX",
      recorded_at: "2026-06-13T01:00:00.000Z",
      created_at: "2026-06-13T01:00:05.000Z",
      updated_at: "2026-06-13T01:00:05.000Z",
      duration_seconds: 10,
      transcript: "hello",
      title: null,
      tags: [],
      audio_url: "https://blob/x.webm",
      audio_mime: "audio/webm",
      audio_bytes: 999,
      audio_complete: false,
    });
    expect(entry.audioComplete).toBe(false);
  });

  it("maps photo_count when present", () => {
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
      photo_count: 3,
    });
    expect(entry.photoCount).toBe(3);
  });

  it("leaves photoCount undefined when the column is absent (getEntrySql/insert rows)", () => {
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
    expect(entry.photoCount).toBeUndefined();
  });

  it("maps deleted_at when present (trashed row) and leaves it undefined otherwise", () => {
    const base = {
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
    };
    const trashed = rowToEntry({ ...base, deleted_at: new Date("2026-07-18T09:00:00.000Z") });
    expect(trashed.deletedAt).toBe("2026-07-18T09:00:00.000Z");
    const live = rowToEntry({ ...base, deleted_at: null });
    expect(live.deletedAt).toBeUndefined();
    const absent = rowToEntry(base);
    expect(absent.deletedAt).toBeUndefined();
  });
});

describe("journal archive columns", () => {
  const baseRow = {
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
  };

  it("insertEntrySql carries journal_id and written_at as $16/$17", () => {
    const journalRec: EntryRecord = {
      ...rec,
      journalId: "01JRNL",
      writtenAt: "1994-03-02T00:00:00.000Z",
    };
    const q = insertEntrySql(journalRec);
    expect(q.text).toContain("journal_id, written_at");
    expect(q.values).toHaveLength(17);
    expect(q.values[15]).toBe("01JRNL");
    expect(q.values[16]).toBe("1994-03-02T00:00:00.000Z");
  });

  it("rowToEntry maps journal_id/written_at, defaulting to null", () => {
    const withNulls = rowToEntry({ ...baseRow });
    expect(withNulls.journalId).toBeNull();
    expect(withNulls.writtenAt).toBeNull();
    const withValues = rowToEntry({
      ...baseRow,
      journal_id: "01JRNL",
      written_at: new Date("1994-03-02T00:00:00.000Z"),
    });
    expect(withValues.journalId).toBe("01JRNL");
    expect(withValues.writtenAt).toBe("1994-03-02T00:00:00.000Z");
  });
});

describe("searchEntriesSql effective-date + journal filter", () => {
  it("orders by coalesce(written_at, recorded_at) DESC when unranked", () => {
    const q = searchEntriesSql({});
    expect(q.text).toContain("ORDER BY coalesce(written_at, recorded_at) DESC");
  });

  it("applies date bounds to the effective date", () => {
    const q = searchEntriesSql({ from: "1994-01-01", to: "1994-12-31" });
    expect(q.text).toContain("coalesce(written_at, recorded_at) >= $1::date");
    expect(q.text).toContain("coalesce(written_at, recorded_at) < ($2::date + 1)");
  });

  it("filters by journalId", () => {
    const q = searchEntriesSql({ journalId: "01JRNL" });
    expect(q.text).toContain("journal_id = $1");
    expect(q.values[0]).toBe("01JRNL");
  });

  it("combines query + journal + dates with sequential placeholders", () => {
    const q = searchEntriesSql({ query: "cabin", journalId: "01JRNL", from: "1994-01-01" });
    expect(q.values).toEqual(["cabin", "01JRNL", "1994-01-01", 50]);
  });
});

describe("searchEntriesSql reading order + unfiled (issue #29)", () => {
  it("sort: 'reading' orders oldest-effective-first with a recorded_at tiebreak", () => {
    const q = searchEntriesSql({ journalId: "01JRNL", sort: "reading", limit: 200 });
    expect(q.text).toContain(
      "ORDER BY coalesce(written_at, recorded_at) ASC, recorded_at ASC",
    );
    expect(q.values).toEqual(["01JRNL", 200]);
  });

  it("sort: 'reading' overrides the rank expression even when a query is set", () => {
    const q = searchEntriesSql({ query: "cabin", sort: "reading" });
    expect(q.text).toContain("transcript_tsv @@ websearch_to_tsquery('english', $1)");
    expect(q.text).not.toContain("ts_rank");
    expect(q.text).toContain(
      "ORDER BY coalesce(written_at, recorded_at) ASC, recorded_at ASC",
    );
    expect(q.values).toEqual(["cabin", 50]);
  });

  it("absent and 'newest' sort produce the existing SQL byte-for-byte", () => {
    expect(searchEntriesSql({ sort: "newest" })).toEqual(searchEntriesSql({}));
    expect(searchEntriesSql({ query: "walk", sort: "newest" })).toEqual(
      searchEntriesSql({ query: "walk" }),
    );
  });

  it("keeps placeholders sequential with journalId + dates in reading order", () => {
    const q = searchEntriesSql({
      journalId: "01JRNL",
      from: "1994-01-01",
      to: "1994-12-31",
      sort: "reading",
    });
    expect(q.text).toContain("journal_id = $1");
    expect(q.text).toContain("coalesce(written_at, recorded_at) >= $2::date");
    expect(q.text).toContain("coalesce(written_at, recorded_at) < ($3::date + 1)");
    expect(q.text).toContain("LIMIT $4");
    expect(q.values).toEqual(["01JRNL", "1994-01-01", "1994-12-31", 50]);
  });

  it("unfiled adds a bare journal_id IS NULL clause without consuming a placeholder", () => {
    const q = searchEntriesSql({ unfiled: true });
    expect(q.text).toContain("journal_id IS NULL");
    expect(q.text).toContain("LIMIT $1");
    expect(q.values).toEqual([50]);
  });

  it("journalId wins over unfiled when both are set", () => {
    const q = searchEntriesSql({ unfiled: true, journalId: "01JRNL" });
    expect(q.text).not.toContain("journal_id IS NULL");
    expect(q.text).toContain("journal_id = $1");
    expect(q.values).toEqual(["01JRNL", 50]);
  });
});
