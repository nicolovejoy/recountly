import { describe, it, expect } from "vitest";
import { recordingLight } from "./recordingLight";

// Stoplight metaphor for the recorder, ON-AIR studio convention:
//   green = ready/standby, amber = transitioning, red = live recording.
describe("recordingLight", () => {
  it("is green / Ready when idle (cleared to record)", () => {
    expect(recordingLight("idle")).toEqual({ lamp: "green", label: "Ready" });
  });

  it("is amber while connecting (hold on, transitioning)", () => {
    expect(recordingLight("connecting")).toEqual({ lamp: "amber", label: "Connecting…" });
  });

  it("is red / Recording while live (on air)", () => {
    expect(recordingLight("live")).toEqual({ lamp: "red", label: "Recording" });
  });

  it("is amber while stopping", () => {
    expect(recordingLight("stopping").lamp).toBe("amber");
  });

  it("returns to green on error (ready to retry; the error text carries the detail)", () => {
    expect(recordingLight("error").lamp).toBe("green");
  });
});
