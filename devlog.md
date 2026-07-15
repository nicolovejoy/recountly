# recountly devlog

## 2026-07-14 — Physical journal archive: voice over vision (decided in shape)

Owner wants to ingest a shelf of old paper journals — group recordings by physical journal,
photograph pages sometimes, read pages aloud to transcribe.

**The fork was voice vs. LLM vision for page text**, and it was raised twice independently: once
here, once by a deliberately code-blind agent given only the functional spec (no schema, no
hint of the current structures, no framing of the question). Both landed on the same fork and
proposed the same experiment. Convergence from different starting points is decent validation
that it *was* the question.

**Decided: voice. No vision/OCR.** Rejected on the merits, not feasibility — reading pages aloud
is the point, not the cost of getting there: *"it's not just about getting it done. I enjoy and
learn from that part."* (Owner's handwriting would likely defeat OCR anyway, but that's the
weaker reason.) A vision spike stays an optional curiosity and blocks nothing.

**That decision deleted the hardest part of the design.** Pulling page text into search sounds
like widening the existing index, but `entries.transcript_tsv` is `GENERATED ALWAYS AS (...)
STORED`, and Postgres generated columns can only reference columns in the *same row* — they
can't reach a child `photos` table. OCR text in search would have meant replacing the search
mechanism (trigger-maintained tsv, a UNION, or denormalizing onto the entry). Voice puts the
transcript on the entry row, where it's already indexed. Search needs no change at all.

**Plan:** a `journals` table; nullable `entries.journal_id`; nullable `entries.written_at` (when
the page was written, distinct from `recorded_at` = when read aloud; search on `coalesce`, and
*not* named `occurred_at` — too close to `recorded_at` to stay unambiguous); a `photos` child
table; an active-journal lock so capture doesn't re-ask which notebook every page. **Photos are
not best-effort** — verified upload, private blob, auth-gated proxy. Issue #10 (closed today) is
exactly why: audio's best-effort design is what let every upload fail silently for weeks, and
that's survivable for audio (the transcript lives) but not for a page photo, which nothing else
captures. One open question, defaulted to no: do photo-only entries need to exist? If they do,
`transcript`/`duration_seconds`/`recorded_at` must loosen — and `duration_seconds` is meaningless
for a photograph. Full plan: `docs/physical-journal-archive.md`.

## 2026-07-14 — Prod was 17 days stale: the Git integration never existed

