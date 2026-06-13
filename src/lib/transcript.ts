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

// planAppend is the caret-preservation decision for appending a finalized
// segment into the editable textarea, kept pure so it's testable without a
// DOM. If the caret was at the end (or the textarea is unfocused, which
// browsers report as an at-end/zero selection), the caller should follow
// along — selection moves to the new end and the view scrolls to the tail.
// Any earlier caret/selection stays valid (we only ever append) and is
// restored verbatim. A blank segment changes nothing and never follows.
export interface AppendPlan {
  value: string;
  selectionStart: number;
  selectionEnd: number;
  followTail: boolean;
}

export function planAppend(
  value: string,
  selectionStart: number,
  selectionEnd: number,
  segment: string,
): AppendPlan {
  const next = appendSegment(value, segment);
  const wasAtEnd = selectionStart === value.length && selectionEnd === value.length;
  if (wasAtEnd && next !== value) {
    return {
      value: next,
      selectionStart: next.length,
      selectionEnd: next.length,
      followTail: true,
    };
  }
  return { value: next, selectionStart, selectionEnd, followTail: false };
}
