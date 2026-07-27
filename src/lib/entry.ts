// Entry domain model (unit-tested in entry.test.ts) — no React, no DOM, no DB.
// The pure core of Phase 2 persistence: what the client submits on Done
// (EntryInput), validation, and assembly into the row we store (EntryRecord).
// The DB driver and blob upload wrap this; keeping the shape + rules here makes
// them testable without a database.

export interface EntryInput {
  transcript: string;
  durationSeconds: number;
  // Audio is best-effort: a paused entry (the privacy-pause cuts the mic) or an
  // unsupported browser may save no audio. Absent both fields = no audio.
  audioMime?: string;
  audioBytes?: number;
  // Whether the saved audio covers the WHOLE entry. False when the entry was
  // paused-then-resumed (best-effort audio keeps only the last segment), so the
  // UI can warn the audio is partial. Undefined/null when there's no audio.
  audioComplete?: boolean;
  // When the entry was actually spoken. Defaults to "now" at build time if the
  // client doesn't send it.
  recordedAt?: string;
  // Physical-journal archive: the notebook this reading belongs to (absent for
  // a normal spoken entry), and when the page was originally *written* — as
  // distinct from recordedAt, which for a legacy page is when it was read aloud.
  journalId?: string;
  writtenAt?: string;
  // Free-text page reference for a journal reading (e.g. "pp. 14–16"). No
  // format enforced; trimmed to null when blank.
  pageLabel?: string;
}

// LLM-generated enrichment (Phase 4 thread 1). Produced best-effort on save by
// enrich.ts; the domain owns the shape so entry.ts stays free of the SDK. title
// and tags predate enrichment (they were always on EntryRecord) but are now
// populated from here; summary/model are new.
export interface EntryEnrichment {
  title: string | null;
  tags: string[];
  summary: string | null;
  model: string; // which model produced this (e.g. claude-haiku-4-5)
}

export interface EntryRecord {
  id: string;
  recordedAt: string; // ISO timestamptz
  // Null for a normal spoken entry; set when the entry is a journal reading.
  journalId: string | null;
  // When the page was written (vs recordedAt = when read aloud). Sorting and
  // date search use coalesce(written_at, recorded_at).
  writtenAt: string | null;
  // Free-text page reference (e.g. "pp. 14–16"); null for a normal entry.
  pageLabel: string | null;
  createdAt: string;
  updatedAt: string;
  durationSeconds: number;
  transcript: string;
  title: string | null; // LLM-generated (Phase 4 enrichment)
  tags: string[];
  // LLM-generated summary; null until enriched (or if enrichment failed).
  summary: string | null;
  // When enrichment last ran (ISO timestamptz); null = not yet enriched.
  enrichedAt: string | null;
  // Which model produced the enrichment; null = not yet enriched.
  enrichmentModel: string | null;
  // Null when the entry saved no audio (best-effort — see EntryInput).
  audioUrl: string | null;
  audioMime: string | null;
  audioBytes: number | null;
  // true = audio covers the whole entry; false = partial (paused mid-entry);
  // null = no audio (or unknown, for pre-Phase-4 rows).
  audioComplete: boolean | null;
  // Number of photos attached to this entry. Only populated by the list/search
  // queries (listEntriesSql/searchEntriesSql); undefined elsewhere (e.g. a
  // freshly-built record pre-insert, or a getEntrySql row) — the entry list UI
  // uses it to decide whether a short transcript still needs the expand
  // toggle, since photos only render when expanded.
  photoCount?: number;
  // When the entry was trashed (soft-deleted). Only populated on rows read via
  // getEntrySql/listTrashedSql that are actually trashed; undefined on live
  // rows and pre-insert records.
  deletedAt?: string;
  // Entry metadata editing (PR B): free-text notes and a location, both
  // post-save-editable only (never set by buildEntryRecord/insertEntrySql —
  // location's DB default supplies 'home' for new rows, notes has none).
  // Optional (not just nullable) because a freshly-built pre-insert record
  // never carries them; every row actually read back from the DB does
  // (rowToEntry always maps them to a string or null, never leaves them out).
  notes?: string | null;
  location?: string | null;
}

// Partial post-save edit to an existing entry (PR B) — title/notes/location/
// writtenAt, each independently settable to a value or null (clearing).
// Distinct from EntryInput: these fields are never part of capture/save.
export interface EntryMetadataPatch {
  title?: string | null;
  notes?: string | null;
  location?: string | null;
  writtenAt?: string | null;
}

const METADATA_KEYS = ["title", "notes", "location", "writtenAt"] as const;

// Length caps: title is a headline (card/detail heading), location a short
// tag, notes free-running prose — generous but bounded so a single edit can't
// blow past reasonable row/index sizes.
const TITLE_MAX = 300;
const LOCATION_MAX = 200;
const NOTES_MAX = 20_000;

// Trims a present text field and turns "" into null (clearing); a value over
// the cap or of the wrong type pushes a problem and returns undefined (the
// caller skips writing it to the patch). null passes through as a clear.
function normalizeTextField(
  raw: unknown,
  field: string,
  maxLen: number,
  problems: string[],
): string | null | undefined {
  if (raw === null) return null;
  if (typeof raw !== "string") {
    problems.push(`${field} must be a string or null`);
    return undefined;
  }
  const trimmed = raw.trim();
  if (trimmed.length > maxLen) {
    problems.push(`${field} must be ${maxLen} characters or fewer`);
    return undefined;
  }
  return trimmed.length === 0 ? null : trimmed;
}

