# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project status: durable save (#23 A+B), move entries (#28), nav polish + audio-duration fix (#41) all shipped 2026-07-19 (PRs #37/#42/#43/#44) — live on recountly.org, auth-gated. Capture/Library/Search tabs, journals, trash, FTS search, move + audit log. 407 vitest tests. Design of record: `docs/organization-and-navigation.md`.

Live transcription works end-to-end: speak and words appear via a direct browser→OpenAI
WebRTC connection (mic meter + in-app error surfacing in place). The transcript is now an
editable type-and-talk `<textarea>` — finalized spoken segments append to the end via the
unit-tested `appendSegment`/`planAppend` helpers (`src/lib/transcript.ts`) without
disturbing the user's caret; Enter inserts a newline instead of toggling recording.
Verified by real speech. The recorder control is one circular button whose action follows
status via the tested `primaryAction` (record → pause → resume), with a `● REC m:ss` /
`PAUSED` timer line and the live mic-level bar. (Persistence landed in Phase 2 — below.)

Structure (post-refactor, 2026-06-12): pure node-tested logic lives in `src/lib/`
(realtime connection orchestration, typed event parsing, the recorder state machine,
cumulative timer math incl. `bankSegment`, caret planning, `primaryAction`); all
imperative session state lives in the `useRecorder` hook; `RecorderClient` is a thin
composition root over presentational `RecordButton`/`RecStatusLine`/`TranscriptEditor`/
`EventLog` components. 126 vitest tests; new logic is written test-first.

**Resume-able Pause is BUILT and real-speech verified (2026-06-13, on the mini).** Design:
close-connection-on-pause / reconnect-on-resume (NOT keep-alive mute); pause cuts the mic
immediately then holds the pc open `FLUSH_MS` (1.5s, left as-is) so the in-flight segment
lands; `bankSegment` freezes/continues the timer; Esc = pause; separate Done (stop) returns
to idle keeping the text. ⚠️ Gotcha fixed in verification: pause **and Done** must send a
manual `input_audio_buffer.commit` over the data channel (kept in `dcRef`) to force the
buffered tail to finalize — Done used to close immediately and dropped everything said since
the last VAD commit. An empty-buffer error from a no-op commit is benign and suppressed.
Affordance rule: **red == capturing only** (connecting = neutral spinner "don't speak yet";
paused = blinking red).

**Phase 2 (persistence) is BUILT and real-speech verified (2026-06-13, on the mini).**
On Done, the client POSTs the transcript + best-effort audio to `POST /api/entries`
(multipart); the route validates, mints a ULID, uploads audio to Vercel Blob, and inserts
into Neon; `GET /api/entries` lists newest-first; `EntryList` renders cards with an audio
player. Decisions made: **`@neondatabase/serverless` + `@vercel/blob`**; **audio is
best-effort single-segment** (transcript always saved; a paused-then-resumed entry keeps
only the last continuous segment) — audio columns nullable. Layers: pure tested core in
`src/lib/` (`db.ts` data-access over the SQL builders w/ injectable runner + lazy neon init;
`blob.ts` upload; `entry-form.ts` the client↔route FormData contract) → `src/app/api/entries/route.ts`
→ MediaRecorder wired into `useRecorder` (fresh recorder per stream; Done finalizes audio
**after** the FLUSH_MS window so the transcript tail is included). 126 vitest tests.

⚠️ **MediaRecorder WebM has no duration header** — Chrome then can't seek and mis-plays
(shows ~8s of a 22s clip, tail only; the audio data is all there). Fixed by patching the
real duration into the blob client-side before upload via `fix-webm-duration`
(`finalizeRecording` in `useRecorder`, WebM only). Verified: playback now spans the full clip.

