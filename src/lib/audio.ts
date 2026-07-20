// Audio capture helpers (unit-tested in audio.test.ts) — no DOM dependency in
// the pure part. pickAudioMimeType chooses the best MediaRecorder container the
// platform supports, so Phase 2's saved blob has a known, server-friendly mime.

// Priority order: mp4/AAC first. Field data (2026-07-19) showed the iOS
// home-screen PWA's WebKit lies on BOTH webm probes — isTypeSupported and
// canPlayType both pass for "audio/webm;codecs=opus" — then plays the saved
// file silently. Probe answers can't be trusted to demote mp4 on that engine,
// so mp4/AAC (the one container every engine both records and plays) goes
// first regardless of what the webm probes claim. A bare "audio/mp4" is kept
// as a second mp4 candidate since Safari's isTypeSupported can be picky about
// the codecs string. WebM stays as the fallback for engines that can record
// it but not mp4 (older Chrome); ogg is the last resort. `fixWebmDuration`
// (useRecorder) only patches duration on that webm fallback path.
export const AUDIO_MIME_CANDIDATES = [
  "audio/mp4;codecs=mp4a.40.2",
  "audio/mp4",
  "audio/webm;codecs=opus",
  "audio/webm",
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
