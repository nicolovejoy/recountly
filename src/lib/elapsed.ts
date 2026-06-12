// Pure timer formatter (unit-tested in elapsed.test.ts) — no React, no DOM.
// Formats an elapsed duration in whole seconds as "m:ss" (minutes are not
// zero-padded or capped; seconds always two digits). Negatives clamp to zero.
export function formatElapsed(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}
