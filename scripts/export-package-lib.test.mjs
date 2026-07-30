import { describe, it, expect } from "vitest";
import {
  sha256Hex,
  sha256Prefixed,
  toIso,
  toDateOnly,
  audioStorageExt,
  audioStoragePath,
  audioExportExt,
  imageExt,
  photoStoragePath,
  kindToNative,
  titleField,
  writtenPrecisionFor,
  mapJournal,
  mapEntryMove,
  mapEntry,
  buildManifest,
  EXPORT_SCHEMA_VERSION,
} from "./export-package-lib.mjs";

describe("sha256", () => {
  it("matches known digests", () => {
    // Well-known SHA-256 test vectors.
    expect(sha256Hex(Buffer.from(""))).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
    expect(sha256Hex(Buffer.from("abc"))).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("prefixes with sha256:", () => {
    expect(sha256Prefixed(Buffer.from("abc"))).toBe(
      "sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
});

describe("toIso / toDateOnly", () => {
  it("normalizes a Date and an ISO-ish string to canonical UTC Z", () => {
    expect(toIso(new Date("2026-07-20T18:04:00Z"))).toBe("2026-07-20T18:04:00.000Z");
    expect(toIso("2026-07-20 18:04:00+00")).toBe("2026-07-20T18:04:00.000Z");
  });
  it("passes an unparseable string through and null through", () => {
    expect(toIso(null)).toBeNull();
    expect(toIso("not-a-date")).toBe("not-a-date");
  });
  it("date-only from Date and string", () => {
    expect(toDateOnly(new Date("1998-06-01T12:00:00Z"))).toBe("1998-06-01");
    expect(toDateOnly("1998-06-01")).toBe("1998-06-01");
    expect(toDateOnly(null)).toBeNull();
  });
});

describe("blob paths + export ext", () => {
  it("storage ext mirrors src/lib/blob.ts (mp4 stays .mp4)", () => {
    expect(audioStorageExt("audio/mp4")).toBe("mp4");
    expect(audioStorageExt("audio/webm;codecs=opus")).toBe("webm");
    expect(audioStoragePath("abc", "audio/mp4")).toBe("audio/abc.mp4");
  });
  it("export ext maps audio/mp4 to the native m4a name, else honest ext", () => {
    expect(audioExportExt("audio/mp4")).toBe("m4a");
    expect(audioExportExt("audio/webm;codecs=opus")).toBe("webm");
    expect(audioExportExt("audio/mpeg")).toBe("mp3");
  });
  it("image ext + photo path", () => {
    expect(imageExt("image/jpeg")).toBe("jpg");
    expect(imageExt("image/png")).toBe("png");
    expect(photoStoragePath("pid", "image/jpeg")).toBe("photos/pid.jpg");
  });
});

describe("journal mapping", () => {
  it("maps kind and drops isActive", () => {
    expect(kindToNative("archive")).toBe("paperArchive");
    expect(kindToNative(null)).toBe("contemporary");
    const j = mapJournal({
      id: "j1",
      label: "Blue notebook",
      notes: null,
      active: true,
      created_at: "2026-07-16T00:00:00Z",
      started_on: "1998-06-01",
      ended_on: "1999-01-01",
      kind: "archive",
    });
    expect(j).toEqual({
      id: "j1",
      label: "Blue notebook",
      notes: null,
      kind: "paperArchive",
      startedOn: "1998-06-01",
      endedOn: "1999-01-01",
      coverPhotoId: null,
      createdAt: "2026-07-16T00:00:00.000Z",
    });
    expect(j).not.toHaveProperty("active");
    expect(j).not.toHaveProperty("isActive");
  });
});

describe("entry_moves archive mapping", () => {
  it("camelCases and preserves nulls", () => {
    expect(
      mapEntryMove({
        id: 7,
        entry_id: "e1",
        from_journal_id: null,
        to_journal_id: "j2",
        moved_at: "2026-07-19T00:00:00Z",
      }),
    ).toEqual({
      id: 7,
      entryId: "e1",
      fromJournalId: null,
      toJournalId: "j2",
      movedAt: "2026-07-19T00:00:00.000Z",
    });
  });
});

describe("title split heuristic", () => {
  it("enriched title → generated", () => {
    expect(titleField({ title: "A Day", enriched_at: "2026-06-25T00:00:00Z" })).toEqual({
      value: "A Day",
      source: "generated",
    });
  });
  it("title without enrichment → user", () => {
    expect(titleField({ title: "My edit", enriched_at: null })).toEqual({
      value: "My edit",
      source: "user",
    });
  });
  it("no title → null/null", () => {
    expect(titleField({ title: null, enriched_at: null })).toEqual({
      value: null,
      source: null,
    });
  });
});

describe("writtenPrecisionFor", () => {
  it("day when written_at present, null otherwise", () => {
    expect(writtenPrecisionFor({ written_at: "1998-06-01T12:00:00Z" })).toBe("day");
    expect(writtenPrecisionFor({ written_at: null })).toBeNull();
  });
});

// A representative enriched spoken entry with audio + one photo.
const ENRICHED_ROW = {
  id: "01JABCDEF",
  recorded_at: "2026-07-20T18:04:00Z",
  created_at: "2026-07-20T18:05:00Z",
  updated_at: "2026-07-20T18:05:00Z",
  duration_seconds: 62,
  transcript: "Hello world.",
  title: "A short day",
  tags: ["reflection", "morning"],
  summary: "The speaker reflects.",
  enriched_at: "2026-07-20T18:06:00Z",
  enrichment_model: "claude-haiku-4-5",
  audio_url: "/api/audio/01JABCDEF",
  audio_mime: "audio/mp4",
  audio_bytes: 501234,
  audio_complete: true,
  journal_id: null,
  written_at: null,
  page_label: null,
  deleted_at: null,
  notes: null,
  location: "home",
};

describe("mapEntry", () => {
  it("maps an enriched spoken entry with audio + photo", () => {
    const e = mapEntry(ENRICHED_ROW, {
      transcript: { sha256: "sha256:tt" },
      audio: {
        file: "audio.m4a",
        mime: "audio/mp4",
        bytes: 501234,
        sha256: "sha256:aa",
        durationSeconds: 62,
        complete: true,
      },
      photos: [
        { file: "photos/p1.jpg", id: "p1", mime: "image/jpeg", bytes: 98765, sha256: "sha256:pp" },
      ],
      exportSource: "neon-export-2026-07-29",
    });

    expect(e.schemaVersion).toBe(EXPORT_SCHEMA_VERSION);
    expect(e.id).toBe("01JABCDEF");
    expect(e.spokenAt).toBe("2026-07-20T18:04:00.000Z");
    expect(e.originalWrittenAt).toBeNull();
    expect(e.writtenPrecision).toBeNull();
    expect(e.effectiveAt).toBe("2026-07-20T18:04:00.000Z");
    expect(e.status).toBe("active");
    expect(e.trashedAt).toBeNull();
    expect(e.location).toBe("home");
    expect(e.title).toEqual({ value: "A short day", source: "generated" });
    expect(e.tags).toEqual(["reflection", "morning"]);
    expect(e.summary).toBe("The speaker reflects.");
    expect(e.enrichment).toEqual({
      model: "claude-haiku-4-5",
      enrichedAt: "2026-07-20T18:06:00.000Z",
      title: "A short day",
      summary: "The speaker reflects.",
      tags: ["reflection", "morning"],
    });
    expect(e.transcript).toEqual({
      file: "transcript.md",
      sha256: "sha256:tt",
      source: "import",
      lastUserEditedAt: null,
      lastGeneratedAt: null,
    });
    expect(e.audio).toHaveLength(1);
    expect(e.audio[0]).toEqual({
      file: "audio.m4a",
      segmentIndex: 0,
      startTime: 0,
      durationSeconds: 62,
      mime: "audio/mp4",
      bytes: 501234,
      sha256: "sha256:aa",
      complete: true,
    });
    expect(e.photos).toEqual([
      { file: "photos/p1.jpg", id: "p1", mime: "image/jpeg", bytes: 98765, sha256: "sha256:pp" },
    ]);
    expect(e.legacy).toEqual({ webId: "01JABCDEF", source: "neon-export-2026-07-29" });
  });

  it("no audio → empty audio[]; no enrichment → null; trashed → status/trashedAt", () => {
    const row = {
      id: "imp_2024_JUL_28_08.46",
      recorded_at: "2024-07-28T08:46:00Z",
      created_at: "2024-07-28T08:46:00Z",
      updated_at: "2024-07-28T08:46:00Z",
      duration_seconds: 0,
      transcript: "Paper page read aloud.",
      title: "User picked this",
      tags: [],
      summary: null,
      enriched_at: null,
      enrichment_model: null,
      audio_url: null,
      audio_mime: null,
      audio_bytes: null,
      audio_complete: null,
      journal_id: "j1",
      written_at: null,
      page_label: "pp. 14–16",
      deleted_at: "2026-07-19T00:00:00Z",
      notes: "a note",
      location: null,
    };
    const e = mapEntry(row, {
      transcript: { sha256: "sha256:tt" },
      audio: null,
      photos: [],
      exportSource: "neon-export-2026-07-29",
    });
    expect(e.id).toBe("imp_2024_JUL_28_08.46"); // imp_ id kept verbatim
    expect(e.audio).toEqual([]);
    expect(e.enrichment).toBeNull();
    expect(e.title).toEqual({ value: "User picked this", source: "user" });
    expect(e.status).toBe("trashed");
    expect(e.trashedAt).toBe("2026-07-19T00:00:00.000Z");
    expect(e.pageLabel).toBe("pp. 14–16");
    expect(e.journalId).toBe("j1");
    expect(e.notes).toBe("a note");
    expect(e.location).toBeNull();
    expect(e.legacy.webId).toBe("imp_2024_JUL_28_08.46");
  });

  it("carries partial-audio complete=false honestly", () => {
    const e = mapEntry(
      { ...ENRICHED_ROW, audio_complete: false },
      {
        transcript: { sha256: "sha256:tt" },
        audio: {
          file: "audio.m4a",
          mime: "audio/mp4",
          bytes: 1,
          sha256: "sha256:aa",
          durationSeconds: 62,
          complete: false,
        },
        photos: [],
        exportSource: "s",
      },
    );
    expect(e.audio[0].complete).toBe(false);
  });
});

describe("buildManifest", () => {
  it("assembles a manifest and sorts files", () => {
    const m = buildManifest({
      exportedAt: "2026-07-29T21:00:00.000Z",
      appVersion: "recountly@0.1.0",
      counts: { entries: 2, journals: 1, photos: 1, audioFiles: 1 },
      files: {
        "journals.json": "sha256:j",
        "entries/a/transcript.md": "sha256:t",
        "entries/a/audio.m4a": "sha256:a",
      },
    });
    expect(m.format).toBe("recountly-export");
    expect(m.schemaVersion).toBe(EXPORT_SCHEMA_VERSION);
    expect(m.source).toBe("neon-export");
    expect(m.counts).toEqual({ entries: 2, journals: 1, photos: 1, audioFiles: 1 });
    // key-sorted
    expect(Object.keys(m.files)).toEqual([
      "entries/a/audio.m4a",
      "entries/a/transcript.md",
      "journals.json",
    ]);
  });
});
