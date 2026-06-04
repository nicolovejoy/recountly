# Traditional Recorder Control Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the confusing "traffic-light-as-button" recorder control with the conventional voice-recorder pattern — one circular Record/Stop button, an elapsed timer, and a live mic-level bar — so it's instantly obvious how to record.

**Architecture:** A single centered circular `<button>` toggles record/stop (reusing the existing `start`/`stop`). When the session goes live it turns red with a pulsing ring and shows a stop square; a `REC m:ss` timer (driven by a `setInterval` off a start timestamp) and the existing analyser-driven level bar appear beside it. The stoplight module (`recordingLight`) is deleted. Timer formatting is a pure, unit-tested helper.

**Tech Stack:** Next.js 16 / React 19 / TypeScript / Tailwind CSS 4 / Vitest. No icon library — record dot and stop square are CSS shapes. Dev server runs on **port 8255** (`pnpm dev` → http://localhost:8255).

---

## Why traditional, and what we explicitly decided

- **The stoplight was clever, not clear.** A traffic light isn't a learned "record" affordance; users kept asking "what do I tap?". The round Record→Stop button + timer + waveform is the Voice Memos / Otter convention — zero learning, big phone tap target. We keep the studio "on-air" personality via the **red color + pulsing ring + live level bar**, not via a metaphor.
- **One control, contextual by state.** `idle`/`error` → red record dot ("Tap to record"); `connecting` → same button, "Connecting…" (a tap cancels, like Esc); `live` → red button + stop square + pulsing ring + `● REC m:ss` + level bar.
- **Timer over a start timestamp, not a tick counter.** Store `Date.now()` at go-live and recompute elapsed each interval — no drift.
- **Reuse the existing meter.** `startMeter`/`meterRef` already drive a `scaleX` bar from an `AnalyserNode`; we keep that wiring and just restyle/reposition the bar. No new audio code.
- **Delete `recordingLight`.** It only existed for the stoplight; its `RecordingStatus` type moves back inline into `RecorderClient`.

## Alternatives considered (rejected)

- **Minimal pill toggle** — keep the current full-width button, just fix labels/colors and add a timer + inline meter. Smallest diff, but it never reads as a "recorder," which is the whole problem. Rejected in favor of the iconic circle.
- **Press-and-hold (push-to-talk)** — hold to record, release to stop. Wrong for long-form journaling (you can't hold a button for minutes) and conflicts with hands-free + type-and-talk. Rejected.

## File Structure

- **Create** `src/app/elapsed.ts` — pure `formatElapsed(totalSeconds)` → `"m:ss"`. No React, no DOM. Unit-tested.
- **Create** `src/app/elapsed.test.ts` — Vitest unit tests for `formatElapsed`.
- **Modify** `src/app/RecorderClient.tsx` — restore the inline `Status` type; drop the `recordingLight` import + `light`; add `elapsedSec` state, `timerRef`, `recordStartRef`; start/stop the timer; replace the traffic-light button + meter + Esc-hint block with the circular control + live status row.
- **Delete** `src/app/recordingLight.ts` and `src/app/recordingLight.test.ts` — dead once the stoplight is gone.

---

### Task 1: Pure `formatElapsed` helper (TDD)

**Files:**
- Create: `src/app/elapsed.test.ts`
- Create: `src/app/elapsed.ts`

- [ ] **Step 1: Write the failing test**

Create `src/app/elapsed.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { formatElapsed } from "./elapsed";

describe("formatElapsed", () => {
  it("formats zero as 0:00", () => {
    expect(formatElapsed(0)).toBe("0:00");
  });

  it("zero-pads seconds under ten", () => {
    expect(formatElapsed(7)).toBe("0:07");
  });

  it("rolls seconds into minutes", () => {
    expect(formatElapsed(65)).toBe("1:05");
  });

  it("keeps two-digit seconds", () => {
    expect(formatElapsed(600)).toBe("10:00");
  });

  it("does not cap minutes (long entries are fine)", () => {
    expect(formatElapsed(3661)).toBe("61:01");
  });

  it("floors fractional seconds", () => {
    expect(formatElapsed(12.9)).toBe("0:12");
  });

  it("treats negatives as zero", () => {
    expect(formatElapsed(-5)).toBe("0:00");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test elapsed`
Expected: FAIL — Vitest cannot resolve `./elapsed` (module does not exist yet).

- [ ] **Step 3: Write the minimal implementation**

Create `src/app/elapsed.ts`:
```ts
// Pure timer formatter (unit-tested in elapsed.test.ts) — no React, no DOM.
// Formats an elapsed duration in whole seconds as "m:ss" (minutes are not
// zero-padded or capped; seconds always two digits). Negatives clamp to zero.
export function formatElapsed(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm test elapsed`
Expected: PASS — all 7 `formatElapsed` tests green.

- [ ] **Step 5: Commit**

```bash
git add src/app/elapsed.ts src/app/elapsed.test.ts
git commit -m "test: add formatElapsed timer helper

Pure m:ss formatter for the recorder's elapsed-time display."
```

---

### Task 2: Replace the recorder control + add the elapsed timer

**Files:**
- Modify: `src/app/RecorderClient.tsx`

Apply the edits in order; match on the quoted text (line numbers approximate).

- [ ] **Step 1: Swap the imports and restore the inline `Status` type**

Find:
```tsx
import { recordingLight, type RecordingStatus } from "./recordingLight";
```
Replace with:
```tsx
import { formatElapsed } from "./elapsed";
```

Then find:
```tsx
type Status = RecordingStatus;
```
Replace with:
```tsx
type Status = "idle" | "connecting" | "live" | "stopping" | "error";
```

- [ ] **Step 2: Add timer state and refs**

Find:
```tsx
  const [log, setLog] = useState<LogLine[]>([]);
```
Replace with:
```tsx
  const [log, setLog] = useState<LogLine[]>([]);
  const [elapsedSec, setElapsedSec] = useState(0);
```

Then find:
```tsx
  const genRef = useRef(0);
```
Replace with:
```tsx
  const genRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const recordStartRef = useRef(0);
```

- [ ] **Step 3: Tear down the timer in `cleanup`**

Find:
```tsx
  const cleanup = useCallback(() => {
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
```
Replace with:
```tsx
  const cleanup = useCallback(() => {
    if (timerRef.current != null) clearInterval(timerRef.current);
    timerRef.current = null;
    setElapsedSec(0);
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
```

- [ ] **Step 4: Start the timer when the session goes live**

Find:
```tsx
            dc.addEventListener("open", () => {
              if (genRef.current !== myGen) return; // cancelled before the channel opened
              setStatus("live"); // stoplight flips to red — on air
            });
```
Replace with:
```tsx
            dc.addEventListener("open", () => {
              if (genRef.current !== myGen) return; // cancelled before the channel opened
              setStatus("live"); // button goes red — on air
              recordStartRef.current = Date.now();
              setElapsedSec(0);
              timerRef.current = setInterval(() => {
                setElapsedSec(Math.floor((Date.now() - recordStartRef.current) / 1000));
              }, 250);
            });
```

- [ ] **Step 5: Remove the `light` derivation**

Find:
```tsx
  const live = status === "live" || status === "connecting";
  const light = recordingLight(status);
```
Replace with:
```tsx
  const live = status === "live" || status === "connecting";
```

- [ ] **Step 6: Replace the traffic-light button, meter block, and Esc hint with the circular control**

Find (the whole block — the stoplight `<button>`, the `{live && (` meter `<div>`, and the `{live && (` Esc-hint `<p>`):
```tsx
      {/* The traffic light IS the control — tap to record/stop. Lamps run
          green → orange → red (red on the right): green = ready, orange =
          connecting, red (pulsing) = live/on-air. */}
      <button
        onClick={live ? stop : start}
        aria-label={live ? "Stop recording" : "Start recording"}
        className="mx-auto flex cursor-pointer items-center gap-4 rounded-full border border-foreground/15 bg-foreground/[0.04] px-7 py-4 transition-colors hover:bg-foreground/[0.08]"
      >
        <span className="flex items-center gap-3" aria-hidden>
          <span
            className={`h-7 w-7 rounded-full bg-green-500 transition-opacity ${light.lamp === "green" ? "opacity-100 shadow-lg shadow-green-500/50" : "opacity-20"}`}
          />
          <span
            className={`h-7 w-7 rounded-full bg-orange-500 transition-opacity ${light.lamp === "orange" ? "opacity-100 shadow-lg shadow-orange-500/50" : "opacity-20"}`}
          />
          <span
            className={`h-7 w-7 rounded-full bg-red-500 transition-opacity ${light.lamp === "red" ? "opacity-100 animate-pulse shadow-lg shadow-red-500/60" : "opacity-20"}`}
          />
        </span>
        <span
          className="min-w-24 whitespace-nowrap text-left text-lg font-medium text-foreground/70"
          aria-live="polite"
        >
          {light.label}
        </span>
      </button>

      {live && (
        <div className="mx-auto h-1 w-24 overflow-hidden rounded-full bg-foreground/10" aria-hidden>
          <div
            ref={meterRef}
            className="h-full w-full origin-left rounded-full bg-green-500 transition-transform duration-75 ease-out"
            style={{ transform: "scaleX(0)" }}
          />
        </div>
      )}

      {live && (
        <p className="text-center text-xs text-foreground/40">
          press <kbd className="font-mono">Esc</kbd> to stop
        </p>
      )}
```
Replace with:
```tsx
      {/* One circular Record/Stop button — the universal recorder affordance.
          Idle/error: red dot = tap to record. Live: red, pulsing ring, stop
          square = tap to stop, with REC timer + live mic-level bar. */}
      <div className="flex flex-col items-center gap-3">
        <button
          onClick={live ? stop : start}
          aria-label={live ? "Stop recording" : "Start recording"}
          className={`relative flex h-20 w-20 cursor-pointer items-center justify-center rounded-full border-2 transition-colors ${
            status === "live"
              ? "border-red-600 bg-red-600"
              : status === "connecting"
                ? "animate-pulse border-foreground/30 bg-foreground/[0.04]"
                : "border-foreground/20 bg-foreground/[0.04] hover:bg-foreground/[0.08]"
          }`}
        >
          {status === "live" && (
            <span className="absolute inset-0 animate-ping rounded-full bg-red-600/40" aria-hidden />
          )}
          {status === "live" ? (
            <span className="relative h-6 w-6 rounded-sm bg-white" aria-hidden />
          ) : (
            <span className="relative h-7 w-7 rounded-full bg-red-600" aria-hidden />
          )}
        </button>

        <div className="flex h-5 items-center gap-3 text-sm">
          {status === "live" ? (
            <>
              <span className="font-medium text-red-500">● REC</span>
              <span className="tabular-nums text-foreground/70">{formatElapsed(elapsedSec)}</span>
              <span className="h-1 w-20 overflow-hidden rounded-full bg-foreground/10" aria-hidden>
                <span
                  ref={meterRef}
                  className="block h-full w-full origin-left rounded-full bg-green-500 transition-transform duration-75 ease-out"
                  style={{ transform: "scaleX(0)" }}
                />
              </span>
            </>
          ) : status === "connecting" ? (
            <span className="text-foreground/50">Connecting…</span>
          ) : (
            <span className="text-foreground/40">Tap to record</span>
          )}
        </div>

        {live && (
          <p className="text-xs text-foreground/40">
            press <kbd className="font-mono">Esc</kbd> to stop
          </p>
        )}
      </div>
```

- [ ] **Step 7: Fix the `meterRef` element type**

The meter bar is now a `<span>`, so its ref must be a span. Find:
```tsx
  const meterRef = useRef<HTMLDivElement | null>(null);
```
Replace with:
```tsx
  const meterRef = useRef<HTMLSpanElement | null>(null);
```

- [ ] **Step 8: Typecheck and lint**

Run: `npx tsc --noEmit && pnpm lint`
Expected: no errors. In particular, `recordingLight` and `light` must no longer be referenced anywhere (tsc/eslint will flag a miss), and `RecordingStatus` is no longer imported.

- [ ] **Step 9: Commit**

```bash
git add src/app/RecorderClient.tsx
git commit -m "feat: traditional circular record/stop button with timer + level bar

Replace the traffic-light control with the conventional voice-recorder
pattern: one circular button (red dot → tap to record; red, pulsing,
stop square → tap to stop), a REC m:ss elapsed timer, and the existing
mic-level bar. Keeps the on-air feel via the red pulse + live meter."
```

---

### Task 3: Delete the dead stoplight module

**Files:**
- Delete: `src/app/recordingLight.ts`
- Delete: `src/app/recordingLight.test.ts`

- [ ] **Step 1: Confirm there are no remaining references**

Run: `grep -rn "recordingLight\|RecordingStatus" src/`
Expected: no matches.

- [ ] **Step 2: Delete the files**

```bash
git rm src/app/recordingLight.ts src/app/recordingLight.test.ts
```

- [ ] **Step 3: Verify the full suite still passes**

Run: `pnpm test`
Expected: PASS — `transcript` (7) + `realtime` (5) + `elapsed` (7) = 19 tests, 0 failures. No `recordingLight` suite remains.

- [ ] **Step 4: Commit**

```bash
git commit -m "chore: remove stoplight indicator module (replaced by record button)"
```

---

### Task 4: End-to-end verification

**Files:** none (verification only)

- [ ] **Step 1: Ensure a dev server is running**

Run: `curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8255 || pnpm dev`
Expected: `200` (or start one with `pnpm dev` — note the fixed port 8255).

- [ ] **Step 2: Verify the idle control renders (Playwright MCP)**

1. `browser_navigate` to `http://localhost:8255`.
2. `browser_evaluate`:
```js
() => {
  const btn = document.querySelector('button[aria-label="Start recording"]');
  const text = document.body.innerText;
  return {
    recordButtonPresent: !!btn,
    saysTapToRecord: /Tap to record/.test(text),
    noStoplightWords: !/Ready|Connecting…|Live\b/.test(text),
    status: document.querySelector('main header span:last-child')?.textContent,
  };
}
```
Expected: `recordButtonPresent: true`, `saysTapToRecord: true`, `status: "idle"`.
3. `browser_close` when done (don't leave Chrome cruft).

- [ ] **Step 3: Human acceptance test (real speech) — also closes out the open "no-text" bug**

Open http://localhost:8255 and:
- Tap the circular button → it turns **red with a pulsing ring** and a **stop square**; `● REC` + a `m:ss` timer counts up; the level bar reacts to your voice.
- **Speak a sentence → confirm words appear in the transcript textarea.** (This is the known-open bug: a prior connection probe proved the pipe is healthy — token 200, calls 201, data channel open, `session.created` — so if no words appear, open the "raw event log (spike)" and note whether you see `…transcription.delta` / `…completed` or an `error`/`pc:failed`, and report back rather than guessing.)
- Tap the button again (or press **Esc**) → recording stops, button returns to the idle red dot + "Tap to record", timer resets.

- [ ] **Step 4: Clean up the dev server if this session started it**

If a background `pnpm dev` was started for verification and is no longer needed, kill it: `lsof -nP -iTCP:8255 -sTCP:LISTEN -t | xargs kill`.

---

## Notes for the executor

- **Fixed port 8255** — `pnpm dev` serves http://localhost:8255 (not 3000). Don't kill processes you didn't start; target only the 8255 listener when cleaning up.
- **pnpm pinned to v9 / Node 20** — do not let tooling bump pnpm past v9 (CLAUDE.md).
- **No new dependencies** — record dot and stop square are CSS shapes; no icon library.
- **Scope guard:** UI + a pure helper only. Do not touch the connection/token code (`realtime.ts`) or persistence (Phase 2). The existing `connectRealtimeSession` and `handleEvent` paths are unchanged.
- **Optional later polish (out of scope):** a multi-bar animated waveform instead of the single level bar; a subtle start chime. The single bar is enough to convey "live".

## Self-review (done by plan author)

- **Spec coverage:** circular record/stop button → Task 2 Step 6; elapsed timer → Tasks 1 + 2 (Steps 2/3/4/6); live level bar (waveform-ish) → Task 2 Step 6 (reused meter); remove stoplight → Tasks 2 (Steps 1/5/6) + 3. ✓
- **Placeholder scan:** no TBD/TODO; every code step shows complete code. ✓
- **Type consistency:** `formatElapsed(totalSeconds: number): string` defined in Task 1, called with `elapsedSec: number` in Task 2. `meterRef` retyped to `HTMLSpanElement` to match the new `<span>` element (Task 2 Step 7). `Status` union restored inline so removing `recordingLight` (Task 3) leaves no dangling `RecordingStatus` import. `timerRef`/`recordStartRef`/`elapsedSec` declared in Step 2, used in Steps 3/4/6. ✓
