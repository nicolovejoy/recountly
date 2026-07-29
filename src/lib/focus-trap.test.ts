import { describe, it, expect } from "vitest";
import { wrapIndex } from "./focus-trap";

describe("wrapIndex", () => {
  it("moves forward on Tab", () => {
    expect(wrapIndex(0, 2, false)).toBe(1);
  });

  it("wraps forward from the last element back to the first", () => {
    expect(wrapIndex(1, 2, false)).toBe(0);
  });

  it("moves backward on Shift+Tab", () => {
    expect(wrapIndex(1, 2, true)).toBe(0);
  });

  it("wraps backward from the first element to the last", () => {
    expect(wrapIndex(0, 2, true)).toBe(1);
  });

  it("wraps in a larger trap forward at the end", () => {
    expect(wrapIndex(2, 3, false)).toBe(0);
  });

  it("wraps in a larger trap backward at the start", () => {
    expect(wrapIndex(0, 3, true)).toBe(2);
  });

  it("returns 0 for an empty trap", () => {
    expect(wrapIndex(0, 0, false)).toBe(0);
    expect(wrapIndex(0, 0, true)).toBe(0);
  });
});
