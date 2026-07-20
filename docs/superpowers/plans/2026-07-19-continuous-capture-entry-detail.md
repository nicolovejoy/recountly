# Continuous Capture (#38) + Entry Detail (#39) — Implementation Plan

> Executed by fresh implementer + reviewer subagents per task, final branch review at
> the end of each PR. Track progress via the `- [ ]` checkboxes.

**Goal:** Two owner-approved features, sequenced as two independent PRs.
- **#39 (PR1, ships first):** a per-entry detail page at `/entry/[id]` inside the `(tabs)`
  group — transcript-first layout, reachable from Library/Search/post-save, whole
  `EntryCard` becomes the tap target, photo thumbnails on the collapsed card. Plus the
  post-save redirect (Done → `/entry/[id]`), which depends only on a successful save.
- **#38 (PR2, builds on PR1):** continuous-capture semantics — *nothing is a new entry
  until Done*; backgrounding while live = implicit **pause** + a persisted resumable
  draft (NOT implicit Done); tapping record when a paused session exists = **resume** the
  same entry; silence does nothing; a desktop "listening" affordance on the textarea.

PR1 is independently shippable and PR2's post-save UX lands on it, so PR1 first.

**Architecture:** unchanged layering — pure tested logic in `src/lib/`, thin route
handlers, thin hooks/components. No schema change (design-of-record holds: reading
sessions / continuous capture are UI + client state, not columns). Continuous capture is
entirely client state in `useRecorder` + `RecorderClient` (keep `entryIdRef` alive across
a pause; route the button to `resume`). The detail page is one additive
`GET /api/entries/[id]` over the existing `getEntry` data layer.

**Tech stack:** unchanged. Next.js 16.2.7 (App Router, `params` is a Promise in dynamic
segments — already the house pattern, see `(tabs)/library/[journalId]/page.tsx`),
`useRouter` from `next/navigation` for the client-side post-save push, pnpm 9 / Node 20,
vitest node env.

⚠️ **Consult Next 16 docs before writing route/page code**
(`node_modules/next/dist/docs/`), specifically: dynamic-segment `page.tsx` `params`
Promise convention; `useRouter().push` vs `redirect()` (post-save nav is in a **client**
component, so `useRouter` — not the server `redirect`); and route-handler conventions
for the additive `GET`. Do not trust memorized older-Next APIs.

---

## The critical design tension and its resolution (read before PR2)

The save upsert is **transcript-first-write-wins** (`entry-sql.ts`:
`ON CONFLICT (id) DO UPDATE SET audio_… WHERE entries.audio_url IS NULL` — the DO UPDATE
touches audio columns only; the transcript is never overwritten). Today the lifecycle
handler (`RecorderClient.fire()`) treats a backgrounded tab as an implicit **Done**:
`stop()` + a transcript-only keepalive POST under `entryIdRef`. Under the new model where
backgrounding is a **pause**, if that flush still POSTed a partial transcript under id X
and Done later POSTed a longer transcript under the same id X, the upsert would keep the
**partial** — permanent truncation.

**Resolution — option (i): backgrounding persists to IndexedDB only; no server POST.**
Backgrounding a live/connecting/paused session calls `pause()` and writes/refreshes the
resumable IndexedDB draft (transcript-only, `audio: null`) under the live `entryIdRef` —
it does **not** POST. Done stays the only path that writes a transcript to the server, so
no partial can ever precede or lose to it and the upsert is left exactly as-is (no schema
change, honoring the design memo). Durability net unchanged: `PendingSaveRecovery`
reseals the IDB draft on next open (idempotent `ON CONFLICT`).

**Honest durability tradeoff:** vs today we stop POSTing a partial on background, so an
entry that is backgrounded, then hard-killed by iOS, *and never reopened on that device*
is lost — today it would have left a partial server row. In exchange we (a) delete the
truncation bug entirely, (b) honor "nothing is an entry until Done" (no junk half-entries
appearing in Library on every incidental screen-lock — the exact surprise #38 exists to
remove), and (c) keep zero schema change. The lost-forever case requires
kill-*and*-never-return on a single-user tool on the owner's own phone, where reopening
is near-certain and recovery then reseals the draft — an acceptable trade.

