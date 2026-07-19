import { describe, it, expect } from "vitest";
import { toggleSelected } from "./selection";

describe("toggleSelected", () => {
  it("adds an id not yet in the set, returning a new set", () => {
    const before = new Set(["a"]);
    const after = toggleSelected(before, "b");
    expect(after).toEqual(new Set(["a", "b"]));
    expect(after).not.toBe(before); // immutable — before is untouched
    expect(before).toEqual(new Set(["a"]));
  });

  it("removes an id already in the set", () => {
    const after = toggleSelected(new Set(["a", "b"]), "a");
    expect(after).toEqual(new Set(["b"]));
  });

  it("handles an empty set", () => {
    expect(toggleSelected(new Set(), "a")).toEqual(new Set(["a"]));
  });
});
