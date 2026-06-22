// Builds the multipart body the client POSTs to /api/entries on Done. Kept pure
// (and unit-tested) because the field names here are a contract with the route
// handler — a mismatch silently drops data. Audio is best-effort: omitted when
// absent or empty, so a paused/unsupported entry still saves its transcript.

import { audioExtension } from "./blob";

export interface EntrySavePayload {
  transcript: string;
  durationSeconds: number;
  /** When spoken (ISO). Omitted → server stamps now. */
  recordedAt?: string;
  /** The captured audio, or null/absent when none was recorded. */
  audio?: { blob: Blob; mime: string } | null;
}

export function buildEntryFormData(p: EntrySavePayload): FormData {
  const fd = new FormData();
  fd.set("transcript", p.transcript);
  fd.set("durationSeconds", String(p.durationSeconds));
  if (p.recordedAt) fd.set("recordedAt", p.recordedAt);
  if (p.audio && p.audio.blob.size > 0) {
    fd.set("audio", p.audio.blob, `audio.${audioExtension(p.audio.mime)}`);
  }
  return fd;
}
