# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project status: Phase 1 core working (live transcription)

Live transcription works end-to-end: speak and words appear via a direct browser→OpenAI
WebRTC connection (mic meter + in-app error surfacing in place). Persistence is still
stubbed. **Next:** build the editable type-and-talk transcript — full plan at
`docs/superpowers/plans/2026-06-03-editable-transcript.md` — then Phase 2 (persistence).

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
- `pnpm dev` — dev server (Turbopack) at http://localhost:3000
- `pnpm build` — production build
- `pnpm start` — serve the production build
- `pnpm lint` — ESLint
- `vercel` — deploy a preview; `vercel --prod` — deploy to production
- No test runner is set up yet — add one when the first non-trivial logic lands.

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
