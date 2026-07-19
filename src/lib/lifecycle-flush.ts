// Whether a page-hide / visibility-hidden event (issue #23 Task 8) should
// force the pending save out NOW instead of waiting on the FLUSH_MS timer or
// a still-open POST. Pure — reuses the same isCaptureBusy/isSaveBusy
// classification as the #29 tab-bar capture guard (guardBusy), since the two
// concerns ("can the user navigate away" and "must we flush before the tab
// dies") happen to share the same busy window today. Kept as a separate,
// named predicate rather than an alias so the two can diverge later without
// surprising the other caller.
import { isCaptureBusy, isSaveBusy, type RecorderStatus, type SaveState } from "./recorder-state";

export function shouldFlushOnHide(status: RecorderStatus, saveState: SaveState): boolean {
  return isCaptureBusy(status) || isSaveBusy(saveState);
}
