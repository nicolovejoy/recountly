import { describe, it, expect } from "vitest";
import {
  placeholderStatusLine,
  nextPollState,
  initialPollState,
  shouldPoll,
  stuckNote,
  POLL_INTERVAL_MS,
  ENTRY_TIMEOUT_MS,
  ENRICHMENT_BUDGET_MS,
  type PollState,
} from "./post-save-poll";

describe("placeholderStatusLine", () => {
  it("cycles the three lines on a ~2.5s interval", () => {
    expect(placeholderStatusLine(0)).toBe("Finishing transcription…");
    expect(placeholderStatusLine(2499)).toBe("Finishing transcription…");
    expect(placeholderStatusLine(2500)).toBe("Uploading audio…");
    expect(placeholderStatusLine(4999)).toBe("Uploading audio…");
    expect(placeholderStatusLine(5000)).toBe("Saving…");
    expect(placeholderStatusLine(7499)).toBe("Saving…");
  });

  it("wraps around after the last line", () => {
    expect(placeholderStatusLine(7500)).toBe("Finishing transcription…");
    expect(placeholderStatusLine(10000)).toBe("Uploading audio…");
    expect(placeholderStatusLine(12500)).toBe("Saving…");
  });

  it("clamps negative elapsed to the first line", () => {
    expect(placeholderStatusLine(-100)).toBe("Finishing transcription…");
  });
});

describe("nextPollState", () => {
  it("starts awaiting-entry", () => {
    expect(initialPollState()).toEqual({ phase: "awaiting-entry", elapsedMs: 0, entryLandedAtMs: null });
  });

  it("awaiting-entry + result(entry, unenriched) → awaiting-enrichment stamping landed time", () => {
    let s = initialPollState();
    s = nextPollState(s, { type: "tick", elapsedMs: 4000 });
    s = nextPollState(s, { type: "result", entry: { enrichedAt: null } });
    expect(s.phase).toBe("awaiting-enrichment");
    expect(s.entryLandedAtMs).toBe(4000);
  });

  it("awaiting-entry + result(entry, enriched) → done immediately (immediate-200-with-enrichment)", () => {
    const s = nextPollState(initialPollState(), {
      type: "result",
      entry: { enrichedAt: "2026-07-25T00:00:00Z" },
    });
    expect(s.phase).toBe("done");
  });

  it("awaiting-entry + result(null) stays awaiting-entry (still 404)", () => {
    const s = nextPollState(initialPollState(), { type: "result", entry: null });
    expect(s.phase).toBe("awaiting-entry");
  });

  it("200-then-enrichment-pop: awaiting-enrichment + result(enriched) → done", () => {
    let s = initialPollState();
    s = nextPollState(s, { type: "result", entry: { enrichedAt: null } });
    expect(s.phase).toBe("awaiting-enrichment");
    s = nextPollState(s, { type: "result", entry: { enrichedAt: "2026-07-25T00:00:00Z" } });
    expect(s.phase).toBe("done");
  });

  it("awaiting-enrichment + result(still unenriched) stays awaiting-enrichment", () => {
    let s = nextPollState(initialPollState(), { type: "result", entry: { enrichedAt: null } });
    s = nextPollState(s, { type: "result", entry: { enrichedAt: null } });
    expect(s.phase).toBe("awaiting-enrichment");
  });

  it("awaiting-entry times out once ticks pass ENTRY_TIMEOUT_MS", () => {
    let s = initialPollState();
    s = nextPollState(s, { type: "tick", elapsedMs: ENTRY_TIMEOUT_MS - 1 });
    expect(s.phase).toBe("awaiting-entry");
    s = nextPollState(s, { type: "tick", elapsedMs: ENTRY_TIMEOUT_MS });
    expect(s.phase).toBe("timed-out");
  });

  it("awaiting-enrichment reaches done when the enrichment budget expires (measured from landing)", () => {
    let s = initialPollState();
    s = nextPollState(s, { type: "tick", elapsedMs: 4000 });
    s = nextPollState(s, { type: "result", entry: { enrichedAt: null } });
    expect(s.entryLandedAtMs).toBe(4000);
    // Not yet — budget is from 4000, not from 0.
    s = nextPollState(s, { type: "tick", elapsedMs: 4000 + ENRICHMENT_BUDGET_MS - 1 });
    expect(s.phase).toBe("awaiting-enrichment");
    s = nextPollState(s, { type: "tick", elapsedMs: 4000 + ENRICHMENT_BUDGET_MS });
    expect(s.phase).toBe("done");
  });

  it("terminal phases no-op on any event", () => {
    const done: PollState = { phase: "done", elapsedMs: 5000, entryLandedAtMs: 1000 };
    expect(nextPollState(done, { type: "tick", elapsedMs: 99999 })).toBe(done);
    expect(nextPollState(done, { type: "result", entry: { enrichedAt: null } })).toBe(done);

    const timedOut: PollState = { phase: "timed-out", elapsedMs: ENTRY_TIMEOUT_MS, entryLandedAtMs: null };
    expect(nextPollState(timedOut, { type: "tick", elapsedMs: 99999 })).toBe(timedOut);
    expect(
      nextPollState(timedOut, { type: "result", entry: { enrichedAt: "2026-07-25T00:00:00Z" } }),
    ).toBe(timedOut);
  });
});

describe("shouldPoll", () => {
  it("polls while awaiting entry or enrichment, stops in terminal phases", () => {
    expect(shouldPoll("awaiting-entry")).toBe(true);
    expect(shouldPoll("awaiting-enrichment")).toBe(true);
    expect(shouldPoll("done")).toBe(false);
    expect(shouldPoll("timed-out")).toBe(false);
  });
});

describe("POLL_INTERVAL_MS", () => {
  it("is 2000ms", () => {
    expect(POLL_INTERVAL_MS).toBe(2000);
  });
});

describe("stuckNote", () => {
  it("timed-out + pending → safe/will-retry", () => {
    expect(stuckNote({ phase: "timed-out", pendingRecordExists: true })).toEqual({
      tone: "amber",
      text: "This entry is safe on this device and will retry automatically.",
    });
  });

  it("timed-out + no pending → honest couldn't-confirm", () => {
    expect(stuckNote({ phase: "timed-out", pendingRecordExists: false })).toEqual({
      tone: "amber",
      text: "We couldn't confirm this entry saved — check your connection and reopen the app.",
    });
  });

  it("done + pending → audio still uploading", () => {
    expect(stuckNote({ phase: "done", pendingRecordExists: true })).toEqual({
      tone: "amber",
      text: "Audio is still uploading — it will retry automatically.",
    });
  });

  it("done + no pending → no note", () => {
    expect(stuckNote({ phase: "done", pendingRecordExists: false })).toBeNull();
  });

  it("non-terminal phases → no note", () => {
    expect(stuckNote({ phase: "awaiting-entry", pendingRecordExists: false })).toBeNull();
    expect(stuckNote({ phase: "awaiting-enrichment", pendingRecordExists: true })).toBeNull();
  });
});
