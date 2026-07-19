import { describe, it, expect } from "vitest";
import { planSave } from "./save-plan";

describe("planSave", () => {
  it("is empty for an empty transcript", () => {
    expect(planSave("")).toEqual({ kind: "empty" });
  });

  it("is empty for a whitespace-only transcript", () => {
    expect(planSave("   \n\t  ")).toEqual({ kind: "empty" });
  });

  it("saves for a normal transcript", () => {
    expect(planSave("hello world")).toEqual({ kind: "save" });
  });

  it("saves when the transcript has surrounding whitespace but real content", () => {
    expect(planSave("  hi  ")).toEqual({ kind: "save" });
  });
});
