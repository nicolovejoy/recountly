// Post-save placeholder + polling state machine (issue #54). After Done, the
// client navigates STRAIGHT to /entry/<id>?saved=1 before the row exists —
// the save POST is still in flight (and enrichment runs in an after() hook
// server-side, so title/summary/tags land a beat later still). This module is
// the pure, node-testable brain of that detail page: a cycling placeholder
// status line, a phase machine the poll loop advances on each fetch/tick, and
// the honest amber notes shown when something never confirms. No React, DOM,
// or network here — EntryDetail wires the effects (see src/app/EntryDetail.tsx).

// The placeholder cycles these while awaiting the entry, so the wait reads as
// progress rather than a hang. Order mirrors the real save pipeline.
const PLACEHOLDER_LINES = [
  "Finishing transcription…",
  "Uploading audio…",
  "Saving…",
];
const PLACEHOLDER_INTERVAL_MS = 2500;

export function placeholderStatusLine(elapsedMs: number): string {
  const i = Math.floor(Math.max(0, elapsedMs) / PLACEHOLDER_INTERVAL_MS) % PLACEHOLDER_LINES.length;
  return PLACEHOLDER_LINES[i];
}

// How often EntryDetail re-fetches the entry while polling.
export const POLL_INTERVAL_MS = 2000;
// Give up waiting for the row itself after this long — a save that hasn't
// landed by now didn't reach the DB (network drop, 5xx, discarded tab).
export const ENTRY_TIMEOUT_MS = 30_000;
// Once the row lands, keep polling this much longer for enrichment (title/
// summary/tags) to pop in; then stop and show the entry as-is (enrichment is
// best-effort — an entry with no enrichment is still complete).
export const ENRICHMENT_BUDGET_MS = 15_000;

export type PollPhase = "awaiting-entry" | "awaiting-enrichment" | "done" | "timed-out";

export interface PollState {
  phase: PollPhase;
  // Last elapsed-since-arrival reading, updated on every tick. Carried so a
  // `result` event (which doesn't carry the clock) can stamp entryLandedAtMs.
  elapsedMs: number;
  // Elapsed reading at the moment the row first landed; null until then. The
  // enrichment budget is measured from here, not from page open.
  entryLandedAtMs: number | null;
}

export function initialPollState(): PollState {
  return { phase: "awaiting-entry", elapsedMs: 0, entryLandedAtMs: null };
}

export type PollEvent =
  | { type: "tick"; elapsedMs: number }
  | { type: "result"; entry: { enrichedAt: string | null } | null };

export function nextPollState(state: PollState, event: PollEvent): PollState {
  // Terminal phases never move again — a stray late tick/result is a no-op.
  if (state.phase === "done" || state.phase === "timed-out") return state;

  if (event.type === "tick") {
    const elapsedMs = event.elapsedMs;
    if (state.phase === "awaiting-entry") {
      if (elapsedMs >= ENTRY_TIMEOUT_MS) {
        return { ...state, elapsedMs, phase: "timed-out" };
      }
      return { ...state, elapsedMs };
    }
    // awaiting-enrichment: budget runs from when the row landed.
    if (state.entryLandedAtMs != null && elapsedMs - state.entryLandedAtMs >= ENRICHMENT_BUDGET_MS) {
      return { ...state, elapsedMs, phase: "done" };
    }
    return { ...state, elapsedMs };
  }

  // result
  const enriched = event.entry != null && event.entry.enrichedAt != null;
  if (state.phase === "awaiting-entry") {
    if (event.entry == null) return state; // still 404 — keep waiting
    if (enriched) return { ...state, phase: "done" };
    return { ...state, phase: "awaiting-enrichment", entryLandedAtMs: state.elapsedMs };
  }
  // awaiting-enrichment
  if (enriched) return { ...state, phase: "done" };
  return state;
}

export function shouldPoll(phase: PollPhase): boolean {
  return phase === "awaiting-entry" || phase === "awaiting-enrichment";
}

// The honest amber banner for the terminal states. `pendingRecordExists` is
// whether IndexedDB still holds a pending-save record for this id (the durable
// #23 net) — when it does, the entry is safe locally and will retry, so we say
// so rather than alarm the user.
export function stuckNote(input: {
  phase: PollPhase;
  pendingRecordExists: boolean;
}): { tone: "amber"; text: string } | null {
  const { phase, pendingRecordExists } = input;
  if (phase === "timed-out") {
    return {
      tone: "amber",
      text: pendingRecordExists
        ? "This entry is safe on this device and will retry automatically."
        : "We couldn't confirm this entry saved — check your connection and reopen the app.",
    };
  }
  if (phase === "done" && pendingRecordExists) {
    return { tone: "amber", text: "Audio is still uploading — it will retry automatically." };
  }
  return null;
}
