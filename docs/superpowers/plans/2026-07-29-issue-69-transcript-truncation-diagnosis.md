# Issue #69 — continuous-take transcript truncation: diagnosis

Read-only investigation, branch `main`. No code changed. Symptom: a 17s
continuous take (no pausing) saved complete audio but a transcript that ends
~8.5s in (the whole back half missing). Test A (record → background → pause →
resume → Done) preserves the full transcript including tail words.

## Mechanism (short version)

At Done, the saved transcript is snapshotted **synchronously**, the instant Done
is tapped — it is `editor value at Done` + `interimRef` (the accumulated live
`.delta` text). The manual `input_audio_buffer.commit` that Done fires produces
the **authoritative** transcription of the still-uncommitted tail, but that
`conversation.item.input_audio_transcription.completed` event arrives
asynchronously over the data channel — hundreds of ms to several seconds later —
by which point the snapshot is already frozen, the IndexedDB pending record is
already written, and `router.push` has already unmounted the component. That
late tail text lands only in the unmounted editor and is discarded. With
continuous speech, the live interim deltas trail real time on a long uncommitted
buffer, so at Done the interim has only reached ~the midpoint; everything after
it is exclusively in the still-in-flight `completed` and is lost. The
transcript-first-write-wins upsert (audio-only `ON CONFLICT`) plus a PATCH route
with no transcript field mean nothing ever repairs it server-side.

