import { describe, it, expect } from "vitest";
import { writtenAtIso } from "./written-at";

describe("writtenAtIso", () => {
  it("converts a YYYY-MM-DD date to an ISO timestamp on that local date", () => {
    const iso = writtenAtIso("1994-03-02");
    expect(iso).toBeDefined();
    // Local-noon anchoring: the round-trip must land on the same calendar day
    // in the local timezone, whatever that timezone is.
    const d = new Date(iso!);
    expect(d.getFullYear()).toBe(1994);
    expect(d.getMonth()).toBe(2); // March
    expect(d.getDate()).toBe(2);
  });

  it("returns undefined for blank or malformed input", () => {
    expect(writtenAtIso("")).toBeUndefined();
    expect(writtenAtIso("   ")).toBeUndefined();
    expect(writtenAtIso("not-a-date")).toBeUndefined();
    expect(writtenAtIso("1994-13-40")).toBeUndefined();
  });
});
