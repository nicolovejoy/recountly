# Durable Save Rearchitecture (issue #23) — Implementation Plan

> Executed by fresh implementer + reviewer subagents per task, final branch review at
> the end of each phase. Track progress via the `- [ ]` checkboxes.

**Goal:** Make Done → Saved survive a backgrounded iOS tab and a discarded page, and
stop losing the greyed interim tail. Replace the single multipart `POST /api/entries`
(audio + photos + text through one ~4.5 MB function body) with **client-direct blob
uploads + a small JSON save** that fits `fetch(..., { keepalive: true })`, move enrichment
off the request path with `after()`, and add a durability layer (interim merge, lifecycle
flush, IndexedDB pending-save retry). The 4.5 MB body cap disappears as a side effect.

**Architecture:** Same layering as everything else — pure tested logic in `src/lib/`
(JSON contract builder/validator, client-upload orchestration, pending-save queue) →
thin route handlers → thin hooks/components. New save flow:

1. Client mints the entry id (`ulid()` — already isomorphic/browser-safe, no node deps),
   uploads audio (best-effort) and photos (NOT best-effort) **straight to Vercel Blob**
   via `upload()` from `@vercel/blob/client`, which fetches a per-upload token from a new
   auth-gated `POST /api/blob/upload` (`handleUpload`).
2. Client POSTs a small JSON body (ids + pathnames + text, no binaries) to
   `POST /api/entries` with `keepalive: true`. The route inserts the entry + photo rows
   (idempotent), returns 201, and runs enrichment in `after()`.
3. Durability: interim text merges into the transcript on Done; `pagehide`/
   `visibilitychange` flush the pending save immediately; a Done-time IndexedDB record
   (JSON + Blobs) is retried on next app open and deleted on a confirmed 201.

**Tech stack:** unchanged. Next.js 16.2.7 (`after` is a **stable** export of `next/server`
— `node_modules/next/server.d.ts:21`, not `unstable_after`), `@vercel/blob` 2.4.0
(`upload`/`handleUpload` exported from `@vercel/blob/client`), pnpm 9 / Node 20, vitest
node env.

## Global constraints

- Auth: routes copy the existing pattern verbatim — `getServerSession()` → 401
  `{ error: "Unauthorized" }`. The token route checks auth **before** calling
  `handleUpload`. New routes are gated by `src/proxy.ts` automatically; `isPublicPath`
  needs no change (`/api/blob/*` is NOT public).
- Single user; no `user_id` anywhere.
- Suite is currently green (338 tests; run `pnpm test` for the live count) and the test
  suite must stay green after **every commit**; new lib logic is TDD (failing test first).
  `pnpm lint && pnpm build` green for every app-code task. Note: full *runtime* coherence
  (client + route both on the JSON contract) lands at the end of each phase's dev-smoke
  step, not necessarily at every intermediate commit — the route rewrite and the client
  rewrite are separate commits on a feature branch.
- Route-level integration tests (house pattern: `src/app/api/entries/route.test.ts` —
  `vi.mock` auth/db, constructed `Request`s) are REQUIRED for any new/changed API route.
  For the token route, mocking `@vercel/blob/client` is fine (exercise auth + that
  `handleUpload` is invoked with the constrained options). NO component tests (no
  @testing-library in this repo) — keep hooks/components thin, put logic in pure `src/lib`.
- The client `upload()` and the route `handleUpload()` must be **injectable** in whatever
  lib wraps them so tests never hit the network.
