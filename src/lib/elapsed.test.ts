import { describe, it, expect } from "vitest";
import { formatElapsed, totalElapsedSec } from "./elapsed";

describe("formatElapsed", () => {
  it("formats zero as 0:00", () => {
    expect(formatElapsed(0)).toBe("0:00");
  });

  it("zero-pads seconds under ten", () => {
    expect(formatElapsed(7)).toBe("0:07");
  });

  it("rolls seconds into minutes", () => {
    expect(formatElapsed(65)).toBe("1:05");
  });

  it("keeps two-digit seconds", () => {
    expect(formatElapsed(600)).toBe("10:00");
  });

  it("does not cap minutes (long entries are fine)", () => {
    expect(formatElapsed(3661)).toBe("61:01");
  });

  it("floors fractional seconds", () => {
    expect(formatElapsed(12.9)).toBe("0:12");
  });

  it("treats negatives as zero", () => {
    expect(formatElapsed(-5)).toBe("0:00");
  });
});

// Cumulative recording time across pause/resume cycles: accumulatedMs holds
// the total of all finished segments; segmentStartMs is the epoch-ms start of
// the currently-running segment, or null while paused/idle. now is injected
// so the math is deterministic.
describe("totalElapsedSec", () => {
  const T0 = 1_750_000_000_000; // arbitrary epoch base

  it("is zero before anything has been recorded", () => {
    expect(totalElapsedSec(0, null, T0)).toBe(0);
  });

  it("counts only the running segment on a first recording", () => {
    expect(totalElapsedSec(0, T0, T0 + 5_000)).toBe(5);
  });

  it("counts only the accumulator while paused (no running segment)", () => {
    expect(totalElapsedSec(83_000, null, T0)).toBe(83);
  });

  it("adds the running segment on top of previously banked time", () => {
    expect(totalElapsedSec(60_000, T0, T0 + 2_500)).toBe(62);
  });

  it("floors to whole seconds", () => {
    expect(totalElapsedSec(0, T0, T0 + 1_999)).toBe(1);
  });

  it("clamps clock skew (now before segment start) to the banked time", () => {
    expect(totalElapsedSec(10_000, T0 + 5_000, T0)).toBe(10);
  });
});