// Validates + normalizes an untrusted PATCH body into an EntryMetadataPatch.
// At least one of title/notes/location/writtenAt must be present. Unknown
// keys are ignored here — the route (which also handles the separate
// journalId move branch) decides what "mixed" or "empty" means at the body
// level. writtenAt is expected pre-computed by the client (the same
// local-noon ISO produced by writtenAtIso at capture time) — this only
// checks it parses (or is null, clearing it).
export function validateEntryMetadataPatch(
  body: unknown,
): { ok: true; patch: EntryMetadataPatch } | { ok: false; problems: string[] } {
  if (typeof body !== "object" || body === null) {
    return { ok: false, problems: ["body must be a JSON object"] };
  }
  const b = body as Record<string, unknown>;
  const provided = METADATA_KEYS.filter((k) => Object.prototype.hasOwnProperty.call(b, k));
  if (provided.length === 0) {
    return { ok: false, problems: ["at least one field is required"] };
  }

  const problems: string[] = [];
  const patch: EntryMetadataPatch = {};

  if ("title" in b) {
    const v = normalizeTextField(b.title, "title", TITLE_MAX, problems);
    if (v !== undefined) patch.title = v;
  }
  if ("notes" in b) {
    const v = normalizeTextField(b.notes, "notes", NOTES_MAX, problems);
    if (v !== undefined) patch.notes = v;
  }
  if ("location" in b) {
    const v = normalizeTextField(b.location, "location", LOCATION_MAX, problems);
    if (v !== undefined) patch.location = v;
  }
  if ("writtenAt" in b) {
    const raw = b.writtenAt;
    if (raw === null) {
      patch.writtenAt = null;
    } else if (typeof raw !== "string" || Number.isNaN(Date.parse(raw))) {
      problems.push("writtenAt must be a valid date or null");
    } else {
      patch.writtenAt = raw;
    }
  }

  if (problems.length > 0) return { ok: false, problems };
  return { ok: true, patch };
}

// Returns a list of human-readable problems; empty means valid. A list (rather
// than throw-on-first) lets the save route report everything wrong at once.
export function validateEntryInput(input: EntryInput): string[] {
  const errors: string[] = [];
  if (typeof input.transcript !== "string" || input.transcript.trim().length === 0) {
    errors.push("transcript is empty");
  }
  if (!Number.isFinite(input.durationSeconds) || input.durationSeconds < 0) {
    errors.push("durationSeconds must be a non-negative number");
  }
  // Audio is optional, but when present it must be coherent. audioBytes is the
  // presence signal — if it's set, we expect a positive size and a mime type.
  if (input.audioBytes != null) {
    if (!Number.isInteger(input.audioBytes) || input.audioBytes <= 0) {
      errors.push("audioBytes must be a positive integer");
    }
    if (typeof input.audioMime !== "string" || input.audioMime.length === 0) {
      errors.push("audioMime is required");
    }
  }
  if (input.journalId != null && (typeof input.journalId !== "string" || input.journalId.trim().length === 0)) {
    errors.push("journalId must be a non-empty string");
  }
  if (input.writtenAt != null && Number.isNaN(Date.parse(input.writtenAt))) {
    errors.push("writtenAt must be a valid date");
  }
  // Permissive: present-must-be-a-string, no length cap (mirrors journalId's
  // shape guard). A blank pageLabel is fine — buildEntryRecord trims it to null.
  if (input.pageLabel != null && typeof input.pageLabel !== "string") {
    errors.push("pageLabel must be a string");
  }
  return errors;
}

export interface BuildContext {
  id: string;
  audioUrl: string | null; // null when no audio was captured
  now: Date;
  // Best-effort LLM enrichment computed by the caller before building. Absent
  // (or null) when enrichment didn't run or failed — the entry still saves,
  // with title/tags/summary empty and enrichedAt null.
  enrichment?: EntryEnrichment | null;
}

// Assembles the stored row from validated input plus the server-assigned id,
// blob URL, and timestamps. recordedAt defaults to now; created/updated are
// always stamped now. title/tags/summary come from enrichment when present,
// else stay empty (a later backfill can fill them in).
export function buildEntryRecord(input: EntryInput, ctx: BuildContext): EntryRecord {
  const nowIso = ctx.now.toISOString();
  const enr = ctx.enrichment ?? null;
  return {
    id: ctx.id,
    recordedAt: input.recordedAt ?? nowIso,
    journalId: input.journalId ?? null,
    writtenAt: input.writtenAt ?? null,
    pageLabel: input.pageLabel?.trim() || null,
    createdAt: nowIso,
    updatedAt: nowIso,
    durationSeconds: input.durationSeconds,
    transcript: input.transcript.trim(),
    title: enr?.title ?? null,
    tags: enr?.tags ?? [],
    summary: enr?.summary ?? null,
    enrichedAt: enr ? nowIso : null,
    enrichmentModel: enr?.model ?? null,
    audioUrl: ctx.audioUrl,
    audioMime: input.audioMime ?? null,
    audioBytes: input.audioBytes ?? null,
    // Only meaningful when audio was saved; null otherwise.
    audioComplete: ctx.audioUrl ? (input.audioComplete ?? true) : null,
  };
}