**Auth gate is BUILT + prod-verified (2026-06-24).** The app is single-user, gated with
**Better Auth** (accounts in Neon, matching byside's stack). Email+password, **sign-up
disabled** (`disableSignUp: true` in `src/lib/auth.ts`) — the owner account is created
out-of-band by `scripts/seed-user.mjs` (`pnpm seed:user`). To go multi-user later, flip
`disableSignUp` and add a sign-up form. Layers: `src/lib/auth.ts` (betterAuth over a `pg`
Pool — not the Neon serverless Pool, which needs ws on Node 20), `auth-client.ts`,
`auth-server.ts` (`getServerSession`), `src/app/api/auth/[...all]/route.ts` (handler),
`src/app/login/page.tsx`. **`src/proxy.ts`** is the gate — ⚠️ Next 16 renamed Middleware →
**Proxy** (`proxy.ts`, not `middleware.ts`); it does an *optimistic* cookie check only
(`getSessionCookie`, presence not signature), so the **real** enforcement is `getServerSession`
returning 401 inside the entries/audio/realtime-token routes. `isPublicPath`
(`src/lib/auth-paths.ts`, unit-tested) allowlists `/login` + `/api/auth/*`.

**Audio blobs are PRIVATE (2026-06-24).** `uploadAudio` uses `access: "private"`; playback
goes through `GET /api/audio/[id]` (auth-gated) which streams the private blob server-side via
`@vercel/blob`'s `get()`. `audio_url` stores the same-origin proxy path `/api/audio/<id>`.
Old pre-2026-06-24 entries kept public direct URLs (disposable test data).

**Secrets/provisioning:** recountly's own Neon store **`recountly-db`** + Vercel Blob
(`recountly-audio`) connected to the Vercel project. Vercel marks integration secrets
write-only, so `vercel env pull` returns `DATABASE_URL`/`BLOB_READ_WRITE_TOKEN` **blank** —
local uses **op** (`op inject`): items `recountly-neon` (field **`password`** — holds
recountly-db's pooled connection string), `recountly-blob` (field `BLOB_READ_WRITE_TOKEN`),
`recountly-better-auth` (field `secret`). Prod stays on Vercel env (`BETTER_AUTH_SECRET`,
`BETTER_AUTH_URL`, `DATABASE_URL`, `BLOB_READ_WRITE_TOKEN`, `OPENAI_API_KEY`). Apply schema
with `pnpm db:migrate` (entries) + `pnpm db:auth-migrate` (Better Auth tables); seed the
owner with `pnpm seed:user`. Local + prod share the one `recountly-db`, so one migrate + one
seed covers both. ⚠️ The OpenAI key must belong to an **active** project — an archived-project
key mints a 401 "project archived".

⚠️ **The Neon "shared DB" trap (cost a big chunk of 2026-06-24).** recountly was originally
provisioned (Phase 2) onto **`neon-gray-coin`, which is byside's Neon store** — the Vercel
Neon integration lists *existing* stores and one got picked instead of creating a new one.
recountly's `entries` were sitting in byside's DB next to byside's tables; a Better Auth
migration nearly altered byside's `user`/`session`/`account`/`verification` tables. Fixed by
creating a dedicated `recountly-db` store (Vercel → Storage → Create Database → Neon →
**Create New**, turn **Neon Auth OFF**, no per-deployment branch on Production, empty env-var
prefix so it emits `DATABASE_URL`), disconnecting neon-gray-coin from recountly, repointing
`DATABASE_URL` (op item + Vercel). Lesson: when provisioning a Vercel-managed Neon DB,
**create a new store**, don't reuse a listed one; `pnpm db:introspect` shows what's actually
in there. (byside's DB still has 2 stray recountly `entries` rows — harmless litter.)

**Phase 3 (search) is BUILT + deployed (2026-06-24).** Postgres FTS over transcripts:
a STORED `transcript_tsv` generated column (`to_tsvector('english', title || transcript)`)
+ a GIN index (`db/schema.sql`); queried via `websearch_to_tsquery('english')` and
relevance-ranked, with an optional inclusive `recorded_at` date range. Pure tested layers:
`searchEntriesSql` + `SearchFilters` (`entry-sql.ts`), `searchEntries` (`db.ts`),
`parseSearchFilters`/`buildSearchQueryString` (`src/lib/search.ts`). `GET /api/entries`
now reads `?q&from&to` (empty == newest-first list). Frontend: `SearchBar` (debounced
query box + date pickers + Clear) with filter state in `EntryList`; tap a transcript to
expand it full-length. Verified against the live DB. 126 vitest tests.

**recountly.org is canonical + live (2026-06-24).** Cert was stuck ~2 days; force-issued
via `vercel certs issue`. `trustedOrigins: ["https://recountly.org","https://recountly.vercel.app"]`
in `auth.ts` + `BETTER_AUTH_URL=https://recountly.org` (prod env) keep both origins logging
in. ⚠️ `vercel env add` (CLI 54.12.2) stored the value EMPTY via both `printf|` and `<file` —
set it via the REST API and verify with `?decrypt=true` (see [[vercel-neon-provisioning-traps]]).

**Partial-audio cue + auth hardening BUILT + deployed (2026-06-24).** (1) A paused-then-
resumed entry keeps only the last audio segment — now flagged via a nullable
`audio_complete` column threaded through the stack (`useRecorder` snapshots whether time was
banked → `audioComplete` on the save payload/route → `EntryList` shows an amber "audio is
partial — transcript is complete" cue when false; old rows stay null). (2) `auth.ts`:
30-day rolling session (`updateAge` 1 day) + `rateLimit.storage: "database"` so Better
Auth's built-in `/sign-in` 3-req/10s throttle holds across Vercel Fluid instances (needs the
`rateLimit` table — `pnpm db:auth-migrate`; verified it records attempts in prod). 130 tests.
(Enrichment + import landed since — now **161 tests**; see Phase 4 below.)

**Phase 4 thread 1 (LLM enrichment) is BUILT + deployed (2026-06-25, PR #7).** On save,
`POST /api/entries` makes one **best-effort** structured-output call to **`claude-haiku-4-5`**
(`messages.parse()` + a Zod schema) generating **title + tags + summary** — the raw
`transcript` is untouched. Best-effort like audio: any failure returns `null` and the entry
still saves (`enrich.ts` catches internally; the route also wraps `getAnthropic()`). Layers:
`anthropic.ts` (lazy client, build-safe), `enrich.ts` (pure tested `buildEnrichmentPrompt`/
`normalizeEnrichment` + injectable-client `enrichTranscript`), the 3 nullable cols
(`summary`/`enriched_at`/`enrichment_model`) threaded through `entry`/`entry-sql` (15 cols, +
`updateEnrichmentSql`/`listUnenrichedSql`)/`db` (+`updateEntryEnrichment`/`listUnenriched`),
`POST /api/entries/enrich` backfill (25 rows/call), `EntryList` (title/summary/tag pills).
**Added `zod`** (CLAUDE.md specified `messages.parse()`+Zod; the no-dep `jsonSchemaOutputFormat`
risks a `next build` typecheck failure — `json-schema-to-ts` types absent). Haiku is the
deliberate cost/latency call (one-line swap to `claude-opus-4-8`). Live API verified.

**Phase 4 markdown import is BUILT + run (2026-06-25, PR #8).** `scripts/import-journal.mjs`
(dry-run by default; `--commit` writes) walks `~/Documents/AudioJournal/transcripts/<year>/*.md`,
parses `recorded_at` from the `MON_DD_HH.MM` filename (local time — runs on the Mac), extracts
the transcript (strips `[MM:SS]` markers), and inserts via raw SQL keyed on a deterministic id
(`imp_<year>_<MON_DD_HH.MM>`, idempotent). Pure parsers in `scripts/journal-parse.mjs` are
vitest-tested (vitest.config now also globs `scripts/**/*.test.mjs`). **Ran `--commit`: 23 old
entries imported to prod with transcript + enrichment (entries table now 26 rows).**

**Issue #10 (audio blob private-access) is RESOLVED + verified (2026-06-27; merged to main
2026-07-14, PR #11).** Root cause was option 1: the Blob store `recountly-audio`
was created **public**, but the app uploads `access:"private"`, so EVERY private upload failed
silently (best-effort) — the 23 imports AND normal prod recordings (queried: 0 audio across all
26 rows). Blob store access is **fixed at creation, not toggleable** (confirmed in Vercel docs),
so the fix was a **new private store**: created `recountly-audio-priv` (`store_TRuOEBLTjj2ja7QE`,
iad1), deleted the old public `recountly-audio` (`store_5BT7nhaetyKHsdF4`, was empty), connected
the new one with an **empty env-var prefix** so it emits the bare `BLOB_READ_WRITE_TOKEN` (no
code change). Updated 1Password `recountly-blob` token + re-ran `op inject`; owner redeployed
prod (`vercel --prod`). Added a `--audio-only` backfill mode to the importer (UPDATEs audio cols
on existing `imp_*` rows, no delete/reimport, idempotent) — ran it: **all 23 imports now have
private audio (23/23)**. Verified: private `get()` returns 200/audio/mp4/exact-bytes AND owner
confirmed prod playback through the gated `/api/audio` proxy. (3 old app-saved rows stay
audio-less — recorded while the store was public; disposable.)

**Physical-journal archive is BUILT + live (2026-07-18, PR #20 backend / PR #21 UI).** Voice-first
ingestion of paper journals per `docs/physical-journal-archive.md`: `journals` table with a
DB-backed active-journal lock (atomic single-statement toggle, `PUT /api/journals/active`),
`entries.journal_id` + `entries.written_at` (search/sort now use the effective date
`coalesce(written_at, recorded_at)`; `?journal=` filter end-to-end), and a `photos` child table —
PRIVATE blobs, **NOT best-effort** (a failed photo upload fails the whole save, 502, no entry
insert; issue #10 is why), served via the gated `GET /api/photo/[id]` proxy. UI: `JournalBar`
(picker + inline create + lock + written-date input via tested local-noon `writtenAtIso`),
`PhotoTray` (attach = client-side downscale to ≤2048px JPEG q0.85 — **load-bearing** under
Vercel's ~4.5MB body cap — plus a tested 4MB aggregate payload guard that rejects pre-POST),
EntryList journal chip / written date / photos-on-expand, SearchBar journal dropdown. Photo-only
entries: decided **NO** (2026-07-16) — drawings get a spoken description as their transcript,
which is also what makes them searchable. **211 vitest tests.** Built via two subagent-driven
plans in `docs/superpowers/plans/` (fresh implementer + reviewer per task + final branch review).

**Phone save bug RESOLVED + save/delete hardening shipped (2026-07-18 evening, PRs #22/#24/
#25/#26 — all merged, deployed, phone-verified).** The "save never reached the DB" symptom was
the documented silent no-op (empty transcript in `RecorderClient.onStop`) compounded by save
status rendering below the fold on iPhone. Shipped: (1) tested `planSave` (`src/lib/save-plan.ts`)
routes empty/too-large/save through one decision point, and save feedback is a **fixed top-of-
viewport toast** (Finishing…/Saving…/Saved ✓ auto-clears/error with dismiss) — "Finishing…"
also makes the 1.5s FLUSH_MS gap visible; deeper iOS hardening (pagehide flush, keepalive,
interim-text merge) is **issue #23**. (2) Entry delete (issue #9) shipped then converted to
**soft-delete trash** on owner request (`deleted_at`; list/search/enrichment exclude trashed;
rows + blobs kept; hard-delete helpers retained for the future purge). (3) Journal integrity:
`journalId` validated before blob upload (orphan-blob window closed), `PUT /api/journals/active`
404s on unknown id via an EXISTS-guarded atomic UPDATE, superseded `entries_recorded_at_desc`
index dropped (migrated). (4) Show more/less only renders when the transcript is measurably
clamped or photos exist (`photo_count` in list/search payloads). **242 vitest tests.**
⚠️ Process lesson: PR previews look like deploys — **smoke tests must first check the header
build timestamp**; prod only redeploys on merge to main.

**Org & navigation redesign (2026-07-18, issues #27–#30) — design shipped.** Approved and now
built: bottom tabs, journals-as-folders Library with Unfiled + Trash, reading-order journal view,
trash as the only place with permanence, `PATCH` move-entry. Still-guiding decisions: **reading
sessions are UI flow not schema** (nullable `entries.page_label` + sticky capture suggestion —
not yet built), search grows into the power tool **over time** (URL-as-state + filter chips, #36).
Route-level integration tests REQUIRED for these features. Design of record:
`docs/organization-and-navigation.md` (merged).

**Shipped 2026-07-19 (day sessions):** #27 trash view (PR #31 — list/restore/purge routes,
`src/lib/purge.ts`, repo's first route-level integration tests, `docs/smoke-checklist.md`);
#29 nav shell (PR #32 — `(tabs)` route group + bottom TabBar, Library/journal/Unfiled/trash
views, `GET /api/journals/summaries`, capture guard, `EntryCard` extracted); covers deferred
→ #33. Phone smoke PASSED; feedback PR #34 (mother-site build stamp, Unfiled in search
dropdown). Plans in `docs/superpowers/plans/`; built via implementer+reviewer subagents.

**Stack assessment (2026-07-19, owner-requested):** stack is sound, no rewrite. Findings:
(1) the 4.5MB body cap is the real wall (audio+photos through one function body) — fix is
`@vercel/blob` client-direct uploads + JSON-only save; (2) that small JSON save fits
`fetch keepalive` (64KB cap!), unlocking the clean #23 fix — same solution, do together;
enrichment should leave the save request path (adds 1–3s Haiku latency to the vulnerable
window; use Next 16 `after()` or the existing backfill); (3) Node 20 is EOL → bump to 22 +
unpin pnpm; (4) photo grids want a ~300px thumb variant stored at save (do with #33);
(5) leave alone: Better Auth, FTS, dual DB drivers, private-blob proxy, serverless.

**#23 durable save FULLY SHIPPED (2026-07-19, PRs #37 Phase A + #44 Phase B).** Plan:
`docs/superpowers/plans/2026-07-19-durable-save.md`. Phase A: auth-gated `POST /api/blob/upload`
token route; client-direct PRIVATE uploads (`blob-upload.ts`; audio best-effort, photos
fail-the-save); `POST /api/entries` is small JSON (`save-payload.ts`, client-minted ULID) with
`keepalive` under a tested 60KB guard — 4.5MB body cap gone; enrichment via `after()`;
idempotent inserts (entries audio-attach upsert, photos DO NOTHING). ⚠️ `onUploadCompleted`
never fires on localhost — deliberately unused; the JSON POST is the write path. Phase B:
`stop()` merges the interim tail (accepted rare double-append); `pagehide`/`visibilitychange`
flush POSTs transcript-only keepalive + persists a pending record (backgrounding mid-recording
= **implicit Done** — interacts with #38's continuous-capture ask); IndexedDB pending-save
queue (`pending-save.ts`/`idb-pending.ts`/`PendingSaveRecovery`) persists body+Blobs before
uploads, deletes only on full-refs 201, retries on next open (4xx purges, 5xx/network retries).
⚠️ The entry upsert is **transcript-first-write-wins** — recovery repairs audio/photos, never
transcript; the flush therefore merges the interim tail BEFORE reading the editor (branch
review caught the permanent-truncation ordering bug). Phone smoke of the 3 Phase B behaviors
(lock-after-Done, background mid-recording, airplane recovery) still pending at handoff.

**Shipped 2026-07-19 evening (PRs #42/#43):** wordmark → home `Link` styled as a REC lamp
(`BrandLamp` + tested `lampStyle`; CaptureGuard carries `RecorderStatus`; green idle / neutral
connecting / red live / blinking-red paused); journal view defaults newest-first with a sort
menu (client-only; API already supported both); **#41 fixed TDD** — `/api/audio/[id]` answers
real Range requests (iOS reads duration via byte-range probes; `@vercel/blob` `get()` has no
Range passthrough so the blob is sliced server-side) + `preload="metadata"`; **#28 move
entries** — `PATCH /api/entries/[id]` `{journalId|null}` with atomic move+`entry_moves` audit
log in one CTE (`from_journal_id` read under `FOR UPDATE`), Move… picker on cards, bulk-file
select mode in Unfiled. ⚠️ purge must delete `entry_moves` rows before the entry (no CASCADE —
same idiom as photos; review caught the FK 500). Browser smoke on prod: 7/7 pass (Playwright
subagent; profile already held a session so no credentials were handled; all moves reversed).

**Next Steps**:
- **Owner phone-smokes Phase B** per `docs/smoke-checklist.md` (build stamp first): Done→lock,
  background mid-recording, airplane recovery. Then close **#23** (and **#30** — design + all
  children shipped; owner to confirm).
- **#38/#39** capture-session UX + entry detail page (post-save nav, whole-card tap,
  continuous capture; note Phase B's backgrounding-= -implicit-Done) — short design pass first.
- **#35** mother-site style pass + desktop top-nav (style vocabulary in the issue).
- **Node 22 + pnpm 10 chore PR (owner approved)** — before passkeys; owner installs Node
  locally; verify the Vercel project's Node runtime.
- Then: capture polish (`page_label` + sticky) → **#36** search increments (URL-as-state
  first) → **#33** covers (+ ~300px thumb variant) → **#40** remainder (bulk trash, select in
  journal/search views). Parked: sequential photo uploads + photoless-entry 500 (Phase A
  review nits), EXIF portrait on iPhone, optimistic journal-switch, photo-fetch retry,
  orphan-blob purge sweep.
- **Passkeys (WebAuthn) primary + email/password as break-glass fallback** (NOT SMS — rejected as
  weakest 2FA; NOT Sign in with Apple — needs $99 dev program). Better Auth `passkey()` plugin:
  add to `src/lib/auth.ts` (`rpID: "recountly.org"` + localhost), `passkeyClient()` in
  `auth-client.ts`, login-page "Sign in with Face ID" + conditional autofill. Adds a `passkey`
  table → `pnpm db:auth-migrate` (safe — dedicated `recountly-db`). Single-user enrollment: log
  in w/ password once → "Add this device" → register; keep password enabled. **Verify the current
  Better Auth passkey API against their docs before coding.**
- **PWA (do this, not a native wrapper yet):** web manifest + Apple touch icons + `display:
  standalone` so "Add to Home Screen" gives a full-screen iPhone app. Passkeys + mic recording
  both work in an iOS Safari PWA (same WebKit/origin). Capacitor wrapper deferred (complicates
  WebAuthn origin + needs Apple dev program; revisit only for background-audio / App Store). Open
  Q: passkeys+PWA in one branch or two (passkeys first).
- Optional: drop the 2 stray `entries` rows in byside's `neon-gray-coin` DB (owner passed).

**Garm / multi-user: decided NO (2026-07-14).** recountly's `entries` will **not** get a
`user_id` column, and the app's entries are permanently out of Garm's (the ecosystem grants
service) scope. Single-user is a deliberate v1 non-goal, not a gap — a spoken journal is the
most private data in the ecosystem, and binary authenticated-or-not is correct here. An
unfiltered `user_id` would look authoritative while enforcing nothing; a filtered one buys
multi-tenancy that doesn't exist. "Add it early while it's cheap" fails because the backfill is
unambiguous at any scale (every row, same owner). The realistic future — "share *this one entry*"
— wants a per-entry share token, not row ownership. Garm can still carry `recountly` as a
*project* (dashboard metadata) with zero changes here. Full reasoning:
`~/src/prompt-lab/docs/garm-needs-assessment.md`. Revisit only if a real second person needs to
write entries.

⚠️ Gotcha learned the hard way: the OpenAI `client_secrets` mint endpoint does **not**
validate the transcription model name. A bogus name (we had `gpt-realtime-whisper`) mints
a token fine, then `/v1/realtime/calls` hangs ~15s → Cloudflare 504 with no CORS headers →
the browser misreports it as a CORS error. Verified-good models: `gpt-4o-transcribe`,
`gpt-4o-mini-transcribe`, `whisper-1`.

⚠️ Gotcha: `op read … | vercel env add NAME production` does **not** reliably store the value
on this CLI version (it printed the secret to the terminal instead) — for prod secrets, use
the Vercel dashboard "Add Environment Variable" and paste from 1Password. Bit us on both
`OPENAI_API_KEY` and `BETTER_AUTH_SECRET`.

**Read `recountly-build-prompt.md` in full before starting.** It is the authoritative spec;
this file is a distilled pointer to its decided constraints. Executed Phase 1/UI design
docs are archived under `docs/archive/` (historical only — trust `src/` + this file).

### Stack as built
- **Next.js 16** (App Router, Turbopack), **React 19**, **TypeScript**, **Tailwind CSS 4**.
- **Better Auth** (`better-auth`) + **`pg`** for the owner gate; `@neondatabase/serverless`
  for entry queries; `@vercel/blob` for audio.
- Source under `src/`, import alias `@/*`. Package manager: **pnpm** (pinned to v9 — pnpm 10+
  requires Node 22.13+, and this machine runs Node 20; do not upgrade pnpm past v9 without
  bumping Node first).
- ⚠️ **This is Next.js 16, which has breaking changes vs. older versions** (see `AGENTS.md`).
  Before writing route handlers, server actions, or anything non-trivial, consult the
  relevant guide in `node_modules/next/dist/docs/` rather than relying on memory of older
  Next.js APIs.

### Commands
- `pnpm dev` — dev server (Turbopack) at http://localhost:8255 (fixed port "TALK"
  on a phone keypad — avoids the crowded :3000 and collisions with other local apps)
- `pnpm build` — production build
- `pnpm start` — serve the production build
- `pnpm lint` — ESLint
- `pnpm test` — Vitest (node env, pure-logic unit tests; 242 and counting)
- `pnpm db:migrate` — apply `db/schema.sql` (entries) to `DATABASE_URL` in `.env.local`
- `pnpm db:auth-migrate` — apply Better Auth's schema (user/session/account/verification)
- `pnpm seed:user` — create the owner account: `SEED_EMAIL=… SEED_PASSWORD=… pnpm seed:user`
- `pnpm db:introspect` — read-only: list tables + columns + row counts (DB sanity check)
- `vercel` — deploy a preview; `vercel --prod` — deploy to production (manual escape hatch)

⚠️ **Deploys were manual-only until 2026-07-14** — the Vercel project had never been linked
to GitHub (`link: NULL`, zero previews in 43 days), so every deploy came from a hand-run
`vercel --prod` and the CLI stamped local git metadata onto it, which reads misleadingly like
a Git integration. Merging PRs #12/#13 therefore shipped nothing and prod sat 17 days stale.
Fixed by connecting the repo (Vercel → Settings → Git); **main now auto-deploys to production
and every PR gets a preview**. Diagnostic note: Vercel connects via a **GitHub App**, so
`gh api repos/:owner/:repo/hooks` returns empty whether or not the project is linked — it is
not evidence either way. Check `link` on `GET /v9/projects/<id>` instead.
- Local secrets: `op inject -i .env.tpl -o .env.local` (1Password) mints the gitignored
  `.env.local` holding `OPENAI_API_KEY`, `DATABASE_URL` (Neon), `BLOB_READ_WRITE_TOKEN`
  (Vercel Blob), `BETTER_AUTH_SECRET`, and `BETTER_AUTH_URL`. `pnpm dev` auto-opens the
  browser; `pnpm dev:noopen` doesn't. ⚠️ The app is now gated — at `/` you'll be redirected
  to `/login`; sign in with the seeded owner account.

## What recountly is

A private, single-user spoken-word journaling web app. The owner speaks into their device
(phone or desktop), **sees words appear live as they talk**, and saves the result as a
journal entry with audio + transcript. It replaces an old Bash CLI (sox + Whisper + dated
markdown folders). The three reasons the rewrite exists — treat these as the core bets:
1. Live transcription (words on screen while speaking, not after).
2. A real, phone-usable responsive UI.
3. Clean queryable storage (a database, not a `MON_DD_HH.MM` directory tree).

Single user, the owner only. No multi-tenant, no sharing, no accounts for others.

## Stack (decided — do not relitigate without flagging the owner)

- **Next.js App Router + TypeScript**, deployed on **Vercel**.
- **Live transcription: OpenAI Realtime API with ephemeral tokens.** This is the key
  architectural choice that makes Vercel's serverless model viable:
  - A Next.js route handler mints a short-lived ephemeral token using the secret
    `OPENAI_API_KEY` (server-side only).
  - The **browser connects directly to OpenAI via WebRTC** with that throwaway token,
    streams mic audio, and receives interim + final transcription deltas live.
  - The server is **never in the audio path** — no long-lived connections on Vercel, and
    the API key never reaches the browser.
  - Use the **transcription-oriented realtime session** (input audio transcription with a
    `gpt-4o-transcribe`-class model), NOT the speech-to-speech voice-agent flow.
- **Entry index + transcripts: Neon Postgres** (Vercel's managed Postgres).
- **Audio blobs: Vercel Blob** for v1. Cloudflare R2 is the noted later alternative.
- **Auth: single-user.** Vercel deployment password protection is acceptable for v1;
  Auth.js or Clerk locked to the owner's identity is the keeper version.

The owner accepts audio going to OpenAI for transcription. Secrets stay server-side; the
browser only ever holds ephemeral tokens. **Never expose `OPENAI_API_KEY` client-side.**

⚠️ The OpenAI realtime/transcription API changes often. **Verify the current endpoint
shape, session config, and transcription model name against official OpenAI docs before
coding** — do not trust any example (including the one in the brief) blindly.

## Data model

Database-as-index, blobs stored by stable ID — no nested directory hierarchy.

`entries` table (refine as needed):
- `id` — ULID or similar sortable stable ID (primary key)
- `recorded_at` — timestamptz (when spoken)
- `created_at` / `updated_at` — timestamptz
- `duration_seconds` — number
- `transcript` — text (final transcript)
- `title` — text, nullable (LLM-generated later)
- `tags` — text[] (or a join table)
- `audio_url`, `audio_mime`, `audio_bytes` — blob reference + metadata

Audio files are named by the entry's stable ID. The DB is the organization.

## Build order (one phase at a time, verify before moving on)

- **Phase 0** — Scaffold Next.js + TS, deploy hello-world to Vercel, confirm it loads on
  the owner's phone. Establishes the pipeline.
- **Phase 1 (the core bet)** — Mic capture → ephemeral-token route → direct OpenAI Realtime
  connection → interim words render live on screen. Persistence stubbed. Deliverable: "I
  talk, I watch the words appear." Demo this before building anything else.
- **Phase 2** — Persistence: on stop, MediaRecorder captures audio → upload blob to Vercel
  Blob → write entry to Neon. Simple newest-first entry-list view.
- **Phase 3** — Search: Postgres full-text search over transcripts, date filter, tap an
  entry to read transcript and play audio.
- **Phase 4 (roadmap, not v1)** — LLM enrichment (clean transcript, auto title, tags,
  summary); import old markdown transcripts (`MON_DD_HH.MM` under
  `AudioJournal/transcripts/<year>/`); wire up the `recountly.org` domain; harden auth.

## Non-goals for v1 (do not build)

- No per-segment `[MM:SS]` timestamps or confidence metrics (old app had them; owner
  doesn't use them).
- No on-device/offline transcription — cloud (OpenAI) is fine.
- No multi-user, no native mobile app — responsive web for one person.
- No speaker diarization yet.

## v1 acceptance criteria (Phases 0–3)

- Owner opens the URL on their phone, taps record, sees words appear live.
- Tapping stop saves the entry; audio + transcript persist and survive reload.
- Entry list shows past entries newest-first; tapping one shows transcript and plays audio.
- Keyword search returns matching entries.
- `OPENAI_API_KEY` is never exposed client-side; only ephemeral tokens reach the browser.
- The app is gated so only the owner can reach it.

## Working style

- Plan before coding; confirm the approach before implementing.
- One phase at a time; verify each works — especially Phase 1, demo live words before
  building persistence.
- Keep it simple. Personal tool for one user, not a product.
- Use the latest stable Next.js (App Router conventions) and the current OpenAI SDK.

<!-- SHARED-CONVENTIONS:BEGIN v=d5e16e653242 — auto-managed, do not edit here; source: prompt-lab/workflow/claude-md-shared.md (edit + re-sync) -->
## Shared conventions

<!-- These are Nico's cross-repo output rules. They're materialized into each repo's
CLAUDE.md so every agent (local, cloud, third-party) sees them as plain text. Source
of truth: prompt-lab/workflow/claude-md-shared.md — edit there and re-sync, never here. -->

- **Clickable URLs.** When pointing at any web destination (dashboard, repo, PR, deploy, settings, docs, localhost), print the full bare URL — `https://example.com` or `http://localhost:8080` — on its own, never just the page's name and never a markdown `[label](url)` link. Nico's terminal auto-linkifies raw `https://` text, so a bare URL is one-click and stays copyable.

- **Number your questions.** Any time you ask Nico more than one question, present them as a numbered list (1., 2., 3.) so he can answer by number with no ambiguity. A single standalone question needs no number.

- **Self-contained smoke-test instructions.** When you ask Nico to manually test or verify an app or website, assume zero carried-over context — he should never scroll back or recall a URL/path/credential from earlier. Always include: the exact URL (full `https://…` or `http://localhost:…`, restated even if mentioned above), the precise steps in order, and what a pass vs. fail looks like. Repetition here is a feature, not clutter.

- **No marker before a copy-paste command block.** Nico's terminal renders markdown bullets (`-`, `*`, `•`) as `●`, which breaks paste into zsh. The line directly above a fenced command block must be a plain-text label ending in a colon — never a bullet, dash, asterisk, or number. For loud copy targets, lead the label with `📋` + bold `COPY THE BELOW`, then a colon, then the block.
<!-- SHARED-CONVENTIONS:END -->