**Bookkeeping this forces (all in PR2 Task 2):**
- `flushFiredRef` is re-armed on `visibilitychange → visible` and `pageshow` (already
  wired) — so a background-pause, return, resume, and a *second* background each pause
  again. Keep both re-arm handlers.
- `pendingDurationRef` is no longer needed by the (now-removed) capture-path POST; the IDB
  draft reads `elapsedSecRef.current` at pause time (`useRecorder` banks time across
  pause/resume in `accumulatedMsRef`, so `elapsedSec` is the running total). It is still
  needed by the **save-in-flight** flush regime (a Done already committed), which keeps
  today's behavior — so keep `pendingDurationRef`, snapshotted at Done.
- Manual-pause-then-hide: `status` is already `paused`; the handler must just ensure the
  IDB draft is persisted (idempotent `put` under the same id) — never `stop()`/POST.
- **Recovery vs. an actively-resuming entry** can't race/duplicate: `PendingSaveRecovery`
  lives in the `(tabs)` **layout** and runs its retry once on mount — a merely *frozen*
  (not killed) page never remounts, so recovery does not re-fire on thaw and the in-memory
  paused session is the sole resume path. A *killed* page reopens fresh with
  `entryIdRef = null` (nothing to resume — banked timer + editor DOM are gone), so recovery
  safely reseals the draft. Even in the pathological overlap, `insertEntry` is
  `ON CONFLICT (id) DO NOTHING`-for-transcript and `store.delete(id)` is idempotent, so id
  X yields exactly one row and a harmless double-delete. No new guard needed.

---

## Contradictions found in the code vs. the design assumptions (flag before building)

1. **"Resume keeps banked timer + transcript" works only for a *frozen* page, not a
   killed one.** The banked timer (`accumulatedMsRef`) and the live transcript (the
   uncontrolled `<textarea>` DOM) live in React refs/DOM, not in persisted state. A full
   page discard loses both. So "record = resume the same entry" (options.md a3) is an
   **in-memory / frozen-page** affordance; a hard-killed page degrades to a *recovered
   sealed* entry via `PendingSaveRecovery`, not a resume. Do not attempt to rehydrate a
   WebRTC session or banked timer from IndexedDB — out of scope.
2. **options.md a2 says background should "offer Resume or Done on return"; the code
   auto-seals.** `PendingSaveRecovery` auto-re-POSTs and seals any IDB draft on next open
   — it never offers a choice. Reconcile: for a *frozen* page the in-memory paused session
   (record → resume) IS the "offer Resume"; for a *killed* page recovery auto-seals
   (transcript safe). We build no new "resume-from-IDB" chooser.
3. **`isCaptureBusy("paused") === true`** (`recorder-state.ts`) keeps the tab-bar guard
   armed during a background-pause, so a user who backgrounds (pause), returns, and wants
   to jump to Library *without* finishing is blocked until they Done/resume. Pre-existing
   behavior; acceptable, but note it in PR2 — do not silently "fix" it.

---

# PR1 — Entry detail page (#39) + post-save redirect

Branch `feat/39-entry-detail`. Design-of-record REQUIRES route-level integration tests
for the new API route.

## Global constraints (PR1)

- Auth copies the house pattern verbatim: `getServerSession()` → 401
  `{ error: "Unauthorized" }`. The new route is gated by `src/proxy.ts` automatically;
  `isPublicPath` needs no change.
- Every view in this repo is a **client component fetching a gated API route** (see
  `EntryList`, `JournalView`, `UnfiledView`). The detail page follows that pattern —
  `EntryDetail` (client) fetches `GET /api/entries/[id]`. This is why the additive GET
  route is load-bearing (not redundant) and keeps auth enforcement in the route, not in a
  server component that would have to re-check `getServerSession` itself.
- Route-level integration tests (house pattern: `src/app/api/entries/[id]/route.test.ts`
  — `vi.mock` auth/db, constructed `Request` + promised `params`) are REQUIRED for the new
  GET. No component tests (no @testing-library in this repo) — keep components thin.
- Suite must stay green (`pnpm test`) after every commit; `pnpm lint && pnpm build` green
  for every app-code task.

### Task 1: `GET /api/entries/[id]` additive route

**Files:**
- Modify: `src/app/api/entries/[id]/route.ts` (add `GET` beside `DELETE`/`PATCH`)
- Test: `src/app/api/entries/[id]/route.test.ts` (extend — add GET coverage)

