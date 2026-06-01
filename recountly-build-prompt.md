# Build brief: `recountly` — a spoken-word journal web app

You are starting a brand-new project in an empty directory. Build **recountly**, a
personal audio-journaling web app. This document is the complete spec — you have no
prior context, so everything you need is here. Read it fully, propose a plan, confirm
the approach, then build iteratively (one phase at a time, verify before moving on).

---

## What it is

A private web app where the user speaks into their device and **sees the words appear
live as they talk**, then saves the result as a journal entry. It replaces an older
Bash CLI tool (sox + Whisper + dated markdown files) that worked but couldn't do live
transcription and had a clunky terminal UI and a "busy" nested-directory storage format.

The whole point of the rewrite is three things the old version couldn't do:
1. **Live transcription** — words on screen as you speak, not after.
2. **A real UI**, usable **from a phone** (it's a journal — you capture wherever you are).
3. **Clean storage** — a queryable database, not a tree of `MON_DD_HH.MM` folders.

Single user. Just the owner. No multi-tenant, no sharing, no accounts-for-others.

---

## Stack (decided — don't relitigate without flagging)

- **Next.js (App Router, TypeScript)** deployed on **Vercel**. The owner hosts their
  other projects on Vercel and wants phone access via a normal URL.
- **Live transcription: OpenAI Realtime API using ephemeral tokens.** This is the key
  architectural choice and the reason Vercel's serverless model works here:
  - A Next.js route handler (server-side) mints a **short-lived ephemeral token** using
    the secret `OPENAI_API_KEY`.
  - The **browser connects directly to OpenAI** (WebRTC) with that throwaway token and
    streams mic audio, receiving transcription deltas (interim + final) live.
  - Your server is **not** in the audio path, so there's no long-lived-connection
    problem on Vercel, and the API key never reaches the browser.
  - ⚠️ The OpenAI realtime/transcription API changes often. **Verify the current
    endpoint shape, session config, and transcription model name against the official
    OpenAI docs before coding** — do not trust any example (including this one) blindly.
    You want the transcription-oriented realtime session (input audio transcription with
    a `gpt-4o-transcribe`-class model), not the speech-to-speech voice agent flow.
- **Entry index + transcripts: Neon Postgres** (Vercel's default managed Postgres).
- **Audio blobs: Vercel Blob** for v1 (zero-config, in-ecosystem). Cloudflare R2 is the
  provider-neutral alternative for later if egress/lock-in becomes a concern.
- **Auth: single-user.** For v1, Vercel deployment password protection is acceptable.
  Prefer Auth.js (or Clerk) locked to the owner's single identity for the keeper version.

The owner is comfortable with audio going to OpenAI for transcription — privacy bar is
relaxed. Secrets stay server-side; the browser only ever holds ephemeral tokens.

---

## Data model (clean — this was a sore point in the old app)

Database-as-index, blobs on disk by stable ID. No nested directory tree.

`entries` table (sketch — refine as needed):
- `id` — ULID or similar sortable stable ID (primary key)
- `recorded_at` — timestamptz, when the entry was actually spoken
- `created_at` / `updated_at` — timestamptz
- `duration_seconds` — number
- `transcript` — text (the final transcript)
- `title` — text, nullable (can be auto-generated later by an LLM pass)
- `tags` — text[] (or a join table if you prefer)
- `audio_url` — reference to the blob
- `audio_mime`, `audio_bytes` — metadata

Audio files named by the entry's stable ID. The DB is the organization; there is no
year/month folder hierarchy.

---

## Phased plan (build and verify one at a time)

**Phase 0 — Scaffold & deploy.** Next.js + TypeScript app, deploy a hello-world to
Vercel, confirm it loads on the owner's phone. Establishes the pipeline end to end.

**Phase 1 — Live transcription prototype (the core bet).** Mic capture in the browser →
ephemeral token route → direct OpenAI Realtime connection → **interim words render live
on screen** as the owner speaks. This validates the entire premise. Persistence can be
stubbed; the deliverable is "I talk, I watch the words appear." Get this working and
demoed before anything else.

**Phase 2 — Persistence.** On stop: record the audio locally (MediaRecorder), upload the
blob to Vercel Blob, write the entry (transcript + metadata) to Neon Postgres. Build a
simple entry-list view that reads them back.

**Phase 3 — Search.** Full-text search over transcripts (Postgres FTS is plenty). Filter
by date. Tap an entry to read it and play its audio.

**Phase 4 — Roadmap (not v1).**
- **LLM enrichment pass**: clean up the raw transcript, auto-generate a title, suggest
  tags/themes, maybe a one-line summary. This is the layer the old app entirely lacked
  and is likely where the real day-to-day value lives.
- Import the owner's existing transcripts from the old app (markdown files in
  `MON_DD_HH.MM` format under an `AudioJournal/transcripts/<year>/` tree) into the DB.
- Custom domain: the owner has registered **recountly.org** — wire it up. Until then,
  ship on the free `*.vercel.app` URL; do not block on the domain.
- Harden auth to proper single-identity Auth.js/Clerk.

---

## Non-goals (explicitly out of scope for v1)

- No per-segment `[MM:SS]` timestamps or confidence metrics. The old app had these; the
  owner doesn't use them. Don't rebuild them.
- No on-device/offline transcription. Cloud (OpenAI) is fine.
- No multi-user, no native mobile app — it's a responsive web app for one person.
- No speaker diarization (yet).

---

## Acceptance criteria for v1 (Phases 0–3)

- Owner opens the URL on their phone, taps record, and sees their words appear live.
- Tapping stop saves the entry; audio + transcript persist and survive reload.
- The entry list shows past entries newest-first; tapping one shows the transcript and
  plays the audio.
- Search by keyword returns matching entries.
- The OpenAI API key is never exposed client-side; only ephemeral tokens reach the browser.
- The app is gated so only the owner can reach it.

---

## Cost note (for the owner's awareness)

OpenAI API billing is **separate** from ChatGPT Plus ($20/mo does not include API usage).
Transcription runs roughly $0.006/min of audio (a 10-min entry ≈ $0.06; daily journaling
≈ $1–2/mo). Cheap, but it is a distinct pay-as-you-go account — confirm current pricing.

---

## Working style

- Plan before coding; confirm the approach before implementing.
- One phase at a time; verify each works (especially Phase 1 — get live words on screen
  and demo it before building persistence).
- Keep it simple. This is a personal tool for one user, not a product.
- Match modern Next.js App Router conventions; use the latest stable Next.js and the
  current OpenAI SDK.