- Error shape: `Response.json({ error, detail? }, { status })`.
- Photos are NOT best-effort (issue #10 is why): any photo upload failure fails the whole
  save — the client must surface it and keep the tray. Audio is best-effort — a failed
  audio upload still saves the transcript.
- Idempotency invariant: entry and photo inserts are keyed on client-minted ids and use
  `ON CONFLICT (id) DO NOTHING`, so a retry after a landed-but-unacked save can never
  duplicate a row.
- Two PRs: **Phase A** (Tasks 1–6) = token route + client-direct uploads + JSON save +
  keepalive + `after()` enrichment (behavior parity, body cap gone). **Phase B** (Tasks
  7–9) = interim merge + lifecycle flush + IndexedDB pending-save retry.

---

## Phase A — client-direct uploads + JSON save

### Task 1: Idempotent inserts

**Files:**
- Modify: `src/lib/entry-sql.ts`, `src/lib/photo.ts`
- Test: `src/lib/entry-sql.test.ts`, `src/lib/photo.test.ts` (extend)

**Interfaces — Produces:** no new signatures; SQL text changes only.
- `insertEntrySql`: append `ON CONFLICT (id) DO UPDATE SET audio_url =
  COALESCE(entries.audio_url, EXCLUDED.audio_url), audio_mime = COALESCE(entries.audio_mime,
  EXCLUDED.audio_mime), audio_bytes = COALESCE(entries.audio_bytes, EXCLUDED.audio_bytes),
  audio_complete = COALESCE(entries.audio_complete, EXCLUDED.audio_complete)`. Params
  unchanged. All other columns keep first-write-wins (untouched by the upsert).
- `insertPhotoSql`: append `ON CONFLICT (id) DO NOTHING`. Params unchanged.

**Behavior:** a re-inserted entry row (same client-minted id) is a no-op for every column
EXCEPT the audio ref, which attaches iff the existing row has none — the safety net for
pending-save retry (Task 9) and for a keepalive POST that landed but whose ack never
reached the client. The audio-attach upsert exists because the Task 8 lifecycle flush
POSTs a transcript-only body (`audio: null` — a blob upload can't survive a backgrounded
tab); Task 9's recovery then re-uploads the audio from IndexedDB and re-POSTs with the
audio ref, which must be able to land on the already-inserted row. Existing audio is
never overwritten (COALESCE prefers the stored value). Photo rows stay plain
`DO NOTHING` — a recovery re-POST inserts the photo rows fresh alongside the existing
entry row.

**Steps:**
- [x] Update the two SQL-text assertions in the existing tests to expect the
  `ON CONFLICT (id) DO NOTHING` suffix (write the change as a failing expectation first).
- [x] Implement; `pnpm test` green.
- [x] Commit: `feat(db): idempotent entry + photo inserts (ON CONFLICT DO NOTHING) (#23)`

---

### Task 2: JSON save contract + planSave rework

**Files:**
- Create: `src/lib/save-payload.ts`
- Modify: `src/lib/save-plan.ts`, `src/app/RecorderClient.tsx` (planSave call site only)
- Delete: `src/lib/payload-size.ts` + `src/lib/payload-size.test.ts` (the 4 MB budget is
  obsolete — uploads go direct, capped by the token route, not the POST body)
- Test: `src/lib/save-payload.test.ts` (create), `src/lib/save-plan.test.ts` (rewrite)

**Interfaces — Produces:**

`src/lib/save-payload.ts` (pure, TDD) — the client↔route JSON contract, replacing the
multipart `entry-form.ts` FormData (which Task 6 removes from the save path):

```ts
export interface SaveAudioRef { pathname: string; mime: string; bytes: number; complete: boolean }
export interface SavePhotoRef { id: string; pathname: string; mime: string; bytes: number }

export interface SaveRequestBody {
  id: string;               // client-minted ulid — entry primary key
  transcript: string;
  durationSeconds: number;
  recordedAt?: string;      // ISO; omitted → server stamps now
  journalId?: string;
  writtenAt?: string;       // ISO
  audio?: SaveAudioRef | null;
  photos: SavePhotoRef[];   // [] when none
}

// Client side: assemble the body from the entry id + uploaded-blob descriptors.
export function buildSaveBody(input: {
  id: string;
  transcript: string;
  durationSeconds: number;
  recordedAt?: string;
  journalId?: string;
  writtenAt?: string;
  audio: SaveAudioRef | null;
  photos: SavePhotoRef[];
}): SaveRequestBody;

// Route side: validate an untrusted JSON body into an EntryInput + refs, house style
// (a problems[] list, not throw-on-first — mirrors validateEntryInput).
export function parseSaveBody(raw: unknown):
  | { ok: true; input: EntryInput; audio: SaveAudioRef | null; photos: SavePhotoRef[] }
  | { ok: false; problems: string[] };
```

`parseSaveBody` reuses `validateEntryInput` for transcript/duration/journalId/writtenAt,
and additionally requires: a non-empty string `id`; each photo carries `id` + `pathname`
+ positive `bytes` + `image/*` mime; audio (when present) has `pathname` + positive
`bytes` + `audio/*` mime.

`src/lib/save-plan.ts` — collapse to the empty check only (the too-large branch is gone):

```ts
export type SavePlan = { kind: "empty" } | { kind: "save" };
export function planSave(transcript: string): SavePlan;   // empty when trimmed length 0
```

**Behavior:** the pathname contract stays deterministic — audio at
`audioBlobPath(entryId, mime)`, photos at `photoBlobPath(photoId, mime)` (existing
`src/lib/blob.ts` / `src/lib/photo.ts` helpers) — so the gated proxies
(`GET /api/audio/[id]`, `GET /api/photo/[id]`) resolve unchanged and `audio_url` still
stores `audioProxyPath(entryId)`.

**Steps:**
- [x] Failing tests: `buildSaveBody`/`parseSaveBody` round-trip; parse rejects (bad id,
  photo missing id, non-image photo mime, non-audio audio mime, negative bytes) with a
  problems list; `planSave` empty vs save.
- [x] Implement; update the RecorderClient `planSave` call site to the 1-arg form (it
  still branches to the empty-transcript error toast); delete `payload-size.ts` + test.
  `pnpm test && pnpm lint && pnpm build` green.
- [x] Commit: `feat(save): JSON save contract (save-payload) + planSave empty-only (#23)`

---

### Task 3: Blob token route `POST /api/blob/upload`

**Files:**
- Create: `src/app/api/blob/upload/route.ts`
- Test: `src/app/api/blob/upload/route.test.ts` (create)

**Interfaces — Produces:**
- `POST /api/blob/upload` → 200 (the `handleUpload` client-token JSON) | 401
  `{ error: "Unauthorized" }` | 400 `{ error, detail }` on a malformed body /
  `handleUpload` throw.

**Behavior:**
- Auth first: `getServerSession()` → 401 **before** calling `handleUpload` (an unauthed
  caller must never mint an upload token).
- `body = await request.json()`; call `handleUpload({ request, body, onBeforeGenerateToken })`
  from `@vercel/blob/client`; return `Response.json(result)`.
- `onBeforeGenerateToken(pathname)` returns:
  - `allowedContentTypes: ["audio/*", "image/*"]`
  - `maximumSizeInBytes`: 100 MB when `pathname` starts with `audio/`, else 10 MB
    (photos are downscaled client-side; audio can be long)
  - `addRandomSuffix: false` (the proxy routes depend on the exact id-derived pathname)
  - no `tokenPayload` needed
- **No `onUploadCompleted`**: it never fires on localhost (`handleUpload` only sets a
  callback URL when `process.env.VERCEL === "1"`), and the DB write is the JSON POST in
  Task 5 — not a blob webhook. Document this in a route comment.

**Route tests** (mock `@/lib/auth-server`; `vi.mock("@vercel/blob/client")` so `handleUpload`
is a spy): 401 without a session (handleUpload never called); 200 passes a
generate-client-token body through and returns handleUpload's result; the
`onBeforeGenerateToken` passed to handleUpload returns the audio cap for an `audio/…`
pathname and the photo cap for a `photos/…` pathname (call it directly in the test);
400 + detail when handleUpload throws.

**Steps:**
- [x] Failing route tests → implement the handler → `pnpm test && pnpm lint && pnpm build`
  green.
- [x] Commit: `feat(api): POST /api/blob/upload — auth-gated client-upload token route (#23)`

---

### Task 4: Client upload orchestration `blob-upload.ts`

**Files:**
- Create: `src/lib/blob-upload.ts`
- Test: `src/lib/blob-upload.test.ts` (create)

**Interfaces — Produces:**

```ts
// The slice of @vercel/blob/client's upload() we depend on — injectable for tests.
export type ClientUploadFn = (
  pathname: string,
  body: Blob,
  opts: { access: "private"; handleUploadUrl: string; contentType: string; multipart?: boolean },
) => Promise<{ url: string }>;

export interface EntryUploadInput {
  entryId: string;
  audio: { blob: Blob; mime: string; complete: boolean } | null;
  photos: { id: string; blob: Blob; mime: string }[];
}

export interface EntryUploadResult {
  audio: SaveAudioRef | null;   // null when no audio OR the best-effort upload failed
  photos: SavePhotoRef[];       // fully populated; the fn throws before returning if any photo fails
}

export async function uploadEntryBlobs(
  input: EntryUploadInput,
  upload: ClientUploadFn,
): Promise<EntryUploadResult>;
```

**Behavior:**
- Audio → `upload(audioBlobPath(entryId, mime), blob, { access: "private", handleUploadUrl:
  "/api/blob/upload", contentType: mime, multipart: true })`. On throw: swallow, return
  `audio: null` (best-effort, current semantics). On success: `{ pathname, mime,
  bytes: blob.size, complete }`.
- Each photo → `upload(photoBlobPath(id, mime), blob, { access: "private", handleUploadUrl:
  "/api/blob/upload", contentType: mime })` (no multipart — photos are ≤ ~10 MB). On throw:
  **rethrow** (NOT best-effort) so the caller aborts the save and keeps the tray. Photo
  ids are minted by the caller (client-side `ulid()`), so a retry re-uploads to the same
  pathname.

**Steps:**
- [x] Failing tests (fake `ClientUploadFn`): audio+photos happy path returns the right
  refs and calls upload with `access:"private"` + the handleUploadUrl + `multipart:true`
  only for audio; audio-upload throw → `audio:null` and photos still uploaded; a
  photo-upload throw rejects the whole call (and doesn't swallow).
- [x] Implement; `pnpm test` green.
- [x] Commit: `feat(save): client-direct blob upload orchestration (blob-upload) (#23)`

---

### Task 5: Rewrite `POST /api/entries` to JSON + `after()` enrichment

**Files:**
- Modify: `src/app/api/entries/route.ts`
- Test: `src/app/api/entries/route.test.ts` (extend — add POST coverage alongside the
  existing GET tests)

**Interfaces — Produces:** `POST /api/entries` now consumes `SaveRequestBody` JSON:
- 401 unauthed.
- 400 `{ error: "Invalid entry", problems }` when `parseSaveBody` fails, or `{ error:
  "Expected application/json" }` when `request.json()` throws.
- 400 `{ error: "Unknown journal" }` when `input.journalId` is set and `getJournal` misses.
- 201 `{ entry, photos: [{ id, url }] }` on success.
- 500 `{ error: "Failed to save entry", detail }` on insert failure.

**Behavior (new POST sequence):**
- auth → `parseSaveBody(await request.json())` → journal FK check (kept: a client
  desync could still send a stale journalId; it also documents the constraint) → build
  the entry record with the client-minted `id`, `audioUrl = audio ? audioProxyPath(id) :
  null`, `audioMime/audioBytes/audioComplete` from the audio ref, and **`enrichment:
  null`** (enrichment now runs after the response) → `insertEntry` (idempotent) →
  `insertPhoto` per photo ref (`{ id, entryId: id, mime, bytes, createdAt: now }`,
  idempotent) → **201**.
- After building the 201 response, schedule enrichment with `after()` from `next/server`:
  `after(async () => { const e = await enrichTranscript(transcript, getAnthropic()); if
  (e) await updateEntryEnrichment(id, e, new Date().toISOString()); })`. Wrap in
  try/catch → best-effort (a failed enrichment must not surface; the `/api/entries/enrich`
  backfill remains the safety net). No audio/photo *uploads* happen in the route anymore
  — the blobs are already in the store.
- ⚠️ Because uploads now precede the JSON POST, the journal FK 400 no longer prevents
  orphan blobs (the blobs are already uploaded). Orphans from a rejected/failed save are
  acceptable (id-keyed, future purge sweep) — see Out of scope. In practice `journalId`
  always comes from the client's own `useJournals` active journal, so a 400 here is
  near-impossible from the real UI.

**Route tests** (extend the existing file; `@/lib/db` + `@/lib/auth-server` already
mocked — add `updateEntryEnrichment` to the db mock; mock `@/lib/enrich` +
`@/lib/anthropic`): 401; 400 on non-JSON body; 400 problems on a bad body (missing id /
bad photo); 400 unknown journal (getJournal → null, insert never called); 201 happy path
calls `insertEntry` with the client id + `audioUrl = /api/audio/<id>` and `insertPhoto`
once per photo, returns the photos proxy paths; 500 + detail when `insertEntry` throws.
(Testing `after()` scheduling itself is out of scope — assert the synchronous 201 path;
enrichment is covered by `enrich.test.ts`.)

**Steps:**
- [x] Failing POST route tests → rewrite the handler (drop `request.formData()`,
  `uploadAudio`, `uploadPhoto`, and the in-request `enrichTranscript` call from the
  request path) → `pnpm test && pnpm lint && pnpm build` green.
- [x] Commit: `feat(api): POST /api/entries takes JSON + enrichment via after() (#23)`

---

### Task 6: Wire the client to the new flow

**Files:**
- Modify: `src/app/RecorderClient.tsx`
- Delete: `src/lib/entry-form.ts` + `src/lib/entry-form.test.ts` (multipart body no longer
  built anywhere)

**Behavior (RecorderClient.onStop rewrite — glue only, logic already in libs):**
- On Done, `planSave(transcript)` → empty → the existing empty toast; else:
  - mint `const id = ulid()`; mint a `ulid()` per pending photo.
  - `setSaveState("saving")`, then
    `uploadEntryBlobs({ entryId: id, audio, photos }, upload)` (real `upload` from
    `@vercel/blob/client`; audio from `RecordingResult`, photos from `pendingPhotos`).
    A photo-upload throw → error toast "Photo upload failed — …", keep the tray, bail.
  - `buildSaveBody({ id, transcript, durationSeconds, journalId: active?.id, writtenAt:
    writtenAtIso(writtenDate), audio: result.audio, photos: result.photos })`.
  - `fetch("/api/entries", { method: "POST", headers: { "content-type":
    "application/json" }, body: JSON.stringify(body), keepalive: bodyBytes < 60_000 })` —
    normally well under the 64 KB keepalive cap, but a marathon transcript can exceed it
    and some browsers reject an over-cap keepalive fetch outright; guard by byte length
    (plain fetch beats a thrown one). `res.ok` → clear editor/tray/writtenDate,
    `setSaveState("saved")`; else error toast.
- The Task 9 IndexedDB persist wraps this (persist before uploads, delete on 201); this
  task keeps the current in-memory flow so Phase A ships independently.

**Steps:**
- [x] Implement the onStop rewrite; delete `entry-form.ts` + test. `pnpm test && pnpm lint
  && pnpm build` green.
- [ ] `pnpm dev` real-speech smoke: record → Done → Saved ✓; entry appears in Library
  reading order + Search; audio plays through `/api/audio/[id]`; a photo entry saves and
  the photo shows on expand. Verify a payload that previously tripped the 4 MB cap
  (long audio + several photos) now saves. Update `docs/smoke-checklist.md` with the
  client-direct-upload note.
- [ ] Commit: `feat(save): client-direct uploads + keepalive JSON save on Done (#23)`

**End of Phase A → open PR, branch review, phone smoke (check the header build stamp
first — prod only redeploys on merge to main).**

---

## Phase B — durability

### Task 7: Merge interim text on Done

**Files:**
- Modify: `src/app/useRecorder.ts` (`stop()`)
- Optional pure helper + test if any non-trivial decision emerges; otherwise glue.

**Behavior:** in `stop()`, before teardown, if `interim` is non-empty, deliver it via
`onSegmentRef.current(interim)` so the greyed, not-yet-finalized tail lands in the editor
(and therefore in the saved transcript) instead of vanishing when teardown beats the
`completed` event. Clear interim after. ⚠️ Known tradeoff: if the real `completed` event
*does* still arrive during the FLUSH_MS window, the tail can double-append; losing speech
is worse than a duplicated tail, so this is acceptable for v1 — note it in a code comment
and defer dedup (a candidate: reconcile against the last appended segment) to a follow-up.

**Steps:**
- [ ] Implement; if a pure decision helper is extracted, TDD it. Real-speech smoke:
  speak, tap Done fast (before the last segment finalizes), confirm the tail is present in
  the saved entry. `pnpm test && pnpm lint && pnpm build` green.
- [ ] Commit: `fix(recorder): merge interim tail into transcript on Done (#23)`

---

### Task 8: Lifecycle flush

**Files:**
- Modify: `src/app/RecorderClient.tsx`, `src/app/useRecorder.ts`
- Create: `src/lib/lifecycle-flush.ts` (pure decision) + test

**Interfaces — Produces:**

```ts
// Whether a page-hide / visibility-hidden event should force the pending save
// out NOW instead of waiting on the FLUSH_MS timer or a still-open POST.
export function shouldFlushOnHide(status: RecorderStatus, saveState: SaveState): boolean;
// true while status is capture-busy OR saveState is finishing/saving.
```

**Behavior:** register `pagehide` and `visibilitychange` (→ `document.visibilityState ===
"hidden"`) listeners while `shouldFlushOnHide` is true. On fire: skip the remaining
FLUSH_MS tail wait — `commitBuffer()` + close, finalize audio immediately — and fire a
**transcript-only** JSON save with `keepalive: true`: `audio: null`, `photos: []`. Blob
uploads cannot be trusted to complete in a backgrounded tab, and POSTing refs to blobs
that never uploaded would create rows pointing at nothing; the keepalive JSON is the only
request guaranteed to survive. The audio + photos still land later via Task 9: the
pending IndexedDB record keeps the Blobs, recovery re-uploads them and re-POSTs with
refs, and the Task 1 audio-attach upsert + fresh photo-row inserts complete the entry.
A flush-path 201 therefore must NOT delete the pending record (only a full-refs 201
does — Task 9). Idempotent with the normal timer path (whichever runs first; guard with
an "already fired" ref). Reuse `guardBusy`-style classification; keep the listener wiring
in the component/hook and the predicate in the tested lib.

**Steps:**
- [ ] Failing tests for `shouldFlushOnHide` (all status × saveState combinations that
  matter) → implement → wire listeners. `pnpm test && pnpm lint && pnpm build` green.
- [ ] Manual: Done, immediately background the tab (desktop: switch tab; note phone verify
  happens at PR smoke) → the entry still lands.
- [ ] Commit: `feat(save): pagehide/visibilitychange flush with keepalive (#23)`

---

### Task 9: IndexedDB pending-save queue + retry-on-open

**Files:**
- Create: `src/lib/pending-save.ts` (pure, TDD), `src/app/idb-pending.ts` (thin IDB glue,
  untested), `src/app/PendingSaveRecovery.tsx` (client, mount effect + toast)
- Modify: `src/app/RecorderClient.tsx` (persist before uploads, delete on 201),
  `src/app/(tabs)/layout.tsx` (mount `<PendingSaveRecovery />`)
- Test: `src/lib/pending-save.test.ts` (create)

**Interfaces — Produces:**

```ts
export interface PendingSave {
  id: string;                 // entry id — the dedupe key
  body: SaveRequestBody;      // the JSON to (re-)POST
  audio: { blob: Blob; mime: string; complete: boolean } | null;
  photos: { id: string; blob: Blob; mime: string }[];
  createdAt: number;
}

// IndexedDB stores Blobs natively, so the whole record round-trips.
export interface PendingStore {
  put(rec: PendingSave): Promise<void>;
  getAll(): Promise<PendingSave[]>;
  delete(id: string): Promise<void>;
}

export interface RetryDeps {
  uploadBlobs: (input: EntryUploadInput, upload: ClientUploadFn) => Promise<EntryUploadResult>;
  upload: ClientUploadFn;
  postSave: (body: SaveRequestBody) => Promise<{ ok: boolean; status: number }>;
}

// Re-upload blobs then re-POST each pending record; delete on a 201 (or any
// response proving the row exists — the insert is ON CONFLICT DO NOTHING, so a
// landed-but-unacked save re-POSTs to a 201 with no duplicate). Returns how many
// were recovered. Pure over injectable store + deps.
export async function retryPending(store: PendingStore, deps: RetryDeps): Promise<{ recovered: number }>;
```

**Behavior:**
- On Done (Task 6 path): build the `PendingSave` and `store.put(...)` **before** starting
  uploads; on a confirmed **full-refs** 201 (the Task 6 path, audio/photo refs included),
  `store.delete(id)`. A transcript-only flush 201 (Task 8) does NOT delete — the record
  stays so recovery can attach the blobs (Task 1 upsert). A crash/discard between persist
  and 201 leaves the record for recovery.
- `PendingSaveRecovery` mounts in the tabs layout, calls `retryPending` once on mount,
  and shows a minimal toast "Recovered N unsaved entr(y/ies)" when `recovered > 0`.
- Idempotency: re-upload targets the same id-derived pathnames; re-POST hits the
  `ON CONFLICT DO NOTHING` insert — no duplicate rows or blobs.
- `idb-pending.ts` implements `PendingStore` over a single object store keyed by `id`
  (untested browser glue — the logic under test is `pending-save.ts` + the orchestration).

**Steps:**
- [ ] Failing tests (in-memory fake `PendingStore` + fake deps): `retryPending` re-posts
  and deletes on 201; keeps the record on a network/5xx failure; a record that already
  landed (postSave → 201) is deleted without duplication; returns the correct recovered
  count.
- [ ] Implement `pending-save.ts` + `idb-pending.ts` + recovery component; wire the
  persist/delete into onStop and mount the recovery component. `pnpm test && pnpm lint &&
  pnpm build` green.
- [ ] Manual: force a save failure (offline), confirm the record persists; reload online,
  confirm the recovery toast and the entry landing exactly once. Update
  `docs/smoke-checklist.md`.
- [ ] Commit: `feat(save): IndexedDB pending-save queue + retry on next open (#23)`

**End of Phase B → open PR, branch review, phone smoke (build stamp first).**

---

## Out of scope for this plan

- Orphan-blob purge: a blob uploaded client-side whose JSON save then permanently fails
  (or a save rejected on the journal FK check) leaves an id-keyed orphan in the store.
  Acceptable for now — a future purge sweep (there are already hard-delete blob helpers in
  `src/lib/blob.ts`) reclaims them. No reference-counting this pass.
- Interim-tail dedup: Task 7 accepts a possible duplicated tail (losing speech is worse).
- Upload progress UI (`onUploadProgress`), resumable/multipart *photo* uploads, and
  `handleUploadPresigned` — not needed at these sizes.
- `onUploadCompleted` DB writes — deliberately unused (never fires on localhost; the JSON
  POST is the write path).
- Node 22 / pnpm 10 bump, passkeys, PWA, move-entry (#28), search increments (#36) — their
  own tracked work.

## Smoke notes (both phases)

- **Localhost caveat:** client-direct `upload()` works locally against the real Blob store
  via the token route; `onUploadCompleted` would NOT fire locally (`handleUpload` only
  sets a callback URL on Vercel) — we don't use it, so nothing to verify there.
- **Phone smoke:** always check the header build timestamp FIRST — a PR preview looks like
  a deploy, but prod only redeploys on merge to main. Then: record on the phone → Done →
  Saved ✓; lock the phone / app-switch immediately after Done and confirm the entry still
  lands (Phase B); kill the app mid-save (airplane mode) and confirm recovery on next open
  (Phase B, Task 9).
