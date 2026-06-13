// Audio capture helpers (unit-tested in audio.test.ts) — no DOM dependency in
// the pure part. pickAudioMimeType chooses the best MediaRecorder container the
// platform supports, so Phase 2's saved blob has a known, server-friendly mime.

// Priority order: Opus-in-WebM is the small, widely-supported default;
// Safari/iOS needs mp4/aac; ogg is a last resort. isTypeSupported is injected
// (MediaRecorder.isTypeSupported in the browser) so the choice is testable.
export const AUDIO_MIME_CANDIDATES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4",
  "audio/ogg;codecs=opus",
] as const;

export function pickAudioMimeType(
  isTypeSupported: (mime: string) => boolean,
  candidates: readonly string[] = AUDIO_MIME_CANDIDATES,
): string {
  return candidates.find((c) => isTypeSupported(c)) ?? "";
}
