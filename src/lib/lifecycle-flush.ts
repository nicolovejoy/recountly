// What a page-hide / visibility-hidden event should do (issue #23 Task 8,
// split for #38 continuous capture). Pure — reuses the same
// isCaptureBusy/isSaveBusy classification as the #29 tab-bar capture guard
// (guardBusy), since "can the user navigate away" and "what must we do before
// the tab dies" happen to share the same busy window.
//
// Two regimes, mutually exclusive by construction (isCaptureBusy takes
// precedence): a capture session in flight (connecting/live/paused) is
// ALWAYS "pause-persist" — backgrounding is a pause, never an implicit Done,
// so the handler pauses the session and refreshes a transcript-only
// IndexedDB draft with NO server POST (nothing is a new entry until Done —
// see the plan's "critical design tension" section). A Done already
// committed (status back to idle, saveState finishing/saving) is
// "save-flush" — the unchanged #23 keepalive-POST behavior, since by then
// Done really did happen and the flush is racing the POST settling, not
// racing Done itself.
import { isCaptureBusy, isSaveBusy, type RecorderStatus, type SaveState } from "./recorder-state";

export type HideAction = "none" | "pause-persist" | "save-flush";

export function hideAction(status: RecorderStatus, saveState: SaveState): HideAction {
  if (isCaptureBusy(status)) return "pause-persist";
  if (isSaveBusy(saveState)) return "save-flush";
  return "none";
}

export function shouldFlushOnHide(status: RecorderStatus, saveState: SaveState): boolean {
  return hideAction(status, saveState) !== "none";
}
