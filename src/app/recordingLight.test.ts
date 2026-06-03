import { describe, it, expect } from "vitest";
import { recordingLight } from "./recordingLight";

// Stoplight metaphor for the recorder, ON-AIR studio convention:
//   green = ready/standby, orange = transitioning, red = live recording.
describe("recordingLight", () => {
  it("is green / Ready when idle (cleared to record)", () => {
    expect(recordingLight("idle")).toEqual({ lamp: "green", label: "Ready" });
  });

  it("is orange while connecting (hold on, transitioning)", () => {
    expect(recordingLight("connecting")).toEqual({ lamp: "orange", label: "Connecting…" });
  });

  it("is red / Live while live (on air)", () => {
    expect(recordingLight("live")).toEqual({ lamp: "red", label: "Live" });
  });

  it("is orange while stopping", () => {
    expect(recordingLight("stopping").lamp).toBe("orange");
  });

  it("returns to green on error (ready to retry; the error text carries the detail)", () => {
    expect(recordingLight("error").lamp).toBe("green");
  });
});
