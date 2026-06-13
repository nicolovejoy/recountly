// Pure recorder state machine (unit-tested in recorder-state.test.ts) — no
// React, no DOM. The single source of truth for which status changes are
// legal; the component dispatches events via setStatus((s) => transition(s, E))
// so async callbacks (data-channel open, catch blocks) can never act on a
// stale status or force an illegal jump.
//
// `paused` + PAUSE/RESUME exist ahead of the pause/resume feature
// (close-connection-on-pause / reconnect-on-resume): RESUME deliberately
// re-enters `connecting` and lands back in `live` via CONNECTED. Timer
// accumulation across pauses is the hook's job (totalElapsedSec), not the
// machine's.

export const RECORDER_STATUSES = [
  "idle",
  "connecting",
  "live",
  "paused",
  "error",
] as const;
export type RecorderStatus = (typeof RECORDER_STATUSES)[number];

export const RECORDER_EVENTS = [
  "START", // tap record (from idle, or retry from error)
  "CONNECTED", // data channel opened
  "PAUSE", // future: suspend — close pc, bank elapsed
  "RESUME", // future: reconnect from paused
  "DONE", // finish/stop — also cancels a connect in flight
  "FAIL", // connect threw or mid-session error
] as const;
export type RecorderEvent = (typeof RECORDER_EVENTS)[number];

// Total function: unlisted (status, event) pairs are no-ops, never throws.
export function transition(status: RecorderStatus, event: RecorderEvent): RecorderStatus {
  switch (status) {
    case "idle":
      if (event === "START") return "connecting";
      break;
    case "connecting":
      if (event === "CONNECTED") return "live";
      if (event === "DONE") return "idle";
      if (event === "FAIL") return "error";
      break;
    case "live":
      if (event === "PAUSE") return "paused";
      if (event === "DONE") return "idle";
      if (event === "FAIL") return "error";
      break;
    case "paused":
      if (event === "RESUME") return "connecting";
      if (event === "DONE") return "idle";
      break;
    case "error":
      if (event === "START") return "connecting";
      break;
  }
  return status;
}

// What the one circular control does when tapped, per status — the single
// source of truth for the primary affordance. "cancel" aborts an in-flight
// connect (treated as DONE by the machine). Keeping this here, beside the
// transition table and unit-tested, is what stops the control from going
// ambiguous again (the old "no-text" bug's root cause was a control that
// didn't reliably start a recording).
export type PrimaryAction = "start" | "cancel" | "pause" | "resume";

export function primaryAction(status: RecorderStatus): PrimaryAction {
  switch (status) {
    case "idle":
    case "error":
      return "start";
    case "connecting":
      return "cancel";
    case "live":
      return "pause";
    case "paused":
      return "resume";
  }
}
