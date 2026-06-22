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
- **Phase 2 (persistence) — complete & verified locally.** On Done the client POSTs the
  transcript + best-effort audio to `/api/entries`; the route uploads audio to Vercel Blob
  and inserts the entry into Neon. `EntryList` renders past entries newest-first with an
  audio player. Real-speech verified on the mini (save → reload → entry persists, audio
  plays full-length). Remaining: open the PR, then deploy + verify on Vercel prod.
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
op inject -i .env.tpl -o .env.local   # 1Password → gitignored .env.local
pnpm db:migrate                        # apply db/schema.sql to Neon (reads .env.local)
pnpm dev                               # http://localhost:8255  (opens automatically)
```

`.env.local` holds three secrets, all sourced from 1Password via the committed `.env.tpl`:
`OPENAI_API_KEY` (live transcription), `DATABASE_URL` (Neon), and `BLOB_READ_WRITE_TOKEN`
(Vercel Blob). Local pulls these from `op` because Vercel marks the integration secrets
write-only — `vercel env pull` returns them blank. `pnpm dev:noopen` skips the auto-open.
localhost is a secure origin, so the mic prompt works without https.

### Commands

| | |
|---|---|
| `pnpm dev` | dev server (Turbopack) on :8255, auto-opens the browser |
| `pnpm build` / `pnpm start` | production build / serve it |
| `pnpm db:migrate` | apply `db/schema.sql` to the `DATABASE_URL` in `.env.local` |
| `pnpm lint` | ESLint |
| `pnpm test` | Vitest (node env, pure-logic unit tests) |

## Structure

- `src/lib/` — pure, node-tested logic (no React/DOM): realtime connection orchestration,
  event parsing, the recorder state machine, timer math, transcript caret planning, and the
  Phase 2 persistence core (entry model, sortable ULIDs, parameterized SQL, the `db`/`blob`
  data-access layers over injectable runners, the audio mime picker, and the client↔route
  `entry-form` contract).
- `src/app/` — routes, the `useRecorder` hook (all imperative session state), and the
  presentational components `RecorderClient` composes (`RecordButton`, `RecStatusLine`,
  `TranscriptEditor`, `EventLog`, `EntryList`).
- `src/app/api/realtime-token/route.ts` — mints ephemeral tokens; the only place
  `OPENAI_API_KEY` lives.
- `src/app/api/entries/route.ts` — `POST` saves an entry (multipart: transcript + audio),
  `GET` lists newest-first.
- `db/schema.sql` — the `entries` table; applied with `pnpm db:migrate`.

New non-trivial logic is written test-first. CI (`.github/workflows/ci.yml`) runs lint +
test + build on every push and PR.