**Interfaces — Produces:** `GET /api/entries/[id]` →
- 401 `{ error: "Unauthorized" }` unauthed.
- 404 `{ error: "Not found" }` when `getEntry` misses **or** the row is trashed
  (`entry.deletedAt` set) — mirrors PATCH's `!entry || entry.deletedAt` guard, so a
  bookmarked/trashed id doesn't leak.
- 200 `{ entry }` (the `EntryRecord` from `getEntry`) on a live entry.
- 500 `{ error, detail }` on a db throw.

**Behavior:** auth → `getEntry(id)` → 404 on null/trashed → 200 `{ entry }`. No photos in
this payload — the page fetches them via the existing `GET /api/entries/[id]/photos`
(reuse, don't duplicate). `getEntry` already `SELECT`s `deleted_at`, so the trashed check
needs no new query.

**Steps:**
- [ ] Failing GET tests: 401 (getEntry never called); 404 on `getEntry → null`; 404 on a
  trashed row (`deletedAt` set); 200 returns the entry; 500 on a `getEntry` throw. Add
  `getEntry` to the file's existing `@/lib/db` mock if not already there.
- [ ] Implement the GET handler; `pnpm test && pnpm lint && pnpm build` green.
- [ ] Commit: `feat(api): GET /api/entries/[id] — single-entry fetch for the detail page (#39)`

### Task 2: `activeTab` clause for `/entry/[id]`

**Files:**
- Modify: `src/lib/tabs.ts`
- Test: `src/lib/tabs.test.ts` (extend)

**Interfaces — Produces:** no signature change; `activeTab("/entry/<id>")` now returns
`"library"`.

**Behavior:** add one clause to `activeTab`: `if (pathname === "/entry" ||
pathname.startsWith("/entry/")) return "library";` — the detail page lights the Library
tab (the browsing home), per options.md c.

**Steps:**
- [ ] Failing test: `activeTab("/entry/01H…") === "library"`; existing cases still pass.
- [ ] Implement; `pnpm test` green.
- [ ] Commit: `feat(nav): /entry/[id] highlights the Library tab (#39)`

### Task 3: `/entry/[id]` page + `EntryDetail` component (transcript-first)

**Files:**
- Create: `src/app/(tabs)/entry/[id]/page.tsx` (server component, `async params`, thin —
  mirrors `(tabs)/library/[journalId]/page.tsx`), `src/app/EntryDetail.tsx` (client)
- Test: none (thin component + thin page; logic is the already-tested route)

**Behavior:**
- `page.tsx`: `const { id } = await params;` → `<EntryDetail id={id} />`. Route group
  doesn't affect the URL — this serves `/entry/<id>`.
- `EntryDetail` (client): fetch `GET /api/entries/[id]` on mount (loading / not-found /
  error states, same idioms as `JournalView`); on 404 show "No such entry" + a
  `← Library` link. Fetch photos from `GET /api/entries/[id]/photos` after the entry loads.
- **Transcript-first layout** (top → bottom): header (title or formatted `recordedAt`,
  the date, journal chip via `journalLabel`, written date) → **full transcript**
  (`whitespace-pre-wrap`, no clamp — this is the read view) → audio player
  (`preload="metadata"`, the existing `<audio>` + amber partial cue when
  `audioComplete === false`) → photos (full-size, the existing `/api/photo/[id]` proxy
  `<img>` grid) → metadata + actions row.
- **Actions:** reuse what `EntryCard` already has — **Move…** (`PATCH /api/entries/[id]`,
  the same picker + `journals` from `useJournals`) and **Trash** (`DELETE`, with confirm).
  On successful trash, `router.push("/library")` (the entry is gone; don't sit on a
  now-trashed detail page). On move, update local state / stay. Do NOT invent new actions;
  audio playback is inline as above.
- Reuse: pull the shared `formatWhen` / move-picker / trash-confirm out of `EntryCard`
  into a tiny shared spot if it de-dupes cleanly; otherwise copy minimally. Keep it thin.

**Steps:**
- [ ] Build `page.tsx` + `EntryDetail`; wire fetches, transcript-first layout, Move/Trash
  reuse, audio + partial cue, photo grid, loading/404/error states.
- [ ] `pnpm dev` smoke: open an existing entry's `/entry/<id>` (grab an id from Library) —
  transcript reads full, audio plays through `/api/audio/[id]`, photos show, Move + Trash
  work; a trashed/unknown id 404s. `pnpm test && pnpm lint && pnpm build` green.
- [ ] Commit: `feat(entry): /entry/[id] transcript-first detail page (#39)`

### Task 4: whole `EntryCard` taps to detail + collapsed photo thumbnails

**Files:**
- Modify: `src/app/EntryCard.tsx`
- Test: none (component); any pure decision extracted gets a `src/lib` test

**Behavior:**
- Wrap the card's **non-interactive** region (title, date, journal chip, summary, tags,
  transcript preview, photo thumbnails) in a `next/link` `Link` to `/entry/<id>`. The
  **action row** (Move… / Trash buttons, the move `<select>`) and the **select-mode
  checkbox** must NOT navigate — keep them outside the `Link` (or `e.stopPropagation()` /
  `preventDefault` on their handlers). In **select mode** (`JournalView`/`UnfiledView`
  pass a checkbox alongside), card-tap-to-navigate must be **disabled** (tap toggles
  selection instead, or is inert) — thread a `selectable`/`href-disabled` prop, or gate the
  `Link` on a prop the parent sets in select mode.
