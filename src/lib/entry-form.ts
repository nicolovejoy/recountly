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
  /**
   * The captured audio, or null/absent when none was recorded. `complete` is
   * false when the entry was paused mid-recording (audio is only the last
   * segment); defaults to true.
   */
  audio?: { blob: Blob; mime: string; complete?: boolean } | null;
}

export function buildEntryFormData(p: EntrySavePayload): FormData {
  const fd = new FormData();
  fd.set("transcript", p.transcript);
  fd.set("durationSeconds", String(p.durationSeconds));
  if (p.recordedAt) fd.set("recordedAt", p.recordedAt);
  if (p.audio && p.audio.blob.size > 0) {
    fd.set("audio", p.audio.blob, `audio.${audioExtension(p.audio.mime)}`);
    fd.set("audioComplete", String(p.audio.complete !== false));
  }
  return fd;
}
