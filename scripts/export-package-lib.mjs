// Pure helpers for the open-format export (scripts/export-open-package.mjs).
// No DB, no blob, no filesystem — just the row→JSON column mapping, the manifest
// assembly, and the content-hash bookkeeping — so they're unit-tested with
// fixture rows (export-package-lib.test.mjs) without a live database.
//
// Target format is the native-app import spec:
//   ~/src/raconte/docs/plans/2026-07-29-data-model-and-migration.md §3/§4.
// Keep this in lockstep with that spec — the native importer reads what this writes.

import { createHash } from "node:crypto";

export const EXPORT_SCHEMA_VERSION = 1;
export const EXPORT_FORMAT = "recountly-export";
export const EXPORT_SOURCE = "neon-export";
export const TRANSCRIPT_FILE = "transcript.md";

// ---- content hashing -------------------------------------------------------

export function sha256Hex(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

// The manifest.files value format — a sha256 for every file in the package.
export function sha256Prefixed(buf) {
  return `sha256:${sha256Hex(buf)}`;
}

// ---- timestamp / date normalization ----------------------------------------
// neon's HTTP driver hands back timestamptz as a string (and date as a string),
// but node-postgres would hand back Date — accept both. Re-emit timestamps as
// canonical ISO-8601 UTC (…Z), which is what the native schema stores.

export function toIso(v) {
  if (v == null) return null;
  if (v instanceof Date) return v.toISOString();
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? String(v) : d.toISOString();
}

export function toDateOnly(v) {
  if (v == null) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).slice(0, 10);
}

// ---- blob storage paths (mirror src/lib/blob.ts + src/lib/photo.ts) --------
// How the blob was STORED — the path we fetch from. Distinct from the export
// filename (audioExportExt below), which follows the native spec's `.m4a`.

export function audioStorageExt(mime) {
  const base = String(mime).split(";")[0].trim().toLowerCase();
  switch (base) {
    case "audio/webm":
      return "webm";
    case "audio/mp4":
      return "mp4";
    case "audio/ogg":
      return "ogg";
    case "audio/mpeg":
      return "mp3";
    default:
      return "bin";
  }
}

export function imageExt(mime) {
  const base = String(mime).split(";")[0].trim().toLowerCase();
  switch (base) {
    case "image/jpeg":
      return "jpg";
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    case "image/heic":
      return "heic";
    case "image/gif":
      return "gif";
    default:
      return "bin";
  }
}

export function audioStoragePath(id, mime) {
  return `audio/${id}.${audioStorageExt(mime)}`;
}

export function photoStoragePath(id, mime) {
  return `photos/${id}.${imageExt(mime)}`;
}

// The export filename extension. The native spec's common case is `audio.m4a`
// (an AAC-LC .m4a === audio/mp4 container); rarer old rows keep an honest ext.
export function audioExportExt(mime) {
  const base = String(mime).split(";")[0].trim().toLowerCase();
  if (base === "audio/mp4") return "m4a";
  return audioStorageExt(mime);
}

// ---- column → field mapping -------------------------------------------------

// journals.kind: web 'archive' → native 'paperArchive'; null → 'contemporary'.
export function kindToNative(webKind) {
  return webKind === "archive" ? "paperArchive" : "contemporary";
}

// Web `title` is user-or-generated with no recorded provenance. Heuristic (§4):
// enriched → generated; a title with no enrichment → a user edit.
export function titleField(row) {
  if (row.title == null) return { value: null, source: null };
  const value = String(row.title);
  return row.enriched_at != null
    ? { value, source: "generated" }
    : { value, source: "user" };
}

// Web has no written-precision. Non-null written_at came from a paper reading →
// default "day" (§4, open decision #2 — moot for today's data: all imp_ rows
// have null written_at). Null written_at → null precision.
export function writtenPrecisionFor(row) {
  return row.written_at != null ? "day" : null;
}

