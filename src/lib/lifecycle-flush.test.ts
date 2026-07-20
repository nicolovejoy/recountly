import { describe, it, expect } from "vitest";
import { hideAction, shouldFlushOnHide } from "./lifecycle-flush";
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

// hideAction (#38) splits shouldFlushOnHide's single boolean into WHICH regime
// applies: a capture session in flight is always a "pause-persist" (IDB draft
// only, no server POST — nothing is a new entry until Done); a Done already
// committed (status back to idle, saveState finishing/saving) is the
// unchanged "save-flush" keepalive POST from #23 Task 8. Capture-in-flight
// takes precedence over a save in flight whenever both could apply, since a
// live/connecting/paused status means Done hasn't actually landed yet.
describe("hideAction", () => {
  it.each([
    ["idle", "idle", "none"],
    ["connecting", "idle", "pause-persist"],
    ["live", "idle", "pause-persist"],
    ["paused", "idle", "pause-persist"],
    ["error", "idle", "none"],
    ["idle", "finishing", "save-flush"],
    ["idle", "saving", "save-flush"],
    ["idle", "saved", "none"],
    ["idle", "error", "none"],
    ["live", "finishing", "pause-persist"], // capture-in-flight wins over a save in flight
    // Edge case (theoretically unreachable in practice — Done's stop() drives
    // status to idle synchronously before saveState leaves "idle" — but
    // documented per the plan): a still-paused status with a save somehow in
    // flight is classified as pause-persist, not save-flush.
    ["paused", "saving", "pause-persist"],
  ] as const)("status=%s saveState=%s → %s", (status, saveState, expected) => {
    expect(hideAction(status, saveState)).toBe(expected);
  });

  it("is pause-persist whenever isCaptureBusy(status), regardless of saveState", () => {
    for (const status of RECORDER_STATUSES) {
      if (!isCaptureBusy(status)) continue;
      for (const saveState of SAVE_STATES) {
        expect(hideAction(status, saveState), `${status} × ${saveState}`).toBe("pause-persist");
      }
    }
  });

  it("is save-flush only when capture is idle/error and a save is in flight", () => {
    for (const status of RECORDER_STATUSES) {
      if (isCaptureBusy(status)) continue;
      for (const saveState of SAVE_STATES) {
        const expected = isSaveBusy(saveState) ? "save-flush" : "none";
        expect(hideAction(status, saveState), `${status} × ${saveState}`).toBe(expected);
      }
    }
  });

  it("shouldFlushOnHide is exactly hideAction(...) !== \"none\" over the full product", () => {
    for (const status of RECORDER_STATUSES) {
      for (const saveState of SAVE_STATES) {
        expect(shouldFlushOnHide(status, saveState), `${status} × ${saveState}`).toBe(
          hideAction(status, saveState) !== "none",
        );
      }
    }
  });

  it("covers every (status, saveState) pair without throwing", () => {
    for (const status of RECORDER_STATUSES as readonly RecorderStatus[]) {
      for (const saveState of SAVE_STATES as readonly SaveState[]) {
        expect(["none", "pause-persist", "save-flush"]).toContain(hideAction(status, saveState));
      }
    }
  });
});
