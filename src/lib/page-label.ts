// Sticky page-label suggestion (capture polish). When the active journal
// changes, Capture pre-fills the page-label field with a suggestion derived
// from that journal's most recent entry's label. Deliberately a raw
// passthrough of the trimmed last label — NO parse/increment of page numbers.
// This is the seam: a future version can grow real "pp. 14–16 → pp. 17" logic
// here without touching callers.

export function suggestNextPageLabel(lastLabel: string | null | undefined): string {
  return lastLabel?.trim() || "";
}

// The value to actually save/persist for the page label. Only meaningful under
// a journal (an Unfiled entry has no pages), and a blank field saves nothing —
// returns undefined so buildSaveBody omits the field. Centralizes the gating
// that Done and both lifecycle-flush paths share.
export function savedPageLabel(
  journalId: string | undefined,
  pageLabel: string,
): string | undefined {
  if (!journalId) return undefined;
  return pageLabel.trim() || undefined;
}
