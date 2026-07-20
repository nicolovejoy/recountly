// Audio capture helpers (unit-tested in audio.test.ts) — no DOM dependency in
// the pure part. pickAudioMimeType chooses the best MediaRecorder container the
// platform supports, so Phase 2's saved blob has a known, server-friendly mime.

// Priority order: Opus-in-WebM is the small, widely-supported default;
// mp4/aac is the iOS/Safari fallback; ogg is a last resort.
export const AUDIO_MIME_CANDIDATES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4",
  "audio/ogg;codecs=opus",
] as const;

// Recordable != playable: in the iOS home-screen PWA container,
// MediaRecorder.isTypeSupported("audio/webm;codecs=opus") lies and returns
// true, but WebKit's <audio> element can't play WebM back, so a saved entry
// looked healthy server-side yet errored on playback. A candidate must pass
// BOTH an "isTypeSupported"-style recordability check and a playback check
// (HTMLAudioElement.canPlayType) to be chosen. Both are injected so the
// function stays pure and testable.
function isPlayableResult(result: string): boolean {
  return result === "maybe" || result === "probably";
}

// Lazily creates the probe <audio> element (no `document` at module scope,
// so this stays SSR-safe); when there's no DOM at all (e.g. these unit tests
// run in a node environment) we can't check playback, so don't block on it.
function defaultCanPlayType(mime: string): string {
  if (typeof document === "undefined") return "maybe";
  return document.createElement("audio").canPlayType(mime);
}

export function pickAudioMimeType(
  isTypeSupported: (mime: string) => boolean,
  candidates: readonly string[] = AUDIO_MIME_CANDIDATES,
  canPlayType: (mime: string) => string = defaultCanPlayType,
): string {
  return candidates.find((c) => isTypeSupported(c) && isPlayableResult(canPlayType(c))) ?? "";
}
