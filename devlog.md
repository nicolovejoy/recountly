# recountly devlog

## 2026-06-13 — Phase 2 persistence built end-to-end (code-complete; runtime verify pending)

Both gating decisions settled with the owner, then the whole save/list path built
test-first on the existing DB-free core. Branch `phase-2-persistence`.

**Decisions:**
1. **DB driver:** `@neondatabase/serverless` + `@vercel/blob` (confirmed). neon's
   `sql.query(text, values)` runs the existing `entry-sql.ts` builders verbatim.
2. **Audio vs privacy-pause:** best-effort **single continuous segment**. Transcript is
   ALWAYS saved; audio is whatever the last continuous capture produced (a paused-then-
   resumed entry keeps only the post-resume segment — owner pauses rarely). Audio columns
   made nullable. ⚠️ **Deferred TODO:** a visual "not capturing full audio this entry" cue
   when a pause splits a recording — agreed but not built ("yet").

**Built (each a green checkpoint — 91→111 tests, lint, build):**
- `entry.ts`/`entry-sql.ts`/`schema.sql`: audio fields nullable; `validateEntryInput`
  validates audio only when present.
- `db.ts`: insert/list/get over the SQL builders; injectable `QueryRunner` (tested with a
  fake); **lazy neon init** so an unset `DATABASE_URL` can't crash `next build`.
- `blob.ts`: `audioExtension`/`audioBlobPath` (pure) + `uploadAudio` over `put()`, public v1.
- `POST/GET /api/entries` (Next 16 Web Request/Response): POST takes multipart
  (transcript + durationSeconds + optional audio File), validates, mints a ULID, uploads
  audio best-effort (a failed upload still saves the transcript), inserts, returns 201.
- `entry-form.ts`: `buildEntryFormData` — the client↔route field contract, tested.
- `useRecorder`: a fresh `MediaRecorder` per mic stream (resume discards prior chunks);
  Done finalizes audio then fires `onStop` **after the FLUSH_MS window** so the final
  transcript tail is in the editor before the save reads it (the subtle ordering bug here).
- `TranscriptEditor.clear()`, `RecorderClient` Done→save + save-status line, `EntryList`
  (newest-first, audio player per entry).

**Provisioned + persistence verified (2026-06-13, on the mini).** Neon (`neon-gray-coin`)
+ Vercel Blob (`recountly-audio`) connected to the project. Secrets: Vercel integration
vars are write-only (`vercel env pull` returns them blank), so local uses **op** items
(`recountly-neon` field `credential`, `recountly-blob` field `BLOB_READ_WRITE_TOKEN`) via
`op inject`; Vercel env stays the prod source. Schema applied with `pnpm db:migrate`.
`POST`+`GET /api/entries` round-trips a real entry — Neon insert + live Vercel Blob upload
(got a public blob URL) — and it renders in the `EntryList` UI with 0 console errors
(Playwright). Test entry + blob cleaned up after.

**Live-speech leg verified (2026-06-13, on the mini) — Phase 2 acceptance met.** Recorded
real speech → words live → Done → entry saved + listed + audio plays back full-length.

⚠️ **Bug found + fixed in that verification — MediaRecorder WebM has no duration header.**
First playback only played the tail (~8s of a 22s clip) and showed a wrong duration.
ffprobe confirmed `duration=N/A` with the full ~137KB of Opus present — data intact, just
no container duration, so Chrome can't seek and mis-plays. Fix: patch the real duration into
the blob before upload with `fix-webm-duration` (added dep) in `finalizeRecording`
(`recorderStartRef` stamps the recorder start; WebM only — mp4 already carries it). Re-verified:
full-length playback.

