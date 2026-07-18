import { describe, it, expect } from "vitest";
import { planSave } from "./save-plan";

const BUDGET = 4_000_000;

describe("planSave", () => {
  it("is empty for an empty transcript", () => {
    expect(planSave("", 0, [], BUDGET)).toEqual({ kind: "empty" });
  });

  it("is empty for a whitespace-only transcript", () => {
    expect(planSave("   \n\t  ", 1_000, [], BUDGET)).toEqual({ kind: "empty" });
  });

  it("empty wins even when bytes are also over budget", () => {
    expect(planSave("   ", BUDGET + 1, [], BUDGET)).toEqual({ kind: "empty" });
  });

  it("saves when total bytes are exactly at budget", () => {
    expect(planSave("hello", BUDGET, [], BUDGET)).toEqual({ kind: "save" });
  });

  it("is too-large when total bytes are one byte over budget", () => {
    expect(planSave("hello", BUDGET + 1, [], BUDGET)).toEqual({
      kind: "too-large",
      totalBytes: BUDGET + 1,
    });
  });

  it("saves for a normal transcript well under budget", () => {
    expect(planSave("hello world", 1_000, [500], BUDGET)).toEqual({ kind: "save" });
  });

  it("sums photos-only bytes against the budget", () => {
    expect(planSave("hello", 0, [BUDGET, 1], BUDGET)).toEqual({
      kind: "too-large",
      totalBytes: BUDGET + 1,
    });
  });

  it("sums audio and photos together against the budget", () => {
    expect(planSave("hello", 2_000_000, [1_000_000, 1_000_001], BUDGET)).toEqual({
      kind: "too-large",
      totalBytes: 4_000_001,
    });
  });
});
