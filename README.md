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
- **Phase 2 (persistence) — complete, deployed, verified on prod.** On Done the client POSTs
  the transcript + best-effort audio to `/api/entries`; the route uploads audio to Vercel
  Blob (private) and inserts the entry into Neon. `EntryList` renders past entries
  newest-first with an audio player (served through an auth-gated proxy). Live on
  https://recountly.vercel.app.
- **Auth — single-user gate, live.** The whole app is gated with **Better Auth**
  (email+password, sign-up disabled, accounts in Neon); unauthenticated requests are bounced
  to `/login` and the API returns 401. recountly.org will be wired next.
- Phase 3 (search) and Phase 4 (LLM enrichment, imports) are roadmap.

## Stack

Next.js 16 (App Router, Turbopack) · React 19 · TypeScript · Tailwind CSS 4 · Vitest.
Live transcription via the **OpenAI Realtime API with ephemeral tokens** — a route handler
mints a short-lived token server-side; the browser streams mic audio directly to OpenAI, so
the server is never in the audio path and `OPENAI_API_KEY` never reaches the client.
Persistence: **Neon Postgres** + **Vercel Blob** (private), deployed on **Vercel**. Auth:
**Better Auth** (email+password, single owner), accounts in Neon.

## Develop

Requires Node 20 + pnpm 9 (the lockfile is v9.0; pnpm 10+ needs Node 22.13+).

```bash
pnpm install
op inject -i .env.tpl -o .env.local    # 1Password → gitignored .env.local
pnpm db:migrate                         # entries schema → Neon (reads .env.local)
pnpm db:auth-migrate                     # Better Auth tables → Neon
SEED_EMAIL=you@example.com SEED_PASSWORD=… pnpm seed:user   # one-off: create the owner
pnpm dev                                # http://localhost:8255  (opens automatically)
```

`.env.local` holds (all from 1Password via the committed `.env.tpl`): `OPENAI_API_KEY` (live
transcription), `DATABASE_URL` (Neon — store `recountly-db`), `BLOB_READ_WRITE_TOKEN` (Vercel
Blob), and `BETTER_AUTH_SECRET` + `BETTER_AUTH_URL` (auth). Local pulls these from `op`
because Vercel marks integration secrets write-only — `vercel env pull` returns them blank.
The app is gated: at `/` you're redirected to `/login` — sign in with the seeded owner
account. `pnpm dev:noopen` skips the auto-open. localhost is a secure origin, so the mic
prompt works without https.

### Commands

| | |
|---|---|
| `pnpm dev` | dev server (Turbopack) on :8255, auto-opens the browser |
| `pnpm build` / `pnpm start` | production build / serve it |
| `pnpm db:migrate` | apply `db/schema.sql` (entries) to `DATABASE_URL` in `.env.local` |
| `pnpm db:auth-migrate` | apply Better Auth's schema (user/session/account/verification) |
| `pnpm seed:user` | create the owner account (`SEED_EMAIL=… SEED_PASSWORD=…`) |
| `pnpm db:introspect` | read-only: list tables + columns + row counts |
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
  Plus the auth core: `auth.ts` (Better Auth over a `pg` Pool), `auth-client.ts`,
  `auth-server.ts` (`getServerSession`), and `auth-paths.ts` (the gate's public-path
  allowlist, unit-tested).
- `src/proxy.ts` — the auth gate (Next 16 "Proxy", formerly Middleware): redirects
  unauthenticated page requests to `/login` and 401s the API; real validation happens in the
  routes via `getServerSession`.
- `src/app/api/realtime-token/route.ts` — mints ephemeral tokens; the only place
  `OPENAI_API_KEY` lives.
- `src/app/api/entries/route.ts` — `POST` saves an entry (multipart: transcript + audio),
  `GET` lists newest-first. `src/app/api/audio/[id]/route.ts` — streams an entry's private
  audio blob. `src/app/api/auth/[...all]/route.ts` — Better Auth handler.
- `src/app/login/page.tsx` — owner sign-in.
- `db/schema.sql` — the `entries` table (`pnpm db:migrate`); Better Auth owns its own tables
  (`pnpm db:auth-migrate`).

New non-trivial logic is written test-first. CI (`.github/workflows/ci.yml`) runs lint +
test + build on every push and PR.
