// The client↔route JSON contract for saving an entry (issue #23). Replaces the
// multipart entry-form.ts FormData: audio + photos now upload straight to Vercel
// Blob, so the save POST carries only ids + blob pathnames + text — a small body
// that fits fetch keepalive. Pure + unit-tested because these field names are a
// contract with the route handler; a mismatch silently drops data.

import { validateEntryInput, type EntryInput } from "./entry";

// A blob already uploaded to the store, described by its deterministic pathname
// (audioBlobPath / photoBlobPath). The route re-derives audioUrl from the id, so
// the pathname here is purely the store key the client uploaded to.
export interface SaveAudioRef {
  pathname: string;
  mime: string;
  bytes: number;
  complete: boolean;
}

export interface SavePhotoRef {
  id: string;
  pathname: string;
  mime: string;
  bytes: number;
}

export interface SaveRequestBody {
  id: string; // client-minted ulid — entry primary key
  transcript: string;
  durationSeconds: number;
  recordedAt?: string; // ISO; omitted → server stamps now
  journalId?: string;
  writtenAt?: string; // ISO
  audio?: SaveAudioRef | null;
  photos: SavePhotoRef[]; // [] when none
}

// Client side: assemble the body from the entry id + uploaded-blob descriptors.
export function buildSaveBody(input: {
  id: string;
  transcript: string;
  durationSeconds: number;
  recordedAt?: string;
  journalId?: string;
  writtenAt?: string;
  audio: SaveAudioRef | null;
  photos: SavePhotoRef[];
}): SaveRequestBody {
  const body: SaveRequestBody = {
    id: input.id,
    transcript: input.transcript,
    durationSeconds: input.durationSeconds,
    audio: input.audio,
    photos: input.photos,
  };
  if (input.recordedAt) body.recordedAt = input.recordedAt;
  if (input.journalId) body.journalId = input.journalId;
  if (input.writtenAt) body.writtenAt = input.writtenAt;
  return body;
}

// Route side: validate an untrusted JSON body into an EntryInput + blob refs.
// House style — a problems[] list rather than throw-on-first (mirrors
// validateEntryInput), so the route can report everything wrong at once.
export function parseSaveBody(
  raw: unknown,
):
  | { ok: true; input: EntryInput; audio: SaveAudioRef | null; photos: SavePhotoRef[] }
  | { ok: false; problems: string[] } {
  if (typeof raw !== "object" || raw === null) {
    return { ok: false, problems: ["body must be a JSON object"] };
  }
  const b = raw as Record<string, unknown>;
  const problems: string[] = [];

  if (typeof b.id !== "string" || b.id.trim().length === 0) {
    problems.push("id is required");
  }

  // Transcript/duration/journalId/writtenAt go through the shared validator; the
  // blob refs (audio, photos) are validated here since they're new to this path.
  const base: EntryInput = {
    transcript: typeof b.transcript === "string" ? b.transcript : "",
    durationSeconds: typeof b.durationSeconds === "number" ? b.durationSeconds : NaN,
    recordedAt: typeof b.recordedAt === "string" ? b.recordedAt : undefined,
    journalId: typeof b.journalId === "string" ? b.journalId : undefined,
    writtenAt: typeof b.writtenAt === "string" ? b.writtenAt : undefined,
  };
  problems.push(...validateEntryInput(base));

  const audio = parseAudioRef(b.audio, problems);
  const photos = parsePhotos(b.photos, problems);

  if (problems.length > 0) return { ok: false, problems };

  const input: EntryInput = audio
    ? { ...base, audioMime: audio.mime, audioBytes: audio.bytes, audioComplete: audio.complete }
    : base;
  return { ok: true, input, audio, photos };
}

function parseAudioRef(raw: unknown, problems: string[]): SaveAudioRef | null {
  if (raw == null) return null;
  if (typeof raw !== "object") {
    problems.push("audio must be an object or null");
    return null;
  }
  const a = raw as Record<string, unknown>;
  let ok = true;
  if (typeof a.pathname !== "string" || a.pathname.length === 0) {
    problems.push("audio.pathname is required");
    ok = false;
  }
  if (typeof a.mime !== "string" || !a.mime.startsWith("audio/")) {
    problems.push("audio.mime must be an audio/* type");
    ok = false;
  }
  if (typeof a.bytes !== "number" || !Number.isInteger(a.bytes) || a.bytes <= 0) {
    problems.push("audio.bytes must be a positive integer");
    ok = false;
  }
  if (!ok) return null;
  return {
    pathname: a.pathname as string,
    mime: a.mime as string,
    bytes: a.bytes as number,
    complete: a.complete !== false,
  };
}

function parsePhotos(raw: unknown, problems: string[]): SavePhotoRef[] {
  if (raw == null) return [];
  if (!Array.isArray(raw)) {
    problems.push("photos must be an array");
    return [];
  }
  const photos: SavePhotoRef[] = [];
  raw.forEach((entry, i) => {
    if (typeof entry !== "object" || entry === null) {
      problems.push(`photos[${i}] must be an object`);
      return;
    }
    const p = entry as Record<string, unknown>;
    let ok = true;
    if (typeof p.id !== "string" || p.id.trim().length === 0) {
      problems.push(`photos[${i}].id is required`);
      ok = false;
    }
    if (typeof p.pathname !== "string" || p.pathname.length === 0) {
      problems.push(`photos[${i}].pathname is required`);
      ok = false;
    }
    if (typeof p.mime !== "string" || !p.mime.startsWith("image/")) {
      problems.push(`photos[${i}].mime must be an image/* type`);
      ok = false;
    }
    if (typeof p.bytes !== "number" || !Number.isInteger(p.bytes) || p.bytes <= 0) {
      problems.push(`photos[${i}].bytes must be a positive integer`);
      ok = false;
    }
    if (ok) {
      photos.push({
        id: p.id as string,
        pathname: p.pathname as string,
        mime: p.mime as string,
        bytes: p.bytes as number,
      });
    }
  });
  return photos;
}
