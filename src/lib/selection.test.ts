import { describe, it, expect } from "vitest";
import { batchStillActive, selectAll, summarizeBatch, toggleSelected } from "./selection";

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

describe("selectAll", () => {
  it("builds a set containing every id", () => {
    expect(selectAll(["a", "b", "c"])).toEqual(new Set(["a", "b", "c"]));
  });

  it("handles no ids", () => {
    expect(selectAll([])).toEqual(new Set());
  });

  it("dedupes repeated ids", () => {
    expect(selectAll(["a", "a", "b"])).toEqual(new Set(["a", "b"]));
  });
});

describe("summarizeBatch", () => {
  it("reports full success with no message and an empty failed set", () => {
    const outcome = summarizeBatch(3, [], "move");
    expect(outcome.message).toBeNull();
    expect(outcome.failed).toEqual(new Set());
  });

  it("reports partial failure with a pluralized count message and the failed ids", () => {
    const outcome = summarizeBatch(5, ["b", "d"], "trash");
    expect(outcome.message).toBe("2 of 5 entries failed to trash.");
    expect(outcome.failed).toEqual(new Set(["b", "d"]));
  });

  it("reports total failure", () => {
    const outcome = summarizeBatch(2, ["a", "b"], "move");
    expect(outcome.message).toBe("2 of 2 entries failed to move.");
    expect(outcome.failed).toEqual(new Set(["a", "b"]));
  });

  it("reports success trivially for an empty batch", () => {
    const outcome = summarizeBatch(0, [], "trash");
    expect(outcome.message).toBeNull();
    expect(outcome.failed).toEqual(new Set());
  });
});

describe("batchStillActive", () => {
  it("is active when the generation hasn't moved since the batch started", () => {
    expect(batchStillActive(1, 1)).toBe(true);
  });

  it("is inactive once the generation has advanced (select mode was exited mid-batch)", () => {
    expect(batchStillActive(1, 2)).toBe(false);
  });

  it("stays inactive no matter how far the generation has advanced", () => {
    expect(batchStillActive(0, 5)).toBe(false);
  });
});
