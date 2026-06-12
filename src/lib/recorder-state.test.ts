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
