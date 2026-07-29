import { describe, it, expect } from "vitest";
import {
  startDoneFlush,
  resolveTail,
  DONE_TAIL_WAIT_MS,
  type TailOutcome,
} from "./done-flush";

// A fake timer that never fires synchronously — the test drives it via fire().
// clear() drops the pending callback, so a settle() that clears the timer makes
// a later fire() a no-op (proving a late timer can't double-settle).
function makeTimer() {
  let pending: { fn: () => void; ms: number } | null = null;
  let cleared = 0;
  return {
    timer: {
      set(fn: () => void, ms: number) {
        pending = { fn, ms };
        return 1;
      },
      clear() {
        cleared += 1;
        pending = null;
      },
    },
    fire() {
      const p = pending;
      pending = null;
      p?.fn();
    },
    get pendingMs() {
      return pending?.ms ?? null;
    },
    get cleared() {
      return cleared;
    },
  };
}

describe("startDoneFlush", () => {
  it("schedules the bound on the injected timer (default DONE_TAIL_WAIT_MS)", () => {
    const t = makeTimer();
    startDoneFlush(t.timer);
    expect(t.pendingMs).toBe(DONE_TAIL_WAIT_MS);
  });

  it("honors a custom bound", () => {
    const t = makeTimer();
    startDoneFlush(t.timer, 3000);
    expect(t.pendingMs).toBe(3000);
  });

  it("completed-arrives-fast → resolves with the authoritative tail and cancels the timer", async () => {
    const t = makeTimer();
    const flush = startDoneFlush(t.timer);
    flush.completed("the whole back half of the take");
    await expect(flush.promise).resolves.toEqual<TailOutcome>({
      source: "completed",
      transcript: "the whole back half of the take",
    });
    expect(t.cleared).toBe(1); // bound timer cancelled — it can't fire later
    expect(t.pendingMs).toBeNull();
  });

  it("completed-arrives-late-within-bound → still resolves completed (bound not yet fired)", async () => {
    const t = makeTimer();
    const flush = startDoneFlush(t.timer);
    // Time passes but the bound timer has NOT fired yet — a late completed wins.
    expect(t.pendingMs).toBe(DONE_TAIL_WAIT_MS);
    flush.completed("late but within the 8s window");
    await expect(flush.promise).resolves.toEqual<TailOutcome>({
      source: "completed",
      transcript: "late but within the 8s window",
    });
  });

  it("timeout-falls-back → bound fires with no signal → source 'timeout'", async () => {
    const t = makeTimer();
    const flush = startDoneFlush(t.timer);
    t.fire();
    await expect(flush.promise).resolves.toEqual<TailOutcome>({ source: "timeout" });
  });

  it("empty-buffer commit settles fast as 'empty' and cancels the timer", async () => {
    const t = makeTimer();
    const flush = startDoneFlush(t.timer);
    flush.emptyCommit();
    await expect(flush.promise).resolves.toEqual<TailOutcome>({ source: "empty" });
    expect(t.cleared).toBe(1);
    // The (now-cleared) bound timer firing afterwards is a harmless no-op.
    expect(() => t.fire()).not.toThrow();
  });

  it("completed-after-timeout-is-ignored-safely", async () => {
    const t = makeTimer();
    const flush = startDoneFlush(t.timer);
    t.fire(); // timeout wins
    const outcome = await flush.promise;
    expect(outcome).toEqual<TailOutcome>({ source: "timeout" });
    // A completed landing after the bound already elapsed must not throw and
    // must not change the already-resolved outcome.
    expect(() => flush.completed("too late — a stalled session woke up")).not.toThrow();
    await expect(flush.promise).resolves.toEqual<TailOutcome>({ source: "timeout" });
  });

  it("settleNow() resolves timeout (forceFlush / immediate-teardown seam) and cancels the timer", async () => {
    const t = makeTimer();
    const flush = startDoneFlush(t.timer);
    flush.settleNow();
    await expect(flush.promise).resolves.toEqual<TailOutcome>({ source: "timeout" });
    expect(t.cleared).toBe(1);
  });

  it("settles exactly once — first signal wins, later ones are ignored", async () => {
    const t = makeTimer();
    const flush = startDoneFlush(t.timer);
    flush.completed("first");
    flush.completed("second");
    flush.emptyCommit();
    flush.settleNow();
    await expect(flush.promise).resolves.toEqual<TailOutcome>({
      source: "completed",
      transcript: "first",
    });
  });
});

describe("resolveTail", () => {
  it("completed → uses the authoritative tail and DROPS the interim (no double-append)", () => {
    // interim is a lagging PREFIX of the completed transcription of the same
    // buffer; keeping both would duplicate the tail.
    const outcome: TailOutcome = {
      source: "completed",
      transcript: "the full seventeen seconds of speech",
    };
    expect(resolveTail(outcome, "the full seventeen")).toBe(
      "the full seventeen seconds of speech",
    );
  });

  it("timeout → keeps the interim fallback (unchanged interim-only behavior, same as pause)", () => {
    expect(resolveTail({ source: "timeout" }, "best available so far")).toBe(
      "best available so far",
    );
  });

  it("empty → keeps the interim fallback", () => {
    expect(resolveTail({ source: "empty" }, "")).toBe("");
    expect(resolveTail({ source: "empty" }, "typed tail")).toBe("typed tail");
  });
});
