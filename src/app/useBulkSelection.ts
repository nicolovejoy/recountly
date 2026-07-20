"use client";

// Reusable "Select" mode for an entries list (bulk-file, issue #28; pulled out
// of UnfiledView and generalized to select-all + bulk trash for issue #40, so
// JournalView can reuse the same imperative shell). Owns select-mode on/off,
// the selected-id set, the move-target picker value, and running a sequential
// bulk action (move or trash) against the selection: after the batch, only
// the failed ids stay selected (a retry must not re-apply the action to ids
// that already succeeded) and a summary message is shown — same idiom as the
// original bulk-move. bulkTarget lives here (not in the calling component) so
// a successful batch — or any other exit from select mode — clears it
// centrally; leaving it in the component let a stale journal choice survive
// into the next Select session with Move already enabled (review finding).

import { useCallback, useRef, useState } from "react";
import { batchStillActive, selectAll, summarizeBatch, toggleSelected } from "@/lib/selection";

export function useBulkSelection() {
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkTarget, setBulkTarget] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Bumped every time select mode is exited. runBatch snapshots this before
  // its await loop and checks it's unchanged before writing back the
  // outcome — guards against a batch's trailing setError/setSelected
  // resurfacing (e.g. pre-checking failed ids) into a session the user (or
  // any other path) already left while the batch was still running.
  const generationRef = useRef(0);

  const enterSelectMode = useCallback(() => {
    // Defensive: start every session clean, even if a previous session left
    // something behind through some path other than exitSelectMode.
    setSelected(new Set());
    setBulkTarget("");
    setError(null);
    setSelectMode(true);
  }, []);

  const exitSelectMode = useCallback(() => {
    generationRef.current++;
    setSelectMode(false);
    setSelected(new Set());
    setBulkTarget("");
    setError(null);
  }, []);

  const toggle = useCallback((id: string) => {
    setSelected((prev) => toggleSelected(prev, id));
  }, []);

  const selectAllIds = useCallback((ids: string[]) => {
    setSelected(selectAll(ids));
  }, []);

  const clearSelection = useCallback(() => setSelected(new Set()), []);

  // Runs `action` sequentially over every selected id (no new bulk endpoint —
  // list sizes here are small). `verb` feeds summarizeBatch's failure
  // message ("N of M entries failed to <verb>."). Returns the outcome so the
  // caller can decide what else to do (e.g. reload the list either way).
  const runBatch = useCallback(
    async (verb: string, action: (id: string) => Promise<boolean>) => {
      const generation = generationRef.current;
      const attempted = [...selected];
      setBusy(true);
      setError(null);
      const failed: string[] = [];
      for (const id of attempted) {
        const ok = await action(id);
        if (!ok) failed.push(id);
      }
      setBusy(false);
      // Select mode was exited underneath this batch — don't resurrect
      // selection/error state into a session that's already over.
      if (!batchStillActive(generation, generationRef.current)) {
        return { failed: new Set<string>(), message: null };
      }
      const outcome = summarizeBatch(attempted.length, failed, verb);
      if (outcome.message) {
        setError(outcome.message);
        setSelected(outcome.failed);
      } else {
        exitSelectMode();
      }
      return outcome;
    },
    [selected, exitSelectMode],
  );

  return {
    selectMode,
    selected,
    bulkTarget,
    setBulkTarget,
    busy,
    error,
    enterSelectMode,
    exitSelectMode,
    toggle,
    selectAllIds,
    clearSelection,
    runBatch,
  };
}
