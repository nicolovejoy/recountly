// Builds the multipart body the client POSTs to /api/entries on Done. Kept pure
// (and unit-tested) because the field names here are a contract with the route
// handler — a mismatch silently drops data. Audio is best-effort: omitted when
// absent or empty, so a paused/unsupported entry still saves its transcript.

import { audioExtension } from "./blob";
import { imageExtension } from "./photo";

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
  /** Physical-journal archive: the notebook this reading belongs to. */
  journalId?: string;
  /** When the page was originally written (ISO). */
  writtenAt?: string;
  /**
   * Page photos. NOT best-effort — the route fails the whole save if any
   * photo can't be stored, so the client must surface that error.
   */
  photos?: { blob: Blob; mime: string }[];
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
  if (p.journalId) fd.set("journalId", p.journalId);
  if (p.writtenAt) fd.set("writtenAt", p.writtenAt);
  for (const photo of p.photos ?? []) {
    if (photo.blob.size > 0) {
      fd.append("photo", photo.blob, `photo.${imageExtension(photo.mime)}`);
    }
  }
  return fd;
}