recountly.org had been serving a bundle from 2026-06-27 for 17 days — missing both the Vercel
Analytics PR (#12) and the Prompt Lab beacon PR (#13), each merged and each shipping nothing.

**The working hypothesis was wrong, and the way it was wrong is the lesson.** The theory
arriving into the session was that a GitHub webhook had been removed, breaking the Vercel Git
integration. The evidence fit: zero deployments after Jun 27, no ERROR-state builds, and
`gh api repos/:owner/:repo/hooks` returning empty. But `GET /v9/projects/<id>` returned
**`link: NULL`**, and `vercel ls --environment=preview` returned **nothing across the project's
entire 43-day history** — not merely nothing since Jun 27. A link that broke on a date leaves
previews from before that date. There were none, because there was never a link. Every deploy
this project ever had was a hand-run `vercel --prod`.

**What made it invisible for 17 days:** the Vercel CLI stamps your *local checkout's* git
metadata (`githubCommitSha`, `githubCommitRef`) onto manual deploys — so the deployment list
looked exactly like a working Git integration. Nothing broke on Jun 27; the workflow simply
moved to merging PRs on GitHub, and on an unlinked project merging a PR deploys nothing, ever.
The gap was just the interval since someone last ran the command.

**It was already written down.** The 2026-06-22 devlog entry below says it plainly: "the
git→Vercel auto-deploy isn't wired — deploys are manual." The fact was never lost, only
un-surfaced — it lived here, while `CLAUDE.md` (the file that actually gets read) listed
`vercel --prod` as *a* command without ever saying it was the *only* path. Fixed by connecting
the repo (Vercel → Settings → Git) and recording the constraint in `CLAUDE.md` itself.

**Two diagnostics retired as unreliable** (both generalize to every Vercel project):
`gh api repos/:owner/:repo/hooks` cannot detect a Git link at all — Vercel connects via a
**GitHub App**, which creates no repo-level webhook; the endpoint returns empty whether linked
or not (verified empty *after* connecting and confirming auto-deploys). Check `link` on
`GET /v9/projects/<id>` instead. And `_vercel/insights` is a stale marker for Vercel Analytics
— `@vercel/analytics` 2.x serves via a randomized anti-adblock path (`/<hash>/script.js`), and
`<Analytics />` injects client-side on mount, so curl never sees it regardless.

**Verified, not assumed.** Preview auto-created 6s after a push (the first preview in project
history); merging PR #14 and PR #11 each auto-deployed production, confirmed by matching the
`dpl_` embedded in the live bundle. Beacon confirmed end-to-end in a real browser → 204 → a row
in Turso `page_views` — the *only* recountly.org row that has ever existed, meaning anything
upstream reading beacon data for recountly had been reading a hole, not a zero.

**Merged PR #11** (issue #10 audio backfill, stranded since 06-27) after a rebase. Its
CLAUDE.md conflict was self-inflicted: this session rewrote the Next Steps region *after*
noting that #11 rewrites that same region. Resolved by keeping #11's richer content (the
issue-#10 write-up and the decided passkeys/PWA plan).

**Decided: no `user_id`, ever — recountly's entries are permanently out of Garm's scope.**
(Garm is the ecosystem-wide `(email, project) → role` grants service.) Single-user is a
deliberate v1 non-goal, not a gap; a spoken journal is the most private data in the ecosystem
and binary authenticated-or-not is the correct design. An unfiltered `user_id` would look
authoritative while enforcing nothing — the same trap as prompt-lab's `project_metadata.private`
— while a filtered one buys multi-tenancy that doesn't exist. The usual "add it early while
it's cheap" argument fails because the backfill is unambiguous at any scale (every row, same
owner, forever), so deferring costs nothing. And the realistic future feature — "share *this
one entry* with X" — wants a per-entry share token, not row ownership. Recorded in
`prompt-lab/docs/garm-needs-assessment.md`; recountly joins bakerylouise-v1 as the second of
seven surveyed repos to be descoped.

## 2026-06-25 → 07-07 — Enrichment, the old-journal import, the audio-store fix, analytics

Backfilled 2026-07-14 from `CLAUDE.md` + PR history; these shipped without their own entries.

