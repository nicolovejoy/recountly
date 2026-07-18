import { describe, it, expect } from "vitest";
import { savePayloadBytes, SAVE_BYTES_BUDGET } from "./payload-size";

describe("SAVE_BYTES_BUDGET", () => {
  it("is 4,000,000 bytes", () => {
    expect(SAVE_BYTES_BUDGET).toBe(4_000_000);
  });
});

describe("savePayloadBytes", () => {
  it("sums audio bytes alone when there are no photos", () => {
    expect(savePayloadBytes(1_000, [])).toBe(1_000);
  });

  it("sums photo bytes alone when audio is zero", () => {
    expect(savePayloadBytes(0, [500, 250, 125])).toBe(875);
  });

  it("sums audio plus every photo", () => {
    expect(savePayloadBytes(1_000, [500, 250])).toBe(1_750);
  });

  it("treats an empty photo list as zero contribution", () => {
    expect(savePayloadBytes(2_000, [])).toBe(2_000);
  });
});
