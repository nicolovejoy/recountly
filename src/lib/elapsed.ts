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

// Folds the currently-running segment into the accumulator (in ms) — what pause
// does so the frozen timer reads correctly and resume continues from there. A
// null start (nothing running) returns the accumulator unchanged; a skewed
// clock contributes nothing rather than going negative.
export function bankSegment(
  accumulatedMs: number,
  segmentStartMs: number | null,
  nowMs: number,
): number {
  if (segmentStartMs === null) return accumulatedMs;
  return accumulatedMs + Math.max(0, nowMs - segmentStartMs);
}

// Formats an elapsed duration in whole seconds as "m:ss" (minutes are not
// zero-padded or capped; seconds always two digits). Negatives clamp to zero.
export function formatElapsed(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}
