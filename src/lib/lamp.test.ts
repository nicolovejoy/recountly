import { describe, expect, it } from "vitest";
import { RECORDER_STATUSES } from "./recorder-state";
import { lampStyle } from "./lamp";

describe("lampStyle", () => {
  it("covers every recorder status", () => {
    for (const status of RECORDER_STATUSES) {
      expect(() => lampStyle(status)).not.toThrow();
    }
  });

  it("live is the only steady bright-red state", () => {
    expect(lampStyle("live")).toMatchObject({ bg: "bg-red-600", text: "text-white", pulse: false });
  });

  it("paused is blinking red", () => {
    const style = lampStyle("paused");
    expect(style.bg).toBe("bg-red-600");
    expect(style.pulse).toBe(true);
  });

  it("connecting is neutral, not red (affordance rule: red == capturing only)", () => {
    const style = lampStyle("connecting");
    expect(style.bg).not.toMatch(/red/);
    expect(style.pulse).toBe(false);
  });

  it("idle and error are muted green, not bright", () => {
    for (const status of ["idle", "error"] as const) {
      const style = lampStyle(status);
      expect(style.bg).toMatch(/green/);
      expect(style.bg).toMatch(/\/\d+$/); // opacity-muted, not a solid fill
      expect(style.pulse).toBe(false);
    }
  });
});
