"use client";

// Header-row control for entering/leaving Select mode, plus "Select all" once
// in it (issue #40 — the owner wants to select everything loaded, not tap
// each checkbox). Shared by UnfiledView and JournalView alongside
// SelectionBar/useBulkSelection.

export default function SelectModeToggle({
  selectMode,
  allSelected,
  busy,
  onEnter,
  onExit,
  onSelectAll,
  onClear,
}: {
  selectMode: boolean;
  allSelected: boolean;
  // True while a bulk action is running — Cancel/Select all/Clear are
  // disabled so a batch can't be exited (and its outcome dropped) or have
  // its target set mutated mid-flight.
  busy: boolean;
  onEnter: () => void;
  onExit: () => void;
  onSelectAll: () => void;
  onClear: () => void;
}) {
  if (!selectMode) {
    return (
      <button
        type="button"
        onClick={onEnter}
        className="shrink-0 text-xs text-foreground/40 hover:text-foreground/70"
      >
        Select
      </button>
    );
  }
  return (
    <span className="flex shrink-0 items-center gap-2 text-xs">
      <button
        type="button"
        onClick={allSelected ? onClear : onSelectAll}
        disabled={busy}
        className="text-foreground/40 hover:text-foreground/70 disabled:opacity-40"
      >
        {allSelected ? "Clear" : "Select all"}
      </button>
      <button
        type="button"
        onClick={onExit}
        disabled={busy}
        className="text-foreground/40 hover:text-foreground/70 disabled:opacity-40"
      >
        Cancel
      </button>
    </span>
  );
}
