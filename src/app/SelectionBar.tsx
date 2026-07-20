"use client";

// The bulk-action toolbar shown while a list is in "Select" mode (issue #28
// bulk move, extended to bulk trash for issue #40). Shared by UnfiledView and
// JournalView so the two lists stay visually identical. Purely presentational
// — the caller owns selection state (useBulkSelection) and wires up the two
// actions; this component just renders the count, journal picker, and the
// Move/Trash buttons plus the error line.

const UNFILED_VALUE = "__unfiled__";

export default function SelectionBar({
  count,
  journals,
  includeUnfiledOption,
  bulkTarget,
  onBulkTargetChange,
  busy,
  onMove,
  onTrash,
  error,
}: {
  count: number;
  journals: { id: string; label: string }[] | null;
  // Unfiled itself doesn't offer "move to Unfiled" (entries there already
  // are); JournalView's picker offers it as a way out of the journal.
  includeUnfiledOption: boolean;
  bulkTarget: string;
  onBulkTargetChange: (value: string) => void;
  busy: boolean;
  onMove: () => void;
  onTrash: () => void;
  error: string | null;
}) {
  const noun = count === 1 ? "entry" : "entries";
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-foreground/10 p-2 text-xs text-foreground/60">
      <span>{count} selected</span>
      <select
        value={bulkTarget}
        onChange={(ev) => onBulkTargetChange(ev.target.value)}
        disabled={busy}
        aria-label="Move selected entries to journal"
        className="rounded-lg border border-foreground/15 bg-transparent px-2 py-1 text-xs outline-none focus:border-foreground/40"
      >
        <option value="">Choose journal…</option>
        {includeUnfiledOption && <option value={UNFILED_VALUE}>Unfiled</option>}
        {journals?.map((j) => (
          <option key={j.id} value={j.id}>
            {j.label}
          </option>
        ))}
      </select>
      <button
        type="button"
        onClick={onMove}
        disabled={busy || !bulkTarget || count === 0}
        className="rounded-lg border border-foreground/15 px-2 py-1 text-foreground/70 hover:border-foreground/40 disabled:opacity-40"
      >
        {busy ? "Working…" : `Move ${count} ${noun}`}
      </button>
      <button
        type="button"
        onClick={onTrash}
        disabled={busy || count === 0}
        className="rounded-lg border border-foreground/15 px-2 py-1 text-foreground/70 hover:border-red-500 hover:text-red-500 disabled:opacity-40"
      >
        {busy ? "Working…" : `Trash ${count} ${noun}`}
      </button>
      {error && <span className="text-red-500">{error}</span>}
    </div>
  );
}

export { UNFILED_VALUE };
