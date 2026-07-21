import { describe, it, expect } from "vitest";
import {
  transition,
  RECORDER_STATUSES,
  RECORDER_EVENTS,
  type RecorderStatus,
  type RecorderEvent,
} from "./recorder-state";

// Exhaustive table-driven spec: every (status, event) pair has an expected
// outcome. Pairs not listed in TRANSITIONS are no-ops (the status is returned
// unchanged) — transition is a total function and never throws, so a stray
// dispatch from an async callback can't corrupt the recorder.
//
// `paused` and its PAUSE/RESUME edges are specified NOW, ahead of the
// pause/resume feature (close-on-pause / reconnect-on-resume): resuming
// re-enters `connecting` and lands back in `live` via CONNECTED.

const TRANSITIONS: Array<[RecorderStatus, RecorderEvent, RecorderStatus]> = [
  ["idle", "START", "connecting"], // tap record
  ["error", "START", "connecting"], // retry after a failure
  ["connecting", "CONNECTED", "live"], // data channel opened
  ["connecting", "DONE", "idle"], // Esc/stop mid-connect (gen-counter cancel)
  ["connecting", "FAIL", "error"], // connect threw
  // #38: backgrounding while still connecting (dc not open yet) is ALSO a
  // pause, not a cancel — the fire() handler calls pause() for both
  // live/connecting statuses (see lifecycle-flush's "pause-persist"), and
  // pause() must land somewhere resumable rather than get stuck at
  // "connecting" forever (primaryAction("connecting") is "cancel", which
  // would wrongly finalize/save on the next tap instead of resuming).
  ["connecting", "PAUSE", "paused"],
  ["live", "PAUSE", "paused"], // future: close pc, bank elapsed
  ["live", "DONE", "idle"], // finish — distinct from pause
  ["live", "FAIL", "error"], // mid-session error
  ["paused", "RESUME", "connecting"], // future: reconnect, CONNECTED → live
  ["paused", "DONE", "idle"], // finish from paused
];

describe("transition", () => {
  it.each(TRANSITIONS)("%s + %s → %s", (from, event, to) => {
    expect(transition(from, event)).toBe(to);
  });

  it("treats every unlisted (status, event) pair as a no-op", () => {
    for (const status of RECORDER_STATUSES) {
      for (const event of RECORDER_EVENTS) {
        const listed = TRANSITIONS.find(([s, e]) => s === status && e === event);
        if (!listed) {
          expect(transition(status, event), `${status} + ${event}`).toBe(status);
        }
      }
    }
  });

  it("covers the full resume round-trip: paused → connecting → live", () => {
    const resumed = transition(transition("paused", "RESUME"), "CONNECTED");
    expect(resumed).toBe("live");
  });
});

// primaryAction maps the current status to what the one circular button does
// when tapped — the single source of truth for the control, so an ambiguous
// affordance (the old "no-text" bug's root cause) can't creep back in.
import { primaryAction } from "./recorder-state";

describe("primaryAction", () => {
  it.each([
    ["idle", "start"],
    ["error", "start"],
    ["connecting", "cancel"],
    ["live", "pause"],
    ["paused", "resume"],
  ] as const)("%s → %s", (status, action) => {
    expect(primaryAction(status)).toBe(action);
  });
});

// #38 continuous capture: tapping the one circular control while a session
// is paused (whether the user paused manually or it was backgrounded into a
// pause-persist draft — see lifecycle-flush's hideAction) resumes, never
// starts a fresh entry. This is the tested contract "record-while-paused
// resumes the same entry" leans on: primaryAction never routes a paused
// status to "start", and RecorderClient's entryIdRef is left untouched across
// a pause (only a full-refs 201 save clears it), so calling the hook's
// resume() from this status reconnects into the SAME banked timer/transcript
// instead of minting a new one.
describe("primaryAction (#38: record-while-paused resumes the same entry)", () => {
  it("routes a paused status to resume, never start", () => {
    expect(primaryAction("paused")).toBe("resume");
    expect(primaryAction("paused")).not.toBe("start");
  });
});

// isCaptureBusy feeds the #29 tab-bar capture guard: while a session is in
// flight (connecting/live/paused), navigating away would unmount the recorder
// and kill the session, so the other tabs are disabled.
import { isCaptureBusy } from "./recorder-state";

describe("isCaptureBusy", () => {
  it.each([
    ["idle", false],
    ["connecting", true],
    ["live", true],
    ["paused", true],
    ["error", false],
  ] as const)("%s → %s", (status, busy) => {
    expect(isCaptureBusy(status)).toBe(busy);
  });

  it("covers every status", () => {
    // Exhaustiveness: a new status added to the machine must be classified.
    for (const status of RECORDER_STATUSES) {
      expect(typeof isCaptureBusy(status)).toBe("boolean");
    }
  });
});

// isSaveBusy extends the #29 guard to the save pipeline: between Done and the
// POST settling ("finishing"/"saving"), navigating away unmounts the recorder
// page and silently loses a failed save's transcript. "error" is NOT busy —
// the failure toast is visible by then, so leaving is an informed choice, and
// disabling tabs on error would trap the user on the capture page.
import { isSaveBusy, guardBusy, SAVE_STATES } from "./recorder-state";

describe("isSaveBusy", () => {
  it.each([
    ["idle", false],
    ["finishing", true],
    ["saving", true],
    ["saved", false],
    ["error", false],
  ] as const)("%s → %s", (saveState, busy) => {
    expect(isSaveBusy(saveState)).toBe(busy);
  });

  it("covers every save state", () => {
    // Exhaustiveness: a new save state must be classified.
    for (const saveState of SAVE_STATES) {
      expect(typeof isSaveBusy(saveState)).toBe("boolean");
    }
  });
});

// guardBusy is what the capture-guard effect actually feeds the tab bar: busy
// if EITHER the session or a save is in flight.
describe("guardBusy", () => {
  it("is busy when only the session is in flight", () => {
    expect(guardBusy("live", "idle")).toBe(true);
  });

  it("is busy when only a save is in flight", () => {
    expect(guardBusy("idle", "finishing")).toBe(true);
    expect(guardBusy("idle", "saving")).toBe(true);
  });

  it("is idle when neither is in flight", () => {
    expect(guardBusy("idle", "idle")).toBe(false);
    expect(guardBusy("idle", "saved")).toBe(false);
    expect(guardBusy("error", "error")).toBe(false);
  });

  it("matches isCaptureBusy || isSaveBusy over the full product", () => {
    for (const status of RECORDER_STATUSES) {
      for (const saveState of SAVE_STATES) {
        expect(guardBusy(status, saveState), `${status} × ${saveState}`).toBe(
          isCaptureBusy(status) || isSaveBusy(saveState),
        );
      }
    }
  });
});
