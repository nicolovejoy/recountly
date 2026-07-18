import { describe, it, expect } from "vitest";
import { planDownscale, PHOTO_MAX_DIM, PHOTO_JPEG_QUALITY } from "./image";

describe("planDownscale", () => {
  it("scales the long edge down to maxDim, preserving aspect ratio", () => {
    expect(planDownscale(4032, 3024, 2048)).toEqual({ width: 2048, height: 1536 });
    expect(planDownscale(3024, 4032, 2048)).toEqual({ width: 1536, height: 2048 });
  });

  it("never upscales — small images keep their dimensions", () => {
    expect(planDownscale(1200, 900, 2048)).toEqual({ width: 1200, height: 900 });
    expect(planDownscale(2048, 2048, 2048)).toEqual({ width: 2048, height: 2048 });
  });

  it("rounds to whole pixels", () => {
    const { width, height } = planDownscale(4000, 3001, 2048);
    expect(Number.isInteger(width)).toBe(true);
    expect(Number.isInteger(height)).toBe(true);
    expect(width).toBe(2048);
    expect(height).toBe(1537); // 3001 * (2048/4000) = 1536.512 → round
  });

  it("defaults maxDim to PHOTO_MAX_DIM", () => {
    expect(planDownscale(5000, 5000)).toEqual({
      width: PHOTO_MAX_DIM,
      height: PHOTO_MAX_DIM,
    });
  });

  it("exports the agreed JPEG quality", () => {
    expect(PHOTO_JPEG_QUALITY).toBe(0.85);
  });
});
