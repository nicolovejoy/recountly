# Editable Transcript (Type + Talk) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the read-only transcript display into an editable textarea so the owner can type words (including ones hard for speech-to-text), edit freely while transcription streams in, and use Enter for a newline instead of accidentally stopping the recording.

**Architecture:** The transcript becomes an **uncontrolled** `<textarea>` (the DOM is the source of truth). The user types into it natively — no React re-render touches it, so the cursor never jumps. Finalized spoken segments are appended to the **end** of the textarea via a pure, unit-tested helper (`appendSegment`), preserving the user's current selection (appending at the end never shifts earlier offsets). The in-progress *interim* text renders as a faint ghost line **below** the textarea (never inside it), so live speech and manual editing never fight over the cursor.

**Tech Stack:** Next.js 16 / React 19 / TypeScript / Tailwind CSS 4. Adds **Vitest** as the project's first test runner (CLAUDE.md: "add one when the first non-trivial logic lands" — the transcript-merge logic is that moment).

---

## Why uncontrolled, and what we explicitly decided

- **Uncontrolled textarea (ref, not `value`/`onChange`).** A controlled textarea would have its `value` reset by React on every re-render (interim ghost updates, status changes, meter), yanking the caret to the end mid-edit. Uncontrolled avoids this entirely; React never rewrites the DOM value.
- **Append at end + restore selection.** When a segment finalizes we set `textarea.value = appendSegment(value, segment)`. Because we only ever append at the end, any earlier caret/selection offset is still valid, so we restore it verbatim. If the caret was already at the end (the common "just watching" case, and the default for an unfocused textarea), we move it to the new end and scroll to the bottom so spoken text follows along.
- **Interim ghost lives outside the textarea.** Mid-word deltas are volatile and get rewritten constantly; splicing them into the editable text at the caret would fight the user's edits. A separate muted line below is predictable.
- **No autofocus on record (decision).** This tool is phone-first (CLAUDE.md). Autofocusing the textarea when recording starts would pop the on-screen keyboard every time you just want to talk. Instead: tap Record and talk hands-free; tap into the textarea when you want to type/edit, and then Enter is a newline. (The Enter-stops-recording bug exists today only because the toggle button is the *sole* focusable element, so it keeps focus and Enter re-fires it. Once a textarea exists, Enter has somewhere correct to go.) If desktop use later wants autofocus, it's a one-line add in the data-channel `open` handler — noted in Task 3.
- **Text is not yet React state and not persisted.** Phase 2 (persistence) will read `textRef.current?.value` at save time. This plan deliberately does not lift it into state (YAGNI, and it would reintroduce the cursor problem).

---

## File Structure

- **Create** `src/app/transcript.ts` — pure transcript helpers. Single responsibility: text-merge logic, no React, no DOM. Unit-tested.
- **Create** `src/app/transcript.test.ts` — Vitest unit tests for `appendSegment`.
- **Create** `vitest.config.ts` — minimal Vitest config (node environment; pure functions only).
- **Modify** `src/app/RecorderClient.tsx` — replace the read-only `<section>` (currently lines 190–196) with the editable textarea + interim ghost; remove the `committed` state; add `textRef`; rewrite the `completed` event case to append into the textarea; stop clearing text on `start()`.
- **Modify** `package.json` — add `test` / `test:watch` scripts and the `vitest` devDependency.

---

### Task 1: Add Vitest and a failing test for `appendSegment`

**Files:**
- Modify: `package.json`
- Create: `vitest.config.ts`
- Create: `src/app/transcript.test.ts`

- [ ] **Step 1: Install Vitest**

Run:
```bash
pnpm add -D vitest
```
Expected: `vitest` added under `devDependencies`. (pnpm is pinned to v9 — do not let any tooling bump it; see CLAUDE.md.)

- [ ] **Step 2: Add test scripts to `package.json`**

In the `"scripts"` block, add these two entries (leave existing `dev`/`build`/`start`/`lint` untouched):
```json
    "test": "vitest run",
    "test:watch": "vitest"
```

