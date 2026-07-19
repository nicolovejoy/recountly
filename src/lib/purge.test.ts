import { describe, it, expect } from "vitest";
import { purgeTrashedEntry, emptyTrash } from "./purge";
import type { QueryRunner } from "./db";
import type { EntryRow } from "./entry-sql";
import type { DelFn } from "./blob";

// Routes each query by its SQL text and records everything (queries AND blob
// deletes) into one shared call log, so tests can assert cross-layer ordering:
// photos-delete before entry-delete, blob delete after both.
function fakePurgeDeps(opts: {
  entriesById?: Record<string, EntryRow>;
  photosByEntry?: Record<string, EntryRow[]>;
  trashed?: EntryRow[];
  delFails?: boolean;
  throwOnGetEntry?: string;
} = {}) {
  const calls: { op: string; values: unknown[] }[] = [];
  const runner: QueryRunner = {
    async query(text, values) {
      if (text.startsWith("DELETE FROM photos")) {
        calls.push({ op: "delete-photos", values });
        return [];
      }
      if (text.startsWith("DELETE FROM entries")) {
        calls.push({ op: "delete-entry", values });
        return [{ id: values[0] }];
      }
      if (text.includes("deleted_at IS NOT NULL")) {
        calls.push({ op: "list-trashed", values });
        return opts.trashed ?? [];
      }
      if (text.includes("FROM photos")) {
        calls.push({ op: "list-photos", values });
        return opts.photosByEntry?.[String(values[0])] ?? [];
      }
      calls.push({ op: "get-entry", values });
      if (opts.throwOnGetEntry === String(values[0])) throw new Error("db down");
      const row = opts.entriesById?.[String(values[0])];
      return row ? [row] : [];
    },
  };
  const delFn: DelFn = async (paths) => {
    calls.push({ op: "delete-blobs", values: [paths] });
    if (opts.delFails) throw new Error("blob store down");
  };
  return { runner, delFn, calls };
}

const trashedRow = (id: string, extra: Partial<EntryRow> = {}): EntryRow => ({
  id,
  recorded_at: "2026-06-13T01:00:00.000Z",
  created_at: "2026-06-13T01:00:05.000Z",
  updated_at: "2026-06-13T01:00:05.000Z",
  duration_seconds: 42,
  transcript: "hello",
  title: null,
  tags: [],
  audio_url: `/api/audio/${id}`,
  audio_mime: "audio/mp4",
  audio_bytes: 999,
  deleted_at: "2026-07-18T09:00:00.000Z",
  ...extra,
});

const photoRow = (id: string, entryId: string): EntryRow => ({
  id,
  entry_id: entryId,
  mime: "image/jpeg",
  bytes: 5,
  created_at: "2026-07-16T10:00:00.000Z",
});

describe("purgeTrashedEntry", () => {
  it("returns not_found for an unknown id without touching anything", async () => {
    const { runner, delFn, calls } = fakePurgeDeps();
    const out = await purgeTrashedEntry("nope", { runner, delFn });
    expect(out).toBe("not_found");
    expect(calls.map((c) => c.op)).toEqual(["get-entry"]);
  });

  it("returns not_trashed for a live entry and performs no deletes", async () => {
    const { runner, delFn, calls } = fakePurgeDeps({
      entriesById: { "01LIVE": trashedRow("01LIVE", { deleted_at: null }) },
    });
    const out = await purgeTrashedEntry("01LIVE", { runner, delFn });
    expect(out).toBe("not_trashed");
    expect(calls.map((c) => c.op)).toEqual(["get-entry"]);
  });

  it("purges a trashed entry: photo rows before the entry row, blobs (audio + photos) last", async () => {
    const { runner, delFn, calls } = fakePurgeDeps({
      entriesById: { "01ENTRY": trashedRow("01ENTRY") },
      photosByEntry: { "01ENTRY": [photoRow("01P1", "01ENTRY"), photoRow("01P2", "01ENTRY")] },
    });
    const out = await purgeTrashedEntry("01ENTRY", { runner, delFn });
    expect(out).toBe("purged");
    expect(calls.map((c) => c.op)).toEqual([
      "get-entry",
      "list-photos",
      "delete-photos",
      "delete-entry",
      "delete-blobs",
    ]);
    expect(calls[2].values).toEqual(["01ENTRY"]);
    expect(calls[3].values).toEqual(["01ENTRY"]);
    // Paths derived before the rows disappeared: audio by entry id/mime, photos by photo id/mime.
    expect(calls[4].values).toEqual([
      ["audio/01ENTRY.mp4", "photos/01P1.jpg", "photos/01P2.jpg"],
    ]);
  });

  it("still returns purged when the blob delete fails (best-effort)", async () => {
    const { runner, delFn, calls } = fakePurgeDeps({
      entriesById: { "01ENTRY": trashedRow("01ENTRY") },
      delFails: true,
    });
    const out = await purgeTrashedEntry("01ENTRY", { runner, delFn });
    expect(out).toBe("purged");
    expect(calls.map((c) => c.op)).toContain("delete-entry");
  });

  it("skips the blob delete entirely when the entry has no audio and no photos", async () => {
    const { runner, delFn, calls } = fakePurgeDeps({
      entriesById: {
        "01BARE": trashedRow("01BARE", { audio_url: null, audio_mime: null, audio_bytes: null }),
      },
    });
    const out = await purgeTrashedEntry("01BARE", { runner, delFn });
    expect(out).toBe("purged");
    expect(calls.map((c) => c.op)).toEqual([
      "get-entry",
      "list-photos",
      "delete-photos",
      "delete-entry",
    ]);
  });
});

describe("emptyTrash", () => {
  it("purges every trashed entry and returns the count", async () => {
    const a = trashedRow("01A");
    const b = trashedRow("01B", { audio_url: null, audio_mime: null, audio_bytes: null });
    const { runner, delFn, calls } = fakePurgeDeps({
      trashed: [a, b],
      entriesById: { "01A": a, "01B": b },
    });
    const out = await emptyTrash({ runner, delFn });
    expect(out).toBe(2);
    const entryDeletes = calls.filter((c) => c.op === "delete-entry");
    expect(entryDeletes.map((c) => c.values[0])).toEqual(["01A", "01B"]);
  });

  it("returns 0 on an already-empty trash without further queries", async () => {
    const { runner, delFn, calls } = fakePurgeDeps();
    expect(await emptyTrash({ runner, delFn })).toBe(0);
    expect(calls.map((c) => c.op)).toEqual(["list-trashed"]);
  });

  it("returns the partial count instead of throwing when a purge throws mid-loop", async () => {
    const a = trashedRow("01A");
    const boom = trashedRow("01BOOM");
    const c = trashedRow("01C");
    const { runner, delFn, calls } = fakePurgeDeps({
      trashed: [a, boom, c],
      entriesById: { "01A": a, "01BOOM": boom, "01C": c },
      throwOnGetEntry: "01BOOM",
    });
    expect(await emptyTrash({ runner, delFn })).toBe(1);
    // Loop stopped at the throw: 01C was never attempted.
    const entryDeletes = calls.filter((op) => op.op === "delete-entry");
    expect(entryDeletes.map((op) => op.values[0])).toEqual(["01A"]);
  });

  it("doesn't count an entry that vanished between list and purge", async () => {
    const a = trashedRow("01A");
    const gone = trashedRow("01GONE");
    const { runner, delFn } = fakePurgeDeps({
      trashed: [a, gone],
      entriesById: { "01A": a }, // 01GONE already purged elsewhere
    });
    expect(await emptyTrash({ runner, delFn })).toBe(1);
  });
});
