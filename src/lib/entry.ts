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
}

export interface EntryRecord {
  id: string;
  recordedAt: string; // ISO timestamptz
  createdAt: string;
  updatedAt: string;
  durationSeconds: number;
  transcript: string;
  title: string | null; // LLM-generated later (Phase 4)
  tags: string[];
  // Null when the entry saved no audio (best-effort — see EntryInput).
  audioUrl: string | null;
  audioMime: string | null;
  audioBytes: number | null;
  // true = audio covers the whole entry; false = partial (paused mid-entry);
  // null = no audio (or unknown, for pre-Phase-4 rows).
  audioComplete: boolean | null;
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
  return errors;
}

export interface BuildContext {
  id: string;
  audioUrl: string | null; // null when no audio was captured
  now: Date;
}

// Assembles the stored row from validated input plus the server-assigned id,
// blob URL, and timestamps. recordedAt defaults to now; created/updated are
// always stamped now. title/tags start empty (enriched later).
export function buildEntryRecord(input: EntryInput, ctx: BuildContext): EntryRecord {
  const nowIso = ctx.now.toISOString();
  return {
    id: ctx.id,
    recordedAt: input.recordedAt ?? nowIso,
    createdAt: nowIso,
    updatedAt: nowIso,
    durationSeconds: input.durationSeconds,
    transcript: input.transcript.trim(),
    title: null,
    tags: [],
    audioUrl: ctx.audioUrl,
    audioMime: input.audioMime ?? null,
    audioBytes: input.audioBytes ?? null,
    // Only meaningful when audio was saved; null otherwise.
    audioComplete: ctx.audioUrl ? (input.audioComplete ?? true) : null,
  };
}
