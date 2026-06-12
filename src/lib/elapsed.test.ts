import { describe, it, expect } from "vitest";
import { formatElapsed } from "./elapsed";

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
