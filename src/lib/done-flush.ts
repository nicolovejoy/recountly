// Bounded wait-for-commit-completion for the Done save (issue #69). Pure — no
// React, DOM, or realtime knowledge; the caller injects the timer and feeds the
// realtime signals.
//
// The bug it fixes: on Done the client fires a manual input_audio_buffer.commit
// to finalize the still-uncommitted tail of a continuous take, but the
// authoritative transcription of that tail arrives asynchronously as a
// `completed` event — hundreds of ms to several seconds later. #54 snapshotted
// the transcript synchronously at the Done instant, so on a long continuous
// take (few/no VAD commits; the live interim deltas lag a long uncommitted
// buffer) the whole back half of the take was lost.
//
// This orchestrates a bounded wait so the save can include that tail, while
// NEVER hanging the save:
//   - `completed(text)`  — the authoritative tail landed; resolve with it.
//   - `emptyCommit()`    — the manual commit had no buffered tail (benign
//                          empty-buffer error); there is no tail coming, settle
//                          immediately so the caller uses its interim fallback.
//                          Keeps the common "Done right after a VAD commit" case
//                          fast instead of waiting out the whole bound.
//   - the bound elapses  — a stall (deltas stopped) still saves the best
//                          available text rather than hanging forever.
//   - `settleNow()`      — forceFlush / immediate teardown (a backgrounded tab
//                          can't keep awaiting a multi-second wait).
// It settles exactly once; whichever fires first wins, and everything after is
// a safe no-op (a late `completed` from a woken-up stall is ignored).

export type TailOutcome =
  | { source: "completed"; transcript: string }
  | { source: "empty" }
  | { source: "timeout" };

export interface DoneFlushTimer<H> {
  set(fn: () => void, ms: number): H;
  clear(handle: H): void;
}

export interface DoneFlushController {
  /** Resolves once — first of a completed event, an empty-commit signal, the
   *  bound elapsing, or settleNow(). */
  readonly promise: Promise<TailOutcome>;
  /** The manual commit's authoritative `completed` transcript landed. */
  completed(transcript: string): void;
  /** The manual commit had no buffered tail (benign empty-buffer error). */
  emptyCommit(): void;
  /** Force settlement now with no tail — the caller falls back to its interim. */
  settleNow(): void;
}

// Upper bound on the wait. The detail page's post-save poll gives the row 30s
// (post-save-poll ENTRY_TIMEOUT_MS), so an 8s worst-case wait sits comfortably
// inside it — the entry still lands well within the poll window.
export const DONE_TAIL_WAIT_MS = 8_000;

export function startDoneFlush<H>(
  timer: DoneFlushTimer<H>,
  boundMs: number = DONE_TAIL_WAIT_MS,
): DoneFlushController {
  let settled = false;
  let handle: H | null = null;
  let resolveFn!: (outcome: TailOutcome) => void;
  const promise = new Promise<TailOutcome>((resolve) => {
    resolveFn = resolve;
  });

  const settle = (outcome: TailOutcome) => {
    if (settled) return;
    settled = true;
    if (handle !== null) timer.clear(handle);
    resolveFn(outcome);
  };

  handle = timer.set(() => settle({ source: "timeout" }), boundMs);

  return {
    promise,
    completed: (transcript: string) => settle({ source: "completed", transcript }),
    emptyCommit: () => settle({ source: "empty" }),
    settleNow: () => settle({ source: "timeout" }),
  };
}

// The tail text the save should append to the base transcript, given the wait's
// outcome and the best-available interim fallback. When the authoritative
// `completed` landed we use IT and DROP the interim: interim is a lagging
// *prefix* of the same buffer's transcription, so appending both would
// duplicate the tail — the completed text supersedes it. On timeout/empty (no
// authoritative tail) we keep the interim, which is exactly the interim-only
// behavior the pause path also relies on (unchanged by #69).
export function resolveTail(outcome: TailOutcome, interimFallback: string): string {
  return outcome.source === "completed" ? outcome.transcript : interimFallback;
}