// journals.json element (§3). isActive is dropped (recommended local-only, §2).
export function mapJournal(row) {
  return {
    id: String(row.id),
    label: String(row.label),
    notes: row.notes == null ? null : String(row.notes),
    kind: kindToNative(row.kind ?? null),
    startedOn: toDateOnly(row.started_on),
    endedOn: toDateOnly(row.ended_on),
    coverPhotoId: null,
    createdAt: toIso(row.created_at),
  };
}

// entry_moves audit row → legacy/entry_moves.json element (§4: dropped from the
// native model, archived for provenance only).
export function mapEntryMove(row) {
  return {
    id: Number(row.id),
    entryId: String(row.entry_id),
    fromJournalId: row.from_journal_id == null ? null : String(row.from_journal_id),
    toJournalId: row.to_journal_id == null ? null : String(row.to_journal_id),
    movedAt: toIso(row.moved_at),
  };
}

// Build entry.json (§3) from a DB row plus already-computed file descriptors.
// `transcript` = { sha256 }; `audio` = null | { file, mime, bytes, sha256,
// durationSeconds, complete }; `photos` = [{ file, id, mime, bytes, sha256 }].
// Keeping the file descriptors as inputs is what lets this stay pure/testable —
// the caller downloads the blobs and hashes them.
export function mapEntry(row, { transcript, audio, photos, exportSource }) {
  const spokenAt = toIso(row.recorded_at);
  const originalWrittenAt = toIso(row.written_at);
  const effectiveAt = originalWrittenAt ?? spokenAt;
  const enrichedAt = toIso(row.enriched_at);
  const tags = Array.isArray(row.tags) ? row.tags.map(String) : [];
  const summary = row.summary == null ? null : String(row.summary);

  const enrichment =
    enrichedAt != null
      ? {
          model: row.enrichment_model == null ? null : String(row.enrichment_model),
          enrichedAt,
          title: row.title == null ? null : String(row.title),
          summary,
          tags,
        }
      : null;

  return {
    schemaVersion: EXPORT_SCHEMA_VERSION,
    id: String(row.id),
    spokenAt,
    originalWrittenAt,
    writtenPrecision: writtenPrecisionFor(row),
    effectiveAt,
    durationSeconds: Number(row.duration_seconds ?? 0),
    journalId: row.journal_id == null ? null : String(row.journal_id),
    pageLabel: row.page_label == null ? null : String(row.page_label),
    location: row.location == null ? null : String(row.location),
    status: row.deleted_at != null ? "trashed" : "active",
    trashedAt: toIso(row.deleted_at),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
    title: titleField(row),
    notes: row.notes == null ? null : String(row.notes),
    tags,
    summary,
    enrichment,
    transcript: {
      file: TRANSCRIPT_FILE,
      sha256: transcript.sha256,
      source: "import",
      lastUserEditedAt: null,
      lastGeneratedAt: null,
    },
    audio: audio
      ? [
          {
            file: audio.file,
            segmentIndex: 0,
            startTime: 0,
            durationSeconds: audio.durationSeconds,
            mime: audio.mime,
            bytes: audio.bytes,
            sha256: audio.sha256,
            complete: audio.complete,
          },
        ]
      : [],
    photos: photos.map((p) => ({
      file: p.file,
      id: p.id,
      mime: p.mime,
      bytes: p.bytes,
      sha256: p.sha256,
    })),
    legacy: { webId: String(row.id), source: exportSource },
  };
}

// manifest.json (§3). `files` is a plain object relpath → "sha256:…"; emit it
// key-sorted so the manifest is stable/diffable across re-runs.
export function buildManifest({ exportedAt, appVersion, counts, files }) {
  const sorted = {};
  for (const key of Object.keys(files).sort()) sorted[key] = files[key];
  return {
    format: EXPORT_FORMAT,
    schemaVersion: EXPORT_SCHEMA_VERSION,
    exportedAt,
    source: EXPORT_SOURCE,
    appVersion,
    counts,
    files: sorted,
  };
}