- Replace the in-card expand-toggle (`EntryTranscript`'s "Show more/less" + lazy
  photo-on-expand) with: a clamped transcript preview (`line-clamp-3`, non-interactive)
  and **photo thumbnails visible on the collapsed card** when `photoCount > 0` — the full
  read + full photos now live on the detail page. Fetch photos on mount only when
  `photoCount > 0`; render up to ~3 small thumbnails via the existing `/api/photo/[id]`
  proxy (CSS-sized — no real thumb variant exists; `#33`'s ~300px thumb is the proper fix,
  out of scope). ⚠️ Flag: this is one photos-fetch per card-with-photos on render — fine at
  ~200 entries/list with rare photos; note the cost and the #33 dependency in a comment.
- Keep `onTrashed`/`onMoved` callbacks and their signatures so `JournalView`/`UnfiledView`/
  `EntryList` need no change beyond (if chosen) passing the select-mode `href-disabled`
  prop.

**Steps:**
- [ ] Refactor `EntryCard`: card-as-Link, action row/checkbox exempt, select-mode gating,
  collapsed thumbnails, drop the expand toggle. Verify all three consumers
  (`EntryList`, `JournalView`, `UnfiledView`) still render + select mode still works.
- [ ] `pnpm dev` smoke: tap a card in Library → lands on `/entry/<id>`; Move…/Trash on the
  card still work without navigating; enter select mode → tapping a card toggles its
  checkbox, doesn't navigate; a card with photos shows thumbnails collapsed.
  `pnpm test && pnpm lint && pnpm build` green.
- [ ] Commit: `feat(library): whole EntryCard taps to /entry/[id] + collapsed photo thumbs (#39)`

### Task 5: post-save redirect (Done → `/entry/[id]`)

**Files:**
- Modify: `src/app/RecorderClient.tsx` (`onStop` success branch), `src/app/EntryDetail.tsx`
  (saved toast + "New recording" action)
- Optional: `src/lib/written-at.ts` or a tiny helper if written-date stickiness needs one