- [ ] **Step 3: Add a minimal Vitest config**

Create `vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";

// Pure-function unit tests only (no DOM). Node environment keeps it fast.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
```

- [ ] **Step 4: Write the failing test**

Create `src/app/transcript.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { appendSegment } from "./transcript";

describe("appendSegment", () => {
  it("returns the segment when prev is empty", () => {
    expect(appendSegment("", "Hello")).toBe("Hello");
  });

  it("joins prev and segment with a single space", () => {
    expect(appendSegment("Hello", "world")).toBe("Hello world");
  });

  it("does not create a double space when prev already ends in a space", () => {
    expect(appendSegment("Hello ", "world")).toBe("Hello world");
  });

  it("adds no separator after a trailing newline", () => {
    expect(appendSegment("Hello\n", "world")).toBe("Hello\nworld");
  });

  it("trims surrounding whitespace from the incoming segment", () => {
    expect(appendSegment("Hello", "  world  ")).toBe("Hello world");
  });

  it("leaves prev unchanged when the segment is blank", () => {
    expect(appendSegment("Hello", "   ")).toBe("Hello");
  });

  it("keeps the user's existing punctuation", () => {
    expect(appendSegment("Hello.", "World")).toBe("Hello. World");
  });
});
```

- [ ] **Step 5: Run the test to verify it fails for the right reason**

Run:
```bash
pnpm test
```
Expected: FAIL — Vitest cannot resolve `./transcript` (module does not exist yet). This confirms the runner is wired up and the test is reaching for the not-yet-written function.

---

### Task 2: Implement `appendSegment`

**Files:**
- Create: `src/app/transcript.ts`
- Test: `src/app/transcript.test.ts` (already written in Task 1)

- [ ] **Step 1: Write the minimal implementation**

Create `src/app/transcript.ts`:
```ts
// Pure transcript helpers (unit-tested in transcript.test.ts) — no React, no DOM.
//
// appendSegment merges a newly-finalized spoken segment onto the END of the
// existing transcript text, inserting a single separating space unless the text
// already ends in whitespace (so a trailing newline or space is preserved as-is).
// Appending only ever happens at the end, which is what lets the caller restore
// an earlier caret/selection position after writing the result back.
export function appendSegment(prev: string, segment: string): string {
  const clean = segment.trim();
  if (!clean) return prev;
  if (prev.length === 0) return clean;
  return /\s$/.test(prev) ? prev + clean : prev + " " + clean;
}
```

- [ ] **Step 2: Run the tests to verify they pass**

Run:
```bash
pnpm test
```
Expected: PASS — all 7 `appendSegment` tests green.

- [ ] **Step 3: Commit**

```bash
git add package.json pnpm-lock.yaml vitest.config.ts src/app/transcript.ts src/app/transcript.test.ts
git commit -m "test: add appendSegment transcript-merge helper + vitest

First test runner in the project. appendSegment is the pure text-merge
logic the editable transcript needs (joins finalized spoken segments onto
the end of the transcript without doubling whitespace)."
```

---

### Task 3: Wire the editable textarea into RecorderClient

**Files:**
- Modify: `src/app/RecorderClient.tsx`

All edits below are against the current file. Apply them in order. Line references are approximate — match on the quoted text.

- [ ] **Step 1: Import the helper**

Find (line ~13):
```tsx
import { useCallback, useRef, useState } from "react";
```
Replace with:
```tsx
import { useCallback, useRef, useState } from "react";
import { appendSegment } from "./transcript";
```

- [ ] **Step 2: Remove the now-unused `committed` state**

Find (line ~24):
```tsx
  const [committed, setCommitted] = useState("");
```
Delete this line entirely.

- [ ] **Step 3: Add a ref for the textarea**

Find (line ~33):
```tsx
  const meterRef = useRef<HTMLDivElement | null>(null);
```
Replace with:
```tsx
  const meterRef = useRef<HTMLDivElement | null>(null);
  const textRef = useRef<HTMLTextAreaElement | null>(null);
```

