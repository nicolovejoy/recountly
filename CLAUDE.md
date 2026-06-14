# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project status: Phase 2 complete (live transcription + editable transcript + persistence)

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
`EventLog` components. 111 vitest tests; new logic is written test-first.

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
**after** the FLUSH_MS window so the transcript tail is included). 111 vitest tests.

⚠️ **MediaRecorder WebM has no duration header** — Chrome then can't seek and mis-plays
(shows ~8s of a 22s clip, tail only; the audio data is all there). Fixed by patching the
real duration into the blob client-side before upload via `fix-webm-duration`
(`finalizeRecording` in `useRecorder`, WebM only). Verified: playback now spans the full clip.

**Secrets/provisioning (mini):** Neon (`neon-gray-coin`) + Vercel Blob (`recountly-audio`)
connected to the Vercel project. Vercel marks integration secrets write-only, so
`vercel env pull` returns `DATABASE_URL`/`BLOB_READ_WRITE_TOKEN` **blank** — local uses
**op** instead (`op inject`): items `recountly-neon` (field `credential`) + `recountly-blob`
(field `BLOB_READ_WRITE_TOKEN`); prod stays on Vercel env. Apply schema with `pnpm db:migrate`.
⚠️ The OpenAI key must belong to an **active** project — an archived-project key mints a
401 "project archived" (cost a chunk of a session to diagnose).

**Next:** open the PR for `phase-2-persistence` → deploy a preview + verify save/list on
prod (set `DATABASE_URL`/`BLOB_READ_WRITE_TOKEN`/`OPENAI_API_KEY` are live in Vercel env) →
Phase 3 (Postgres full-text search over transcripts + date filter). Deferred polish: the
"audio not fully captured this entry" cue after a pause.

⚠️ Gotcha learned the hard way: the OpenAI `client_secrets` mint endpoint does **not**
validate the transcription model name. A bogus name (we had `gpt-realtime-whisper`) mints
a token fine, then `/v1/realtime/calls` hangs ~15s → Cloudflare 504 with no CORS headers →
the browser misreports it as a CORS error. Verified-good models: `gpt-4o-transcribe`,
`gpt-4o-mini-transcribe`, `whisper-1`.

**Read `recountly-build-prompt.md` in full before starting.** It is the authoritative spec;
this file is a distilled pointer to its decided constraints.

### Stack as built
- **Next.js 16** (App Router, Turbopack), **React 19**, **TypeScript**, **Tailwind CSS 4**.
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
- `pnpm test` — Vitest (node env, pure-logic unit tests; 91 and counting)
- `vercel` — deploy a preview; `vercel --prod` — deploy to production
- Local secrets: `op inject -i .env.tpl -o .env.local` (1Password) mints the gitignored
  `.env.local` holding `OPENAI_API_KEY`. `pnpm dev` auto-opens the browser; `pnpm dev:noopen`
  doesn't.

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
