# recountly

A private, single-user spoken-word journal — speak, and watch the words appear live, then
save the entry with audio + transcript. It replaces an old Bash CLI (sox + Whisper + dated
markdown folders). Three core bets: **live transcription**, a **phone-usable UI**, and
**clean queryable storage**.

> Authoritative spec: [`recountly-build-prompt.md`](./recountly-build-prompt.md).
> Working context for contributors (human or AI): [`CLAUDE.md`](./CLAUDE.md).
> Running log of decisions and changes: [`devlog.md`](./devlog.md).

## Status

- **Phase 1 (live transcription) — complete & verified.** Tap record, speak, see words
  appear via a direct browser→OpenAI WebRTC connection. Editable type-and-talk transcript,
  one circular record/pause/resume control, resume-able pause (close/reopen with a flush
  window so the tail isn't dropped).
- **Phase 2 (persistence) — in progress.** The pure, tested core is in place (`src/lib/`
  entry model, sortable IDs, parameterized SQL, audio mime picker; `db/schema.sql`). The
  data layer, blob upload, save/list routes, and entry-list UI are next.
- Phases 3 (search) and 4 (LLM enrichment, imports, domain, auth) are roadmap.

## Stack

Next.js 16 (App Router, Turbopack) · React 19 · TypeScript · Tailwind CSS 4 · Vitest.
Live transcription via the **OpenAI Realtime API with ephemeral tokens** — a route handler
mints a short-lived token server-side; the browser streams mic audio directly to OpenAI, so
the server is never in the audio path and `OPENAI_API_KEY` never reaches the client.
Persistence (Phase 2): **Neon Postgres** + **Vercel Blob**, deployed on **Vercel**.

## Develop

Requires Node 20 + pnpm 9 (the lockfile is v9.0; pnpm 10+ needs Node 22.13+).

```bash
pnpm install
op inject -i .env.tpl -o .env.local   # 1Password → gitignored .env.local (OPENAI_API_KEY)
pnpm dev                               # http://localhost:8255  (opens automatically)
```

`pnpm dev:noopen` skips the auto-open. localhost is a secure origin, so the mic prompt works
without https.

### Commands

| | |
|---|---|
| `pnpm dev` | dev server (Turbopack) on :8255, auto-opens the browser |
| `pnpm build` / `pnpm start` | production build / serve it |
| `pnpm lint` | ESLint |
| `pnpm test` | Vitest (node env, pure-logic unit tests) |

## Structure

- `src/lib/` — pure, node-tested logic (no React/DOM): realtime connection orchestration,
  event parsing, the recorder state machine, timer math, transcript caret planning, and the
  Phase 2 entry/SQL/audio/ulid helpers.
- `src/app/` — routes, the `useRecorder` hook (all imperative session state), and the
  presentational components `RecorderClient` composes (`RecordButton`, `RecStatusLine`,
  `TranscriptEditor`, `EventLog`).
- `src/app/api/realtime-token/route.ts` — the only place `OPENAI_API_KEY` lives.
- `db/schema.sql` — the `entries` table.

New non-trivial logic is written test-first. CI (`.github/workflows/ci.yml`) runs lint +
test + build on every push and PR.
