import { describe, it, expect } from "vitest";
import { shouldFlushOnHide } from "./lifecycle-flush";
import {
  RECORDER_STATUSES,
  SAVE_STATES,
  isCaptureBusy,
  isSaveBusy,
  type RecorderStatus,
  type SaveState,
} from "./recorder-state";

// shouldFlushOnHide decides whether a pagehide/visibilitychange-hidden event
// (issue #23 Task 8) should force the pending save out NOW instead of
// waiting on the FLUSH_MS timer or a still-open POST: true while a capture
// session is in flight OR a save is between Done and the POST settling.

describe("shouldFlushOnHide", () => {
  it.each([
    ["idle", "idle", false],
    ["connecting", "idle", true], // still capturing, Done not tapped
    ["live", "idle", true],
    ["paused", "idle", true],
    ["error", "idle", false],
    ["idle", "finishing", true], // Done tapped, flush window running
    ["idle", "saving", true], // POST in flight
    ["idle", "saved", false],
    ["idle", "error", false],
    ["live", "finishing", true], // both busy at once
  ] as const)("status=%s saveState=%s → %s", (status, saveState, expected) => {
    expect(shouldFlushOnHide(status, saveState)).toBe(expected);
  });

  it("matches isCaptureBusy(status) || isSaveBusy(saveState) over the full product", () => {
    for (const status of RECORDER_STATUSES) {
      for (const saveState of SAVE_STATES) {
        expect(shouldFlushOnHide(status, saveState), `${status} × ${saveState}`).toBe(
          isCaptureBusy(status) || isSaveBusy(saveState),
        );
      }
    }
  });

  it("covers every (status, saveState) pair without throwing", () => {
    for (const status of RECORDER_STATUSES as readonly RecorderStatus[]) {
      for (const saveState of SAVE_STATES as readonly SaveState[]) {
        expect(typeof shouldFlushOnHide(status, saveState)).toBe("boolean");
      }
    }
  });
});