**Provisioning gotchas worth remembering:** (1) Vercel integration secrets are write-only —
`vercel env pull` returns `DATABASE_URL`/`BLOB_READ_WRITE_TOKEN` blank; grab the real values
from the provider consoles (Neon connection string; Blob store token) and keep them in op.
(2) Blob connect dialog: must tick **"Add a read-write token env var"** or you get no
`BLOB_READ_WRITE_TOKEN`. (3) OpenAI key must be in an **active** project — an archived-project
key mints a 401 "project archived" (looks like a key problem, isn't).

**Still deferred:** the "audio not fully captured this entry" cue after a pause (best-effort
audio means a paused entry keeps only the last segment — UI should hint that).

## 2026-06-13 — Pause/resume verified on the mini; tail-drop bug fixed; affordances retuned

Owner ran the branch locally (`op inject` → `.env.local`, `pnpm dev`) and verified the full
pause/resume flow works well — record → pause → resume → Done, incl. resume-mid-flush and
Esc-mid-connect. Two fixes/changes made during that session (commits `d561f7e`, `27e4c00`):

- **Bug fixed — Done was dropping the tail.** Done closed the connection immediately, so
  everything spoken since the last VAD auto-commit was lost. Fix: keep the data channel in
  `dcRef` and, on both pause and Done, send a manual `input_audio_buffer.commit` to force
  the buffered tail to finalize, then hold the pc open `FLUSH_MS` (Done now flushes like
  pause instead of tearing down at once). A no-op commit returns a benign empty-buffer
  error, now suppressed in `handleEvent` rather than shown as a failure banner. `start()`
  also now `closeConnection()`s first so a fresh record can't stack on a lingering pc.
- **Affordances retuned — red == capturing, exclusively.** connecting = neutral spinner
  ("Connecting… don't speak yet"), paused = blinking red ring + red play triangle (was
  amber), "tap the red button to resume" hint. So red is the only "go" signal.
- **Dev tooling:** `.env.tpl` (1Password `op://` ref, committed; `!.env.tpl` un-ignored),
  `pnpm dev` auto-opens the browser, `pnpm dev:noopen` for the quiet variant.

Pause/resume is now DONE. FLUSH_MS stays 1.5s. Suite 91 green on this state. Next is the
two Phase 2 decisions below.

## 2026-06-13 — CI, web session-start hook, Phase 2 testable foundation (remote)

Continuation of the same remote session (still no mic/keys). PR #1 opened off
`claude/repo-remote-work-assessment-y0m14t`.

**Infra (verifiable here, takes effect once merged to default branch):**
- **GitHub Actions CI** (`.github/workflows/ci.yml`) — lint + test + build on push/PR,
  Node 20 + pnpm 9, concurrency-cancel. Validated by running the exact sequence locally.
- **SessionStart hook** (`.claude/hooks/session-start.sh` + `.claude/settings.json`) —
  `pnpm install` on web session start so deps are ready (this branch's first session
  started with no node_modules). Remote-only, ambient pnpm (NOT the v9 pin — that's for
  the owner's local Node 20; the container is Node 22 and forcing a downgrade triggers an
  interactive purge prompt), non-interactive via CI=1, synchronous. Validated.

**Phase 2 foundation (pure, test-first, 80→91 tests — the DB-free, decision-free core):**
- `src/lib/ulid.ts` — dependency-free ULID-style sortable IDs (26-char Crockford base32,
  time-sortable by string compare), injected clock/rng.
- `src/lib/entry.ts` — EntryInput/EntryRecord, validateEntryInput (collects all errors),
  buildEntryRecord (assembles row: id, blob url, timestamps; trims transcript).
- `src/lib/entry-sql.ts` — parameterized insert/list/get `{ text, values }` (any pg-style
  client runs them) + rowToEntry (snake_case Date|string rows → EntryRecord). Injection-safe.
- `src/lib/audio.ts` — pickAudioMimeType (Opus/WebM → mp4 → ogg), injected isTypeSupported.
- `db/schema.sql` — entries table mirroring EntryRecord + recorded_at DESC index.

**STOPPED here deliberately — two owner decisions block the rest (neither guessable):**
1. **DB driver + secrets.** Stack already decided Neon Postgres + Vercel Blob; the client
   lib wasn't pinned. Recommend `@neondatabase/serverless` (+ `@vercel/blob`). The data-
   access layer, blob upload, save/list API routes (Next 16 — consult
   `node_modules/next/dist/docs` per AGENTS.md), and the newest-first list UI are all
   ready to build on the tested SQL/domain core, but need `DATABASE_URL` +
   `BLOB_READ_WRITE_TOKEN` in the env to verify at runtime. Building them blind = handing
   the owner unverifiable code, against the project's verify-each-phase rule.
2. **Audio capture vs the privacy-pause.** Pause stops the mic stream and resume gets a
   NEW one, so a paused-then-resumed entry yields fragmented, non-concatenable WebM. "One
   continuous audio file per entry" conflicts with "cut the mic on pause for privacy."
   Options: (a) keep one continuous mic stream, pause only suspends MediaRecorder +
   transcription (weakens the privacy cut); (b) per-segment blobs stitched server-side
   (complex); (c) v1 saves transcript always, audio best-effort / only for un-paused
   entries. Needs an owner call before wiring MediaRecorder into useRecorder.

## 2026-06-12 — Pause/resume brainstorm decided + pre-pause refactor (TDD), remote session

Remote Claude Code session (cloud container, no mic/keys — pure-logic work only).
Branch: `claude/repo-remote-work-assessment-y0m14t`.

**Pause/resume design DECIDED (owner confirmed, not yet built):**
- **Close/reopen, not keep-alive mute**: pause tears down the WebRTC session; resume
  reconnects fresh (~1–2s "Connecting…" accepted). Rationale: keep-alive needs the
  reconnect path anyway as a fallback for OpenAI's unknown idle-timeout behavior, so
  build only the reconnect path; zero idle cost; mic indicator off while paused.
- **Flush window**: on pause, stop the mic track immediately (instant privacy), keep
  the pc open ~1.5s (or until the in-flight `completed` event) so the last words land,
  then tear down. This is the one genuinely new piece of logic still to build.
- **Esc = pause** (non-destructive). **Done = separate action**, returns to idle keeping
  the transcript text; becomes the save trigger in Phase 2.

**Refactor shipped (suite 19 → 53 tests, green at every step; new logic written test-first):**
- `src/lib/` established; `realtime`/`transcript`/`elapsed` + tests moved there (pure mv).
- `realtime-events.ts` — typed event union behind `parseRealtimeEvent` with an explicit
  `unknown` arm; all knowledge of OpenAI's shifty event shapes in one tested module.
- `recorder-state.ts` — pure `transition(status, event)` machine, full 5×6 table tested,
  **including `paused` + PAUSE/RESUME edges ahead of the feature** (resume re-enters
  `connecting` → `live`). Never-observable `"stopping"` status dropped. Component
  dispatches via functional updates only.
- `elapsed.ts` gains `totalElapsedSec(accumulatedMs, segmentStartMs, now)` — cumulative
  timer model ready for pause banking; behavior identical today.
- `planAppend` (transcript.ts) — the caret-preservation decision extracted PURE and
  tested (it previously had no automated net); `TranscriptEditor` applies the plan and
  exposes `append()`/`getValue()` via an imperative handle (React 19 ref-as-prop).
- `useRecorder` hook owns all imperative session state (gen counter, timer, meter,
  cleanup split into `closeConnection()` + `resetTimer()` so pause composes them);
  `onSegment` flows through a latest-ref (stale-closure guard, updated in an effect per
  react-hooks/refs). `RecorderClient` is now a ~90-line composition root over dumb
  `RecordButton` / `RecStatusLine` / `TranscriptEditor` / `EventLog` components.
- EventLog kept deliberately as the debugging window for the pause/reconnect work.

**Owner verification needed locally (no mic in the container):** real-speech smoke test —
record, type mid-transcript while speaking (caret must stay put; end-follow scrolling
works), Esc-mid-connect cancel, stop and re-record into the same entry.

**Pause/resume BUILT (same session, on the refactored base; needs owner real-speech verification):**
- `bankSegment` (elapsed.ts) + `primaryAction` (recorder-state.ts) added test-first
  (9 tests). `primaryAction(status)` is the single tested source of truth for the
  circular control's action — start/cancel/pause/resume — so the affordance can't go
  ambiguous (the old "no-text" bug's root cause).
- `useRecorder` gains `pause()`/`resume()`; `start`/`resume` share an extracted
  `connect(trigger)`. pause() banks the segment, cuts the mic immediately (privacy),
  freezes timer+meter, holds the pc open `FLUSH_MS=1500` so the in-flight `completed`
  lands, then tears down. resume() closes any lingering connection first (guards a
  pc leak if resumed mid-flush) and reconnects with a fresh token; timer continues
  from banked time, transcript+log carry over. stop()=Done is separate (live & paused).
- UI: pause bars (live) / amber play-triangle (paused) on the circular button; Done
  pill in-session; Esc pauses while live, cancels while connecting. RecStatusLine has
  a PAUSED row. 62 tests total, green; lint + build clean.

⚠️ Unverified by real speech (no mic/keys in the remote container) — the imperative
flush/reconnect TIMING in particular: does a fresh-token reconnect reliably re-enter a
live transcription session, and does the 1.5s window actually catch the last segment?
Owner to smoke-test: record → pause (last words land? mic indicator off?) → resume
(timer continues, words flow again) → Done (text kept); also resume-during-flush and
Esc-mid-connect.

Open threads for next session:
- Owner real-speech acceptance of pause/resume (above); tune FLUSH_MS if the tail clips.
- Suggested while remote-capable: GitHub Actions CI (lint + test + build) — none exists.
- Then Phase 2 (persistence): MediaRecorder on the mic stream → Vercel Blob → Neon entry,
  newest-first list. TranscriptEditor.getValue() is the read side already in place; Done
  is the natural save trigger.

## 2026-06-04 — Circular Record/Stop button; "no-text" bug closed

Executed the traditional-recorder-control plan end-to-end and shipped it to `main`
(branch `feat/record-button`, fast-forward merged, pushed).

Shipped & pushed to `main`:
- **Circular Record/Stop button** replacing the traffic light: red dot → tap to
  record; red + pulsing ring + stop square → tap to stop. The metaphor is gone in
  favor of the universal voice-recorder affordance (zero-learning, big phone target);
  on-air feel kept via the red pulse + live meter.
- **`● REC m:ss` elapsed timer** driven off a `Date.now()` start timestamp (no drift),
  backed by a pure, unit-tested `formatElapsed` helper (`src/app/elapsed.ts`, 7 tests).
- **Reused the existing mic-level bar** (now a `<span>`, repositioned beside the timer).
- **Deleted the dead `recordingLight` stoplight module** + its test. Full suite green:
  transcript (7) + realtime (5) + elapsed (7) = 19.

Bug closed:
- **"No text appearing" — CLOSED.** Real-speech acceptance test showed words appearing.
  Root cause was hypothesis #1 from last session: the ambiguous control meant a real
  recording was never reliably started — not a broken pipe or render path. Lesson: an
  unclear affordance can masquerade as a backend bug; verify the user can actually
  trigger the path before chasing the pipe.

Open threads for next session:
- **Resume-able Pause** (decided, not built): turn Stop into Pause that keeps the OpenAI
  realtime session alive while suspending audio + the timer, then resumes. Design first
  (brainstorm): mute track vs. close/reopen, idle-session timeout, timer + `gen`
  cancellation behavior.
- **Save & name a recording** (roadmap) — folds into Phase 2 (persistence: MediaRecorder
  → Vercel Blob → Neon entry, newest-first list).

## 2026-06-03 — Phase 1 editable transcript, UX iteration, and a "no-text" investigation

Executed the editable type-and-talk transcript plan, then iterated hard on the
recording UX, then hit (and started localizing) a transcription bug.

Shipped & pushed to `main`:
- **Editable transcript**: read-only display → uncontrolled `<textarea>`; finalized
  spoken segments append via the unit-tested `appendSegment` (`src/app/transcript.ts`)
  without disturbing the caret; Enter = newline. Added Vitest (first test runner).
- **Esc to stop** recording from anywhere while live.
- **Bug fix + regression test**: Esc mid-connect crashed (`addTrack` on a torn-down
  pc). Extracted the connection orchestration into `connectRealtimeSession`
  (`src/app/realtime.ts`) with injected browser APIs, added a generation-counter
  cancellation token, and tested the cancellation path (the crash had shipped with
  no regression test). Quality pass: shrank the god-component, made the orchestration
  node-testable.
- **Fixed dev port 8255** ("TALK" on a phone keypad) — was colliding on :3000.
- **Build date/time (PST) in the nav** — matches the ../musicforge norm; inlined at
  build via `next.config.ts` → `NEXT_PUBLIC_BUILD_TIME`.
- **Recording indicator**: countdown → stoplight. Currently committed as a clickable
  traffic light labeled by STATE (green Ready / orange Connecting… / red Live).

Open threads for next session:
- **UX redesign (decided, not built)**: switch to "lit lamp IS the button, labeled
  by ACTION" — green "Record" → orange "Connecting…" → red (pulsing) "Stop" + clear
  "● Recording". Lamps ~3× larger, order green·orange·red (red right). Action labels,
  not state labels, is the clarity fix.
- **"No text appearing" bug — connection is healthy, ruled out as the cause.** A
  browser connection probe (synthetic audio, no mic) proved the pipe: token route 200,
  OpenAI calls 201, data channel opened, `pc: connected`, `session.created` received.
  The render path is unchanged from when it worked. Most likely the owner couldn't
  actually start a real recording via the confusing control (the UX fix may resolve
  it), or the session isn't emitting deltas, or a stale build was tested. Next: during
  a REAL mic recording, check if the light reaches red and what the raw event log shows
  (`…transcription.delta` / `…completed` / `error` / `pc:failed`).

Note: an accidental `kill` took down a sibling app's dev server on :3000 earlier —
fixed by pinning recountly to 8255. Also added a memory: close the Playwright browser
after each testing burst.