Confidence: **high** on the discard mechanism (it is plainly in the code, with
git-diff proof that #54 introduced it). Medium on the exact reason the interim
only reaches the midpoint (delta lag on a long uncommitted buffer vs. a genuine
session stall) — that one bit is what the owner's "did live words keep
appearing?" report disambiguates. Both sub-causes have the same fix.

## Evidence trail

### Q1 — When is the transcript snapshotted, relative to commit / flush / the final `completed`?

The snapshot is taken **synchronously at Done, before any flush**, in
`handleDone` (`src/app/RecorderClient.tsx`):

- L320-321: `pendingDurationRef.current = elapsedSec; stop();` — `stop()` is
  synchronous and only *schedules* the FLUSH_MS teardown; it does not wait.
- L322: `const transcript = editorRef.current?.getValue().trim() ?? "";` — reads
  the editor **right now**, on the same tick `stop()` returned.
- L336-343: that string is frozen into `finalSaveSnapshotRef`.
- L354-369: the transcript-first IndexedDB pending record is written from it.
- L376: `router.push(...)` — navigate immediately, component unmounts.

Inside `stop()` (`src/app/useRecorder.ts`):

- L461: `commitBuffer()` — sends `{type:"input_audio_buffer.commit"}` over the
  data channel (L188-193). This *starts* transcription of the uncommitted tail;
  its result comes back later as a `completed` event.
- L468: `if (interimRef.current) onSegmentRef.current(interimRef.current);` —
  merges the current interim (accumulated deltas) into the editor synchronously.
  **This is the only tail text the save ever sees.**
- L493-508: `runStopFlush` is scheduled for `FLUSH_MS` (1500ms, L38) later. It
  closes the connection and *then* calls `onStopRef.current(...)`. `onStop`
  reads the transcript from the **already-frozen** `finalSaveSnapshotRef`
  (RecorderClient L181-184), never the editor.

So there is a race, and the save loses it every time: the final `completed` for
the manually-committed tail (a) fires `handleEvent` →
`onSegmentRef.current(event.transcript)` (useRecorder L212-215) which appends to
the **unmounted** editor, and (b) is never read into the payload because the
snapshot froze at L322. FLUSH_MS is irrelevant to the saved transcript now — it
only governs when audio finalizes and `onStop` fires.

**#54 is the regression.** `git show c0eb538` (`feat(save): instant post-save
nav … (#54)`): pre-#54 `onStop` itself did `const transcript =
editorRef.current?.getValue().trim()` — and `onStop` runs from `runStopFlush`
**after** the FLUSH_MS window, so a `completed` landing within ~1.5s of Done was
captured. #54 moved the read to a synchronous snapshot at the Done instant,
shrinking the tail-capture window from ~1.5s to **zero**.

### Q2 — Interim delta flow, and how often commits fire

Two event types are handled (`src/lib/realtime-events.ts` L14-19, useRecorder
`handleEvent` L206-234):

- `conversation.item.input_audio_transcription.delta` → `setInterim(prev + delta)`
  (accumulates; rendered live in the `interim` `<p>` under the textarea —
  `TranscriptEditor.tsx` L65-73).
- `conversation.item.input_audio_transcription.completed` →
  `onSegmentRef.current(transcript)` (appends the finalized segment to the
  editor) + `setInterim("")` (resets).

So live on-screen words are the accumulating `interim`; the editor's committed
text grows only on `completed` events. Commits are driven by server VAD detecting
silence between utterances. **Two aggravating facts:**

1. `src/app/api/realtime-token/route.ts` L44-57 configures the transcription
   session with **no `turn_detection`** — an explicit `NOTE` at L50-53 says VAD
   was left off "until the demo proves whether it's needed." Whether OpenAI
   applies a default server_vad or none, the app leans on silence-driven commits.
   During animated *continuous* speech the silence threshold may not trip for
   8+ seconds, so 8+ seconds legitimately sits in one uncommitted buffer, visible
   only as accumulating interim.
2. Streaming deltas on a long uncommitted buffer **lag real time** — the longer
   the buffer, the further behind the deltas fall. At Done (17s of audio) the
   interim can easily have only reached ~8.5s. The authoritative full-quality
   text of the rest arrives only in the post-commit `completed`, which #54
   discards.

### Q3 — Why Test A passes and Test B fails

Backgrounding a live/connecting session is classified `pause-persist`
(`src/lib/lifecycle-flush.ts` L21-25) and calls `pause()`
(`RecorderClient.tsx` L436-440), which:

- fires its own `commitBuffer()` (useRecorder L406) and merges the interim tail
  into the editor (L415), then holds the pc open FLUSH_MS (L441).

Backgrounding **splits** the take into shorter buffers, and the user then dwells
in the background (switching apps) far longer than FLUSH_MS, so:

- the pre-background segment's `commit` is followed by a real-time dwell during
  which its `completed` arrives **while the component is still mounted** (a
  background pause does not navigate away), landing in the editor;
- resume reconnects fresh; the post-resume tail is short, so its interim keeps
  much closer to real time and little is uncommitted at the final Done.

Test B has the whole 17s as one under-committed buffer with **no dwell and no
navigation delay** — Done snapshots synchronously, so the large tail still being
transcribed is discarded. The discriminator is dwell + split + still-mounted
editor, not any per-pause code path being "more correct" — pause has the exact
same synchronous-merge limitation, it just has less uncommitted tail to lose.

### Q4 — Does onStop wait for FLUSH_MS before reading the transcript?

No. `onStop` runs *after* FLUSH_MS (it is called from `runStopFlush`), but it
reads the transcript from `finalSaveSnapshotRef`, which `handleDone` froze at the
Done instant (Q1). A `completed` event arriving during/after FLUSH_MS but before
pc close:

- (a) editor: yes — `handleEvent` appends it (useRecorder L212-215), but the
  component is unmounted, so this is a dead write;
- (b) the already-written IDB pending record: no — it was written at
  `handleDone` L354-369 from the frozen snapshot and only *re-put* by `onStop`
  (RecorderClient L200-219) using the same frozen `transcript`;
- (c) the POST body: no — `buildSaveBody` (L232-241) uses the frozen `transcript`.

### Q5 — Is the upsert transcript-first-write-wins? Can the poll/recovery repair it?

Yes, permanently unfixable server-side:

- `insertEntrySql` (`src/lib/entry-sql.ts` L46-70): `ON CONFLICT (id) DO UPDATE`
  sets **only** `audio_url/audio_mime/audio_bytes/audio_complete/updated_at`, and
  only `WHERE entries.audio_url IS NULL AND EXCLUDED.audio_url IS NOT NULL`.
  `transcript` is never in the conflict update — first-write-wins.
- `PATCH /api/entries/[id]` (`src/app/api/entries/[id]/route.ts` L77-178) accepts
  only `journalId` (move) or `title/notes/location/writtenAt` (metadata). There
  is **no transcript field** anywhere in the write surface.
- The #54 poll (`src/lib/post-save-poll.ts`) only GETs the row to watch
  `enrichedAt`; it never writes.
- `retryPending` (`src/lib/pending-save.ts` L61-95) re-POSTs `rec.body` — the
  **same frozen truncated transcript** — and the idempotent upsert ignores it
  anyway.

Audio is complete because MediaRecorder (`finalizeRecording`, useRecorder
L291-318) captures the mic stream **locally and independently** of the realtime
data channel — it is untouched by whatever the transcription session did.

### Q6 — Stall hypothesis, and what would surface it

A genuine mid-take stall (data channel silently stops delivering, ICE
disconnect, VAD wedged) is possible and would produce the **same** saved symptom,
because audio is local. Client-side surfacing is essentially absent:

- `pc.connectionstatechange` only `pushLog`s to the debug EventLog (useRecorder
  L357) — no user-facing error, no auto-recovery.
- The data-channel `message` handler (L376-378) only fires on messages; silent
  cessation is invisible.
- There is no watchdog comparing "mic meter still moving" (local, keeps going)
  against "deltas still arriving." So the mic bar would keep bouncing and audio
  keep recording while transcription is dead — false confidence.

Discriminating question for the owner — **did the on-screen live words keep
updating past the ~8.5s midpoint, right up to Done?**

- Words kept scrolling in but visibly **lagging/still catching up** at Done, and
  the mic meter was active → **Hypothesis 1** (delta lag + synchronous-snapshot
  discard). The fix below fully addresses it.
- Words **froze** at ~8.5s and never moved again while the owner kept talking →
  **stall**. The wait-for-commit fix would then hang to its timeout and save the
  same truncated text, so a stall additionally needs a watchdog / reconnect
  (see fix, part C). Audio-complete does **not** distinguish these.
- Words appeared in **full to 17s** yet it still truncated → a
  merge/ordering-only bug (least likely given the code).

## Recommended fix

Primary (fixes Hypothesis 1, the code-proven cause):

**A. Replace the fixed FLUSH_MS with a bounded wait-for-commit-completion, and
snapshot the transcript AFTER that wait — not at the Done instant.**

- The signal to wait for is the
  `conversation.item.input_audio_transcription.completed` event that follows the
  manual `commitBuffer()`. Concretely: after `commitBuffer()`, resolve when the
  next `completed` lands (its `transcript` is the authoritative tail), or when a
  bound (e.g. 8-10s, tunable) elapses — whichever first. On timeout, fall back to
  merging `interimRef` (today's behavior) so a stalled session still saves the
  best available text rather than hanging forever.
- Restructure so the transcript read/snapshot for the save happens **inside that
  resolution**, not synchronously in `handleDone`. Practically this means either
  (i) move the `getValue()` snapshot back into the flush continuation (undo the
  #54 synchronous read) while keeping #54's immediate navigation, or (ii) have
  `stop()` return/emit the final transcript once the commit resolves and pass it
  through `onStop`'s `RecordingResult`.
- Keep the instant navigation (#54's UX win): navigate at Done as today, but
  write the IDB pending record and POST from the *resolved* transcript. The
  detail-page poll (30s entry bound, L28) comfortably covers an 8-10s wait.

Secondary (defense-in-depth, and the only server-side repair that is safe):

**B. A one-shot transcript tail-append/replace path, guarded so it cannot
resurrect the #23 truncation-ordering bug.** The reason transcript is
first-write-wins is that a lifecycle-flush transcript-only POST can land *before*
Done's full POST, and a blind "last write wins" would let the truncated flush
version overwrite the complete Done version. A safe repair keeps first-write-wins
as the default and allows exactly one *superseding* write gated on a monotonic
signal — e.g. only replace when the incoming transcript is longer AND carries an
explicit `final: true`/higher-generation flag that only Done's post-commit save
sets (never the lifecycle flush, never recovery). Without such a guard, do **not**
add a transcript-updating upsert branch.

Preferred: ship **A** (root cause) and treat **B** as optional insurance. A alone
resolves Hypothesis 1.

**C.** If the owner reports a stall (words froze), add a delta-liveness watchdog:
if the mic meter shows sustained input but no delta/completed for N seconds, surface
a visible warning and/or attempt a reconnect. This is a separate change from A/B.

**Consider also:** explicitly setting `turn_detection: { type: "server_vad" }`
(with a tuned silence threshold) in `realtime-token/route.ts` L50-53. More
frequent commits shrink the worst-case uncommitted tail, reducing how much
work the wait-for-commit in (A) must do and how much a stall can cost. Verify
against current OpenAI Realtime docs before changing session config (the model
name gotcha history lives in that same file).

### Blast radius

- **Pause/resume (#52):** `pause()` shares the same synchronous interim-merge
  limitation. Apply the same wait-for-commit before the pause draft is persisted
  (`RecorderClient.tsx` L448 reads the editor right after `pause()`), or accept
  that pause keeps interim-only (it already works for Test A because of dwell).
  Do not regress the "background = pause, never implicit Done" invariant.
- **Backgrounding flush (`pause-persist` / `save-flush`):** the flush path fires
  on `pagehide`/`visibilitychange` and **cannot await** a multi-second
  wait-for-commit — a hidden tab may be killed immediately. The flush must keep
  writing the best-available (interim-merged) transcript synchronously, exactly
  as today. Under fix B's guard, the flush write must be the *non-superseding*
  kind so Done's later resolved transcript can still win. This is the delicate
  interaction — get the generation/`final` flag right.
- **Pending-save recovery:** `retryPending` re-POSTs `rec.body`; ensure the
  record it persists carries the *resolved* transcript (write it after A's wait
  resolves, or re-put on resolution), else recovery re-POSTs the truncated text.
- **Keepalive cap:** none. The transcript for a 17s take is a few hundred bytes,
  far under `KEEPALIVE_CAP_BYTES` = 60_000 (`save-payload.ts` L68); a longer
  transcript only affects whether `keepalive` is set, not correctness.

### Tests a fix PR must add

Unit (node, the existing `src/lib` + hook-logic style):

- A recorder-timing test proving the save transcript includes a `completed` that
  arrives *after* Done's manual commit but within the bound (the exact case that
  regresses today) — inject a fake data channel that emits `completed` on a delay.
- A timeout test: no `completed` within the bound → falls back to interim-merged
  text and still saves (no hang).
- A pause test asserting the same wait applies (or explicitly asserting pause's
  documented interim-only behavior, so the choice is pinned).
- If fix B is included: an upsert/`insertEntrySql` test that a guarded superseding
  transcript write replaces a shorter earlier one, and that a lifecycle-flush
  (non-final) write can never overwrite a longer Done transcript — i.e. the #23
  ordering bug stays fixed.

Route-level (the repo's integration-test convention for these features):

- `POST /api/entries` twice for one id — flush (short transcript) then Done
  (full) — asserts the final row holds the full transcript (only meaningful if
  fix B lands; otherwise assert first-write-wins is intentional and the client
  never sends a truncated-then-full pair).

## Answers as data (for the caller)

- **Mechanism:** #54 made Done snapshot the transcript synchronously at the tap
  (`RecorderClient.tsx` L322), so the save captures only `editor + interim`. The
  manual `input_audio_buffer.commit`'s authoritative `completed` arrives async,
  after the snapshot/IDB-write/`router.push` unmount, and is discarded; with
  continuous speech the live deltas lag a long uncommitted buffer, so interim has
  only reached ~the midpoint at Done. First-write-wins upsert (audio-only
  `ON CONFLICT`, `entry-sql.ts` L46-70) and a transcript-less PATCH mean it is
  never repaired.
- **Confidence:** high on the discard mechanism (git-diff proves #54 introduced
  it); medium on lag-vs-stall as the reason interim stops at the midpoint.
- **Discriminating evidence, H1 vs stall:** did on-screen live words keep
  updating (even if lagging) past ~8.5s to Done? Lagging-but-moving → H1 (the fix
  resolves it). Frozen at 8.5s → stall (needs the watchdog in part C too).
  Audio-complete does not discriminate — audio is captured locally, independent
  of the realtime channel.
- **Recommended fix:** (A) bounded wait-for-commit-completion, snapshot the
  transcript after it resolves (undo #54's synchronous read while keeping instant
  nav), interim-merge fallback on timeout. Safe because it changes only *when*
  the transcript is read, keeps the lifecycle flush synchronous, and needs no
  transcript-updating upsert. (B) optional guarded one-shot superseding
  server write, gated on a monotonic `final`/generation flag so a lifecycle
  flush can never overwrite Done — required to keep the #23 ordering bug fixed.
- **Doc path:** `docs/superpowers/plans/2026-07-29-issue-69-transcript-truncation-diagnosis.md`
