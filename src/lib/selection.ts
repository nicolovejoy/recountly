// Pure helpers for checkbox-list selection state (bulk-file, issue #28;
// generalized to select-all + bulk trash, issue #40). Immutable so they drop
// straight into useState's updater form.
export function toggleSelected(selected: Set<string>, id: string): Set<string> {
  const next = new Set(selected);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

// Selects every id currently loaded (issue #40 — "select all").
export function selectAll(ids: Iterable<string>): Set<string> {
  return new Set(ids);
}

// Outcome of a sequential bulk action (move or trash): which ids failed, and
// the summary message to show — null when everything succeeded, matching
// bulk-move's existing "N of M entries failed to <verb>." copy.
export interface BatchOutcome {
  failed: Set<string>;
  message: string | null;
}

export function summarizeBatch(
  attempted: number,
  failedIds: string[],
  verb: string,
): BatchOutcome {
  if (failedIds.length === 0) {
    return { failed: new Set(), message: null };
  }
  return {
    failed: new Set(failedIds),
    message: `${failedIds.length} of ${attempted} entries failed to ${verb}.`,
  };
}

// Guards a batch's trailing state writes (issue #40 review fix): useBulkSelection
// snapshots a generation counter before running a batch's sequential awaits,
// bumps the counter on every exitSelectMode, and calls this after the batch
// to decide whether its outcome is still safe to apply. False means select
// mode was left (Cancel, or any other exit) while the batch was still
// in-flight — its failed-id/error result must be dropped instead of
// resurrecting stale selection/error state into a session that's over.
export function batchStillActive(startGeneration: number, currentGeneration: number): boolean {
  return startGeneration === currentGeneration;
}