**Behavior:**
- In `onStop`, on the **full-refs 201** success (the existing branch that clears the
  editor/tray and sets `saveState "saved"`) — but **only when there was no audio-upload
  error** (an audio error keeps today's stay-on-Capture error toast) — navigate with
  `useRouter().push(\`/entry/\${id}?saved=1\`)`. On any save **error**, stay on Capture
  (today's behavior — the failure toast + retained transcript stay visible). ⚠️ Navigation
  unmounts `RecorderClient`; the `CaptureGuard` cleanup (`setBusy(false)`) already runs on
  unmount — good.
- `EntryDetail`: when `?saved=1` (read via `useSearchParams`), show a transient "Saved ✓"
  toast (the fixed top-of-viewport idiom) and a **"New recording"** action that links back
  to Capture (`/`). Sticky context: the active journal is DB-backed (`useJournals` reads
  the active-journal lock) so it survives navigation automatically; the **written date** is
  local `RecorderClient` state and would reset — pass it through as
  `/?writtenAt=YYYY-MM-DD` on the "New recording" link and have `RecorderClient` initialize
  `writtenDate` from `useSearchParams` (small, contained). Flag as minor if it balloons.
- ⚠️ **Next 16:** `useRouter`/`useSearchParams` are `next/navigation` client hooks;
  `useSearchParams` needs a Suspense boundary in some setups — check
  `node_modules/next/dist/docs/` (suspense-boundaries / functions) before wiring.

**Steps:**
- [ ] Wire the `onStop` success push (guarded on no-audio-error); add the `?saved=1` toast
  + "New recording" link on `EntryDetail`; thread written-date stickiness.
- [ ] `pnpm dev` real-speech smoke: record → Done → lands on `/entry/<id>` with "Saved ✓";
  "New recording" returns to Capture with the journal (and written date) intact; force a
  save error (offline) → stays on Capture with the error toast.
  `pnpm test && pnpm lint && pnpm build` green.
- [ ] Commit: `feat(save): navigate to /entry/[id] on a successful Done-save (#38/#39)`

**End of PR1 → open PR, branch review, phone smoke (build stamp first).**

---

# PR2 — Continuous capture (#38)

Branch `feat/38-continuous-capture`. Builds on PR1's `onStop` (which now redirects). The
recorder state machine + `primaryAction` are pure/tested — behavior changes go there
test-first.

## Global constraints (PR2)

- No schema change (resolution above). Done stays the only server transcript write.
- Pure predicates get failing unit tests first; component/hook wiring stays thin.
- Suite green after every commit; `pnpm lint && pnpm build` green per app-code task.

### Task 1: split the lifecycle-flush predicate (capture-pause vs. save-flush)

**Files:**
- Modify: `src/lib/lifecycle-flush.ts`
- Test: `src/lib/lifecycle-flush.test.ts` (extend/rewrite)

**Interfaces — Produces:** keep `shouldFlushOnHide(status, saveState)` (still true whenever
a hide needs handling) and add a classifier so the component knows *which* regime:

```ts
export type HideAction = "none" | "pause-persist" | "save-flush";
// capture in flight (connecting|live|paused)      → "pause-persist"  (PR2: IDB only, no POST)
// a Done already committed (saveState finishing|saving, status idle) → "save-flush" (today's keepalive POST)
// otherwise                                         → "none"
export function hideAction(status: RecorderStatus, saveState: SaveState): HideAction;
```

**Behavior:** `pause-persist` takes precedence when capture is in flight (a live session
being backgrounded is a pause, never a Done). `save-flush` is only the post-Done window
(`status` back to `idle`, `saveState` finishing/saving) — its behavior is unchanged from
the current durable-save flush (force teardown + persist + transcript-only keepalive POST).
`shouldFlushOnHide` can be derived as `hideAction(...) !== "none"`.

**Steps:**
- [ ] Failing tests for `hideAction` across the status × saveState matrix (all capture
  statuses → pause-persist; idle+finishing/idle+saving → save-flush; idle+idle/error →
  none; paused+saving edge documented). Keep `shouldFlushOnHide` tests green.
- [ ] Implement; `pnpm test` green.
- [ ] Commit: `feat(recorder): hideAction — classify a hide as pause-persist vs save-flush (#38)`

### Task 2: background = pause + IDB persist (no POST); keep the save-flush path

**Files:**
- Modify: `src/app/RecorderClient.tsx` (the `fire()` handler + the lifecycle effect)

**Behavior (rewrite `fire()` around `hideAction`):**
- `"pause-persist"` (capture in flight): if `status` is `live`/`connecting`, call
  `pause()` (implicit pause — keeps the session resumable in-memory, freezes/banks the
  timer). Then mint/keep `getEntryId()` and `store.put` the resumable IDB draft
  (`buildSaveBody({ id, transcript, durationSeconds: elapsedSecRef.current, journalId,
  writtenAt, audio: null, photos: pendingPhotos-as-refs })`) — **no `fetch`**. Read the
  transcript from the editor *after* `pause()` (pause banks the interim tail into the
  editor via the existing `stop()`-style interim merge? — pause today sets
  `setInterim("")` and holds the pc `FLUSH_MS` for the completed event; ensure the interim
  tail is still delivered on pause the same way Done does via `onSegmentRef` in
  `useRecorder.pause()` — see Task 3 note). `flushFiredRef` guards one action per hide
  episode; the visible/`pageshow` handlers re-arm it (already wired) so a later background
  pauses again.
- `"save-flush"` (post-Done window): **unchanged** — today's `stop()`-was-already-done +
  `forceFlush()` + transcript-only keepalive POST + parallel IDB `put`. `pendingDurationRef`
  still feeds this path's duration.
- `"none"`: no-op.
- Do NOT clear `entryIdRef` on a pause (only a full-refs 201 clears it) — this is what
  makes resume keep the same entry.

**Steps:**
- [ ] Rewrite `fire()` to branch on `hideAction`; capture path pauses + IDB-persists with
  no POST; save path keeps today's keepalive POST. Preserve `flushFiredRef` re-arm.
- [ ] `pnpm dev` smoke (desktop, devtools → emulate "hidden" or switch tabs): start
  recording, background → session goes to `paused` (NOT saved, no entry in Library, no POST
  in the network panel); return → still paused; a Library entry did NOT appear.
  `pnpm test && pnpm lint && pnpm build` green.
- [ ] Commit: `feat(recorder): backgrounding a live session pauses + persists, never Dones (#38)`

### Task 3: resume the same entry; silence does nothing

**Files:**
- Modify: `src/app/useRecorder.ts` (only if the interim-tail-on-pause needs the same merge
  `stop()` got), `src/app/RecorderClient.tsx` (button routing already correct)
- Test: `src/lib/recorder-state.test.ts` (add a documenting assertion), a `src/lib` test if
  a pure decision is extracted

**Behavior:**
- **Resume-same-entry falls out** of Task 2 + existing code: `primaryAction("paused") ===
  "resume"` (already tested), `resume()` reconnects keeping banked timer/log/transcript and
  never touches `entryIdRef`, and `entryIdRef` is minted at background-pause time and kept.
  Add/confirm a `recorder-state.test.ts` assertion that documents "record-while-paused =
  resume" so the intent is pinned.
- **Silence does nothing** (options.md a1): confirm no silence/inactivity timer exists
  (`useRecorder` / `recorder-state`) and add none — the reported "ends on silence" was H1
  (background = implicit Done), fixed in Task 2. Document in a comment; no code.
- **Interim tail on pause:** verify a background-pause doesn't drop the greyed interim tail.
  `stop()` delivers `interimRef.current` via `onSegmentRef` before teardown (Task 7 of #23);
  `pause()` currently just `setInterim("")` and relies on the `FLUSH_MS` completed event. If
  a real-speech smoke shows the tail dropped on a background-pause, mirror `stop()`'s
  interim merge into `pause()` (deliver `interimRef.current` before banking) — TDD any pure
  helper extracted; otherwise a one-line glue change with a comment.
- **H2 (connection-drop while idle/silent) is out of scope** for this PR — note it as a
  known latent gap (a `pc.connectionState` reconnect that reuses the banked timer like
  `resume()`), file-or-defer, do not build.

**Steps:**
- [ ] Add the record-while-paused documenting test; verify no silence timer; smoke the
  interim-tail-on-pause and only touch `pause()` if the tail actually drops.
- [ ] `pnpm dev` real-speech smoke: record a sentence, background (→ paused), return, tap
  the red button (→ resume, same timer continues), speak more, Done → **one** entry with
  both bursts' transcript. `pnpm test && pnpm lint && pnpm build` green.
- [ ] Commit: `feat(recorder): record-while-paused resumes the same entry; silence is a non-event (#38)`

### Task 4: desktop "listening" affordance on the transcript

**Files:**
- Modify: `src/app/TranscriptEditor.tsx` (accept a `listening`/`status` prop),
  `src/app/RecorderClient.tsx` (pass it)
- Test: none if pure styling; a `src/lib` test only if a non-trivial style decision is
  extracted (e.g. a `lampStyle`-like helper)

**Behavior:** state-driven styling ONLY — no structural/logic change (the
`planAppend`/caret logic in `transcript.ts` and the uncontrolled textarea stay untouched).
While `connecting`/`live`: give the textarea a "listening" accent (red left border), style
the interim `<p>` as muted, and show a one-line hint ("you can type corrections; spoken
words append at the end"). While `idle`/`paused`/`error`: plain editable note. Thread a
single prop derived from `status` (e.g. `listening = status === "live" || status ===
"connecting"`).

**Steps:**
- [ ] Add the prop + conditional classes + hint; pass `status` (or a derived boolean) from
  `RecorderClient`.
- [ ] `pnpm dev` smoke (desktop): idle textarea is plain; on record it gains the red
  left-border + hint + muted interim; on pause/idle it reverts.
  `pnpm test && pnpm lint && pnpm build` green.
- [ ] Commit: `feat(capture): state-driven "listening" affordance on the transcript (#38)`

**End of PR2 → open PR, branch review, phone smoke (build stamp first).**

---

## Out of scope for this plan

- **Per-segment audio** — the one place #38 could regress audio (a resumed continuous entry
  keeps only the last burst). Deferred to a **new GitHub issue** (spec below). Keep today's
  last-segment-only audio + the existing amber "audio is partial" cue
  (`EntryCard`/`EntryDetail`).
- **Resume-from-IndexedDB across a hard-killed page** — a killed page can't rehydrate the
  WebRTC session or banked timer; it degrades to a recovered *sealed* entry via
  `PendingSaveRecovery`. No new resume-from-storage flow.
- **H2 connection-drop recovery** (react to `pc.connectionState`, one reconnect reusing the
  banked timer) — noted in PR2 Task 3, not built.
- **H3 explicit `turn_detection`/VAD tuning** — optional knob, not built.
- **Real photo thumbnail variant** (~300px) — that's `#33`; PR1 Task 4 uses CSS-sized
  full-size proxy images as an interim.
- **The `paused`-is-busy tab-guard interaction** (contradiction #3) — left as-is.
- Node 22 / pnpm 10 bump, passkeys, PWA, `page_label` sticky-capture, `#36` search
  increments — their own tracked work.

## Follow-up issue to file (do not build): per-segment audio

**Title:** Per-segment audio for continuous-capture entries.
**Why:** continuous capture (#38) makes multi-burst entries the norm, so "audio covers only
the last segment" goes from a rare edge case to routinely losing most of the audio.
**Shape:** an `entry_audio` child table mirroring `photos` (private blob + gated
`GET /api/audio-segment/[id]`-style proxy, ordered per entry); `useRecorder` accumulates one
blob per connect (start AND resume) instead of discarding on resume; upload N audio blobs
via the existing `#37` client-direct `uploadEntryBlobs` path (same mechanism as N photos);
detail page plays segments in sequence. This is **the one real schema question** deferred
from options.md (d) — additive, single-user, no `user_id`. Retire the amber partial cue once
shipped.

## Phone smoke checklist (self-contained — run at each PR's end)

Always check the header **build timestamp first** — a PR preview looks like a deploy, but
prod only redeploys on merge to main. URL: https://recountly.org (sign in with the owner
account if prompted).

**PR1 (entry detail):**
1. Library → tap any entry card → lands on `/entry/<id>`; transcript reads in full, audio
   plays, photos show, Move…/Trash work. PASS = detail opens and reads correctly.
2. On a card, tap **Move…** or **Trash** directly → the action fires and the card does NOT
   navigate to detail. PASS = action works in place.
3. Record a short entry → tap **Done** → you land on `/entry/<id>` with a "Saved ✓" toast;
   tap **New recording** → back on Capture with the same journal selected. PASS = redirect
   + return both work.
4. Force a save failure (airplane mode, then Done) → you STAY on Capture with the error
   toast and the transcript still in the editor. PASS = no redirect on error.

**PR2 (continuous capture):**
1. Start recording, speak a sentence, then **lock the phone / switch apps** for a few
   seconds → unlock/return. PASS = the session is **paused** (red blinking button, timer
   frozen), NOT saved, and **no new entry** appeared in Library.
2. From that paused state, **tap the red button** → it resumes (timer continues), speak
   more, tap **Done**. PASS = exactly **one** entry with **both** spoken bursts' transcript.
3. Start recording, speak, then **hard-kill the app** (swipe away) mid-recording → reopen
   the app. PASS = `PendingSaveRecovery` shows "Recovered 1 unsaved entry" and the entry
   (transcript) is in Library. (Audio may be partial — expected; the amber cue shows.)
4. Record with the phone sitting idle/silent for ~30–60s between sentences without
   backgrounding. PASS = the session stays live the whole time; silence does nothing.
