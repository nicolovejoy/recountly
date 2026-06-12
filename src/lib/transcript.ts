// Pure transcript helpers (unit-tested in transcript.test.ts) — no React, no DOM.
//
// appendSegment merges a newly-finalized spoken segment onto the END of the
// existing transcript text, inserting a single separating space unless the text
// already ends in whitespace (so a trailing newline or space is preserved as-is).
// Appending only ever happens at the end, which is what lets the caller restore
// an earlier caret/selection position after writing the result back.
export function appendSegment(prev: string, segment: string): string {
  const clean = segment.trim();
  if (!clean) return prev;
  if (prev.length === 0) return clean;
  return /\s$/.test(prev) ? prev + clean : prev + " " + clean;
}
