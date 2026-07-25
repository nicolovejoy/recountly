import { describe, it, expect } from "vitest";
import { suggestNextPageLabel, savedPageLabel } from "./page-label";

describe("suggestNextPageLabel", () => {
  it("passes the last label straight through (no parse/increment)", () => {
    expect(suggestNextPageLabel("pp. 14–16")).toBe("pp. 14–16");
  });

  it("trims surrounding whitespace", () => {
    expect(suggestNextPageLabel("  p. 3  ")).toBe("p. 3");
  });

  it("returns empty for null/undefined/blank", () => {
    expect(suggestNextPageLabel(null)).toBe("");
    expect(suggestNextPageLabel(undefined)).toBe("");
    expect(suggestNextPageLabel("   ")).toBe("");
  });
});

describe("savedPageLabel", () => {
  it("returns the trimmed label under a journal", () => {
    expect(savedPageLabel("01JRNL", "  pp. 14–16 ")).toBe("pp. 14–16");
  });

  it("returns undefined for a blank label", () => {
    expect(savedPageLabel("01JRNL", "   ")).toBeUndefined();
    expect(savedPageLabel("01JRNL", "")).toBeUndefined();
  });

  it("returns undefined when there is no journal (Unfiled)", () => {
    expect(savedPageLabel(undefined, "pp. 14–16")).toBeUndefined();
  });
});
