import { describe, it, expect } from "vitest";
import { parseRange } from "./range";

describe("parseRange", () => {
  it("is none for no header", () => {
    expect(parseRange(null, 100)).toEqual({ type: "none" });
    expect(parseRange(undefined, 100)).toEqual({ type: "none" });
  });

  it("is none for a malformed header", () => {
    expect(parseRange("nonsense", 100)).toEqual({ type: "none" });
    expect(parseRange("items=0-10", 100)).toEqual({ type: "none" });
    expect(parseRange("bytes=-", 100)).toEqual({ type: "none" });
  });

  it("parses a full start-end range", () => {
    expect(parseRange("bytes=0-1", 100)).toEqual({ type: "satisfiable", start: 0, end: 1 });
    expect(parseRange("bytes=10-20", 100)).toEqual({ type: "satisfiable", start: 10, end: 20 });
  });

  it("parses an open-ended range to the end of the resource", () => {
    expect(parseRange("bytes=90-", 100)).toEqual({ type: "satisfiable", start: 90, end: 99 });
  });

  it("parses a suffix range as the last N bytes", () => {
    expect(parseRange("bytes=-10", 100)).toEqual({ type: "satisfiable", start: 90, end: 99 });
  });

  it("clamps a suffix range longer than the resource to the whole thing", () => {
    expect(parseRange("bytes=-500", 100)).toEqual({ type: "satisfiable", start: 0, end: 99 });
  });

  it("clamps an end beyond the resource size", () => {
    expect(parseRange("bytes=50-1000", 100)).toEqual({ type: "satisfiable", start: 50, end: 99 });
  });

  it("is unsatisfiable when start is beyond the resource size", () => {
    expect(parseRange("bytes=200-300", 100)).toEqual({ type: "unsatisfiable" });
  });

  it("is unsatisfiable when start > end", () => {
    expect(parseRange("bytes=50-10", 100)).toEqual({ type: "unsatisfiable" });
  });

  it("is unsatisfiable for a zero-length suffix", () => {
    expect(parseRange("bytes=-0", 100)).toEqual({ type: "unsatisfiable" });
  });

  it("is unsatisfiable against a zero-size resource", () => {
    expect(parseRange("bytes=0-0", 0)).toEqual({ type: "unsatisfiable" });
  });
});