- [ ] **Step 4: Rewrite the `completed` event case to append into the textarea**

Find (lines ~65–70):
```tsx
      case "conversation.item.input_audio_transcription.completed":
        if (typeof event.transcript === "string") {
          setCommitted((prev) => (prev ? prev + " " : "") + event.transcript!.trim());
          setInterim("");
        }
        break;
```
Replace with:
```tsx
      case "conversation.item.input_audio_transcription.completed":
        if (typeof event.transcript === "string") {
          // Append the finalized segment to the editable textarea WITHOUT
          // disturbing the user's caret. We only ever append at the end, so an
          // earlier selection stays valid and is restored verbatim. If the caret
          // was already at the end (or the textarea is unfocused), follow along
          // and scroll to the bottom.
          const ta = textRef.current;
          if (ta) {
            const selStart = ta.selectionStart;
            const selEnd = ta.selectionEnd;
            const wasAtEnd =
              selStart === ta.value.length && selEnd === ta.value.length;
            ta.value = appendSegment(ta.value, event.transcript);
            if (wasAtEnd) {
              ta.selectionStart = ta.selectionEnd = ta.value.length;
              ta.scrollTop = ta.scrollHeight;
            } else {
              ta.selectionStart = selStart;
              ta.selectionEnd = selEnd;
            }
          }
          setInterim("");
        }
        break;
```
(`handleEvent`'s dependency array stays `[pushLog]` — `textRef` and the imported `appendSegment` are both stable.)

- [ ] **Step 5: Stop wiping the transcript when recording starts**

Find (lines ~80–84):
```tsx
    setErrorMsg(null);
    setCommitted("");
    setInterim("");
    setLog([]);
    setStatus("connecting");
```
Replace with:
```tsx
    setErrorMsg(null);
    // NOTE: intentionally do NOT clear the textarea here — the user may have
    // pre-typed hard-to-transcribe words before tapping Record, and may record
    // multiple times into one entry. They clear it by editing the textarea.
    setInterim("");
    setLog([]);
    setStatus("connecting");
```

- [ ] **Step 6: Replace the read-only transcript section with an editable textarea + interim ghost**

Find (lines ~190–196):
```tsx
      <section className="min-h-32 rounded-xl border border-foreground/10 p-4 text-lg leading-relaxed">
        {committed && <span>{committed} </span>}
        {interim && <span className="text-foreground/40">{interim}</span>}
        {!committed && !interim && (
          <span className="text-foreground/30">Your words will appear here…</span>
        )}
      </section>
```
Replace with:
```tsx
      <div className="flex flex-1 flex-col gap-1">
        <textarea
          ref={textRef}
          placeholder="Type or talk — your words appear here…"
          aria-label="Transcript"
          className="min-h-48 w-full flex-1 resize-none rounded-xl border border-foreground/10 bg-transparent p-4 text-lg leading-relaxed outline-none placeholder:text-foreground/30 focus:border-foreground/30"
        />
        {interim && (
          <p className="px-4 text-lg leading-relaxed text-foreground/40">{interim}</p>
        )}
      </div>
```

- [ ] **Step 7: Update the stale spike comment at the top of the file**

Find (lines ~9–11):
```tsx
// SPIKE: the inline event handling and the raw event log are throwaway. Once we
// confirm the real event names/shapes by speaking into this, the transcript logic
// gets extracted into a tested pure reducer (Phase 1, step 3).
```
Replace with:
```tsx
// SPIKE: the inline event handling and the raw event log are throwaway. The
// transcript-merge logic now lives in ./transcript (appendSegment, unit-tested).
// The transcript itself is an uncontrolled <textarea> so the user can type/edit
// while spoken segments append to the end without disturbing the caret.
```

- [ ] **Step 8: Typecheck and lint**

Run:
```bash
npx tsc --noEmit && pnpm lint
```
Expected: no errors. (In particular, `committed` must no longer be referenced anywhere — tsc/eslint will flag it if a reference was missed.)

- [ ] **Step 9: Commit**

```bash
git add src/app/RecorderClient.tsx
git commit -m "feat: editable transcript (type + talk); Enter inserts newline

Replace the read-only transcript with an uncontrolled <textarea>. Finalized
spoken segments append to the end via appendSegment while preserving the
user's caret; interim text shows as a ghost line below. The user can now type
hard-for-STT words and edit while transcribing, and Enter is a newline (the
textarea, not the toggle button, receives the keystroke)."
```

---

### Task 4: End-to-end verification

**Files:** none (verification only)

- [ ] **Step 1: Ensure a dev server is running**

Run (skip if one is already serving on :3000):
```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000 || pnpm dev
```
Expected: `200` (or start one with `pnpm dev`).

- [ ] **Step 2: Verify Enter = newline and typing works (no accidental stop)**

Drive the browser with the Playwright MCP tools:
1. `browser_navigate` to `http://localhost:3000`.
2. `browser_evaluate`:
```js
() => {
  const ta = document.querySelector('textarea');
  ta.focus();
  return ta ? 'textarea present' : 'MISSING';
}
```
   Expected: `"textarea present"`.
3. Click into the textarea, then use `browser_type` / `browser_press_key` to type `hello`, press `Enter`, type `world`.
4. `browser_evaluate`:
```js
() => {
  const ta = document.querySelector('textarea');
  return { value: ta.value, status: document.body.innerText.includes('idle') };
}
```
   Expected: `value` is `"hello\nworld"` (Enter inserted a newline) and the app is still `idle` (Enter did NOT start/stop recording).

- [ ] **Step 3: Regression — recording still connects**

The connection path is untouched, but confirm it. In the browser console (`browser_evaluate`), reuse the proven harness: `fetch('/api/realtime-token')` → build an `RTCPeerConnection` with a synthesized audio track → POST `offer.sdp` to `https://api.openai.com/v1/realtime/calls`. Expected: `callsStatus === 201` and a data-channel `session.created` event. (Requires the OpenAI account to have billing quota.)

- [ ] **Step 4: Human acceptance test (real speech)**

Tap **● Record**, allow the mic, and:
- Confirm the small green mic meter reacts to your voice.
- Speak a sentence — confirm words append to the textarea.
- While still talking, click into the middle of the existing text and type/edit — confirm spoken segments keep appending to the **end** and your caret/edit is **not** disrupted.
- Press Enter inside the textarea — confirm it inserts a newline and does not stop recording.

- [ ] **Step 5: Clean up the dev server if this session started it**

If you started a background `pnpm dev` for verification and it's no longer needed, kill it (find the PID with `lsof -nP -iTCP:3000 -sTCP:LISTEN`).

---

## Notes for the executor

- **pnpm is pinned to v9** (Node 20 on this machine). Do not let any step upgrade pnpm past v9. (CLAUDE.md)
- **Next.js 16** has breaking changes vs older versions; this plan touches only a client component and a pure module, so no route/server-action concerns arise. If you stray into those, consult `node_modules/next/dist/docs/`.
- **Scope guard:** this plan is UI + a pure helper only. It does not touch persistence (Phase 2) or the connection/token code. Resist bundling unrelated changes.
- **Optional follow-up (not in scope):** if desktop users want Enter to work the instant recording starts, add `textRef.current?.focus()` inside the data-channel `open` handler in `start()` — but weigh the mobile-keyboard tradeoff noted above before doing so.

## Self-review (done by plan author)

- **Spec coverage:** "Enter = newline" → Task 3 (textarea) + Task 4 Step 2. "Type and talk / edit while transcribing" → Task 3 Steps 4 & 6 + Task 4 Step 4. Both requirements have tasks. ✓
- **Placeholder scan:** no TBD/TODO/"handle edge cases"; every code step shows complete code. ✓
- **Type consistency:** `appendSegment(prev: string, segment: string): string` is defined identically in Task 2 and called with that signature in Task 3. `textRef` typed `HTMLTextAreaElement | null` and used as such. `committed` is removed in Task 3 Step 2 and all its references (state, `start()`, render) are removed in Steps 2/5/6. ✓
