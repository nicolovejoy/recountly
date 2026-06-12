// Pure timer helpers (unit-tested in elapsed.test.ts) — no React, no DOM.

// Cumulative recording time across pause/resume cycles, in whole seconds.
// accumulatedMs: total of all finished segments (banked on each pause);
// segmentStartMs: epoch ms when the current segment went live, or null while
// paused/idle; nowMs: injected clock. A skewed clock (now < segment start)
// clamps the running segment to zero rather than going negative.
export function totalElapsedSec(
  accumulatedMs: number,
  segmentStartMs: number | null,
  nowMs: number,
): number {
  const runningMs = segmentStartMs === null ? 0 : Math.max(0, nowMs - segmentStartMs);
  return Math.floor((accumulatedMs + runningMs) / 1000);
}

// Formats an elapsed duration in whole seconds as "m:ss" (minutes are not
// zero-padded or capped; seconds always two digits). Negatives clamp to zero.
export function formatElapsed(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}