**LLM enrichment (PR #7, 06-25).** On save, `POST /api/entries` makes one best-effort
structured-output call to `claude-haiku-4-5` (`messages.parse()` + a Zod schema) producing
title + tags + summary. The raw `transcript` is never modified. Best-effort like audio: any
failure returns `null` and the entry still saves. Haiku is a deliberate cost/latency call —
a one-line swap to a larger model if quality disappoints.

**Markdown import (PR #8, 06-25).** A one-off importer walked the old
`AudioJournal/transcripts/<year>/*.md` tree, parsed `recorded_at` from the `MON_DD_HH.MM`
filenames, and inserted 23 old entries keyed on a deterministic idempotent id. Pure parsers,
vitest-tested. All 23 audio uploads failed at the time (see below) — transcripts landed, audio
didn't.

**Issue #10 — every private audio upload was failing silently (PR #11, fixed 06-27, merged
07-14).** The Blob store `recountly-audio` had been created **public**, but the app uploads
`access: "private"` — so every upload failed, not just the imports: normal prod recordings too
(0 audio across all 26 rows). Blob access is fixed at creation and not toggleable, so the fix
was a new private store, an updated token, and an `--audio-only` importer mode that backfilled
all 23 (23/23, prod playback verified). The failure was invisible precisely *because* audio is
best-effort by design — worth remembering that "best-effort" and "silently broken for weeks"
are the same observation from outside.

**Analytics + beacon (PRs #12 07-06, #13 07-07).** Vercel Web Analytics and the Prompt Lab
visitor beacon added to the root layout. Both merged — and, unknown at the time, neither
reached production for another week; see the 07-14 entry above.

## 2026-06-24 — Shipped to prod, private audio, and Better Auth gate (+ found/fixed a shared-DB)

Took recountly from "Phase 2 verified locally" to "deployed, owner-gated, isolated DB" over
2026-06-22 → 06-24.

**Docs + ship (06-22).** Refreshed living docs to Phase 2-complete; archived the executed
design/plan docs to `docs/archive/`. Opened + merged the `phase-2-persistence` PR, deployed
prod via `vercel --prod` (the git→Vercel auto-deploy isn't wired — deploys are manual). Found
the prod `OPENAI_API_KEY` was wrong (upstream 401) — fixed via the Vercel dashboard (the
`op read | vercel env add` pipe doesn't store reliably on this CLI; it printed the secret).

**Private audio (PR #5, 06-24).** Audio blobs were public-read by URL, so app-gating alone
wouldn't protect them. Switched `uploadAudio` to `access: "private"`; playback now flows
through a new auth-gated `GET /api/audio/[id]` that streams the private blob via
`@vercel/blob`'s `get()`. `audio_url` stores the proxy path `/api/audio/<id>`; old public
test entries keep their direct URLs.

**Better Auth gate (PR #6, 06-24).** Vercel's free tier can't gate production domains
(Standard Protection exempts them; "All Deployments" is $150/mo; Password Protection is
Pro), so we added app-level auth. Chose **Better Auth** (accounts in Neon — matches byside;
keeps auth in our own DB, multi-user-ready). Email+password, **sign-up disabled**, owner
account seeded via `scripts/seed-user.mjs`. Gate is `src/proxy.ts` (⚠️ Next 16 renamed
Middleware → **Proxy**) doing an optimistic cookie check; real enforcement is
`getServerSession` → 401 in the entries/audio/realtime-token routes. `isPublicPath`
(unit-tested) allowlists `/login` + `/api/auth/*`. Verified on prod: unauthenticated `/`
→ 307 `/login`, all `/api/*` → 401; logged-in record→save→play works.

**⚠️ The shared-DB discovery (the big one, 06-24).** The Better Auth migration tried to
`ALTER` *existing* `user`/`session`/`account`/`verification` tables and failed
(`emailVerified contains null values`). Introspection showed recountly's `DATABASE_URL`
pointed at **`neon-gray-coin` — byside's Neon store** (byside tables `listings`/`offers`/…
right next to recountly's `entries`). recountly was reading/writing byside's database; the
migration nearly mutated byside's auth schema (the failure saved it — byside's tables were
left intact). Root cause: the Phase 2 Neon provisioning reused an existing listed store
instead of creating a new one. Fix: created a dedicated `recountly-db` store (Create New,
Neon Auth OFF, no per-deploy Production branch, empty env-var prefix), disconnected
neon-gray-coin from recountly, repointed `DATABASE_URL` (op item `recountly-neon` field
`password` + Vercel), re-ran `db:migrate` + `db:auth-migrate` + `seed:user` against the clean
DB. Added `scripts/db-introspect.mjs` as the diagnosis tool. byside's DB still has 2 stray
recountly `entries` rows (harmless litter, optional drop).

**Tooling added:** `pnpm db:auth-migrate`, `pnpm seed:user`, `pnpm db:introspect`; deps
`better-auth` + `pg`. 112 vitest tests. **Open:** wire recountly.org (Cloudflare apex A →
76.76.21.21, DNS-only) then flip `BETTER_AUTH_URL`; then Phase 3 (search).

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
