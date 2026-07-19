# Trash View (issue #27) — Implementation Plan

> Executed by fresh implementer + reviewer subagents per task, final branch review at
> the end. Track progress via the `- [ ]` checkboxes.

**Goal:** UI + API for the trash: list trashed entries, restore, and purge (per-entry
"Delete forever" + "Empty trash"). Design of record: `docs/organization-and-navigation.md`.

**Architecture:** same layering as everything else — SQL builders (`entry-sql.ts`) →
injectable-runner db functions (`db.ts`) → thin route handlers → client component.
Purge orchestration lives in a tested `src/lib` module with injectable runner + blob
delete fn; routes stay glue. This PR also introduces the repo's first route-level
integration tests and `docs/smoke-checklist.md` (both required by the design doc).

**Tech stack:** unchanged. Next.js 16 (`await params` in dynamic routes), pnpm 9 /
Node 20, vitest node env.

## Global constraints

- Auth: copy the existing pattern verbatim — `getServerSession()` → 401 `{ error: "Unauthorized" }`.
- Single user; no `user_id` anywhere.
- Suite is currently green (242 tests per CLAUDE.md; run `pnpm test` for the live count) and must stay green; new lib logic is TDD.
- `db/schema.sql` stays idempotent. No schema change is expected in this plan.
- Purge invariant: **purge only ever targets already-trashed rows**; photo rows are
  deleted before the entry row (no CASCADE); blob deletes are best-effort and happen
  after row deletes, with paths derived before the rows disappear.
- Error shape: `Response.json({ error, detail? }, { status })`.

---

### Task 1: Trash SQL + db functions + purge orchestration

**Files:**
- Modify: `src/lib/entry-sql.ts`, `src/lib/db.ts`
- Create: `src/lib/purge.ts`
- Test: `src/lib/entry-sql.test.ts`, `src/lib/db.test.ts`, `src/lib/purge.test.ts`

**Interfaces — Produces:**
- `listTrashedSql(limit)` — same column list as `listEntriesSql` plus `deleted_at`
  and the `photo_count` subquery; `WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC LIMIT $1`.
- `restoreEntrySql(id)` — `UPDATE entries SET deleted_at = NULL, updated_at = now()
  WHERE id = $1 AND deleted_at IS NOT NULL RETURNING id`.
- `listTrashedEntries(limit?, runner?)`, `restoreEntry(id, runner?) → Promise<boolean>` in `db.ts`,
  mirroring `softDeleteEntry`.
- `purgeTrashedEntry(id, { runner?, delFn? }) → Promise<"purged" | "not_found" | "not_trashed">`
  in `purge.ts`: fetch entry (`getEntrySql`) → not_found / not_trashed guards → collect
  blob paths (`audioBlobPath` if audio present; `photoBlobPath` for each photo row —
  reuse the existing photos-by-entry query) → `deletePhotosByEntry` → `deleteEntry` →
  best-effort `deleteBlobPaths` (a blob failure still returns "purged").
- `emptyTrash({ runner?, delFn? }) → Promise<number>` — purge every trashed id, return count.

**Steps:**
- [x] Write failing tests: SQL text/params for both builders; db fns via the existing
  `fakeRunner`; purge order + guards + best-effort blob behavior via fake runner/delFn
  (assert photo-delete runs before entry-delete, and that a non-trashed id performs no
  deletes).
- [x] Implement; `pnpm test` green.
- [x] Commit: `feat: trash list/restore SQL + purge orchestration (#27)`

---

### Task 2: Routes + first route-level integration tests

**Files:**
- Create: `src/app/api/entries/trash/route.ts` (GET list, DELETE empty),
  `src/app/api/entries/[id]/restore/route.ts` (POST),
  `src/app/api/entries/[id]/purge/route.ts` (DELETE)
- Test: colocated `route.test.ts` files (vitest glob `src/**/*.test.ts` already matches)

**Interfaces — Produces:**
- `GET /api/entries/trash` → `{ entries: [...] }` newest-trashed first (payload shape
  parity with `GET /api/entries` + `deleted_at`).
- `DELETE /api/entries/trash` → `{ purged: n }`.
- `POST /api/entries/[id]/restore` → `{ restored: id }` | 404.
- `DELETE /api/entries/[id]/purge` → `{ purged: id }` | 404 (unknown) | 409 (not trashed).

Static segment `trash` wins over the existing `[id]` dynamic route — verify with a
quick `pnpm dev` request, note it in the route comment only if non-obvious.

**Route tests** (first in the repo — keep the pattern small and copyable): mock
`@/lib/auth-server`, `@/lib/db`, `@/lib/purge` with `vi.mock`, call the handlers with
constructed `Request`s. Cover: 401 when no session (every handler); status codes
above; and the invariant that the purge route never reaches delete logic for a
non-trashed id.

**Steps:**
- [x] Failing route tests → implement handlers (thin: auth, `await params`, call lib,
  map result to status) → `pnpm test && pnpm lint && pnpm build` green.
- [x] Commit: `feat: trash/restore/purge routes + route-level tests (#27)`

---

### Task 3: Trash view UI

**Files:**
- Create: `src/app/TrashView.tsx`
- Modify: `src/app/RecorderClient.tsx`, `src/app/EntryList.tsx`

**Behavior:**
- A "Trash" toggle near the entry-list heading in `RecorderClient` swaps `EntryList`
  for `TrashView` (local state; the #29 tab bar replaces this later).
- `TrashView` fetches `GET /api/entries/trash`, renders cards reusing the EntryList
  card look (title/summary/date + trashed date; no need for photos/audio expansion in v1
  of this view).
- Per card: **Restore** (one tap, optimistic remove, bump the entry-list reload key so
  the entry reappears) and **Delete forever** (confirm dialog naming the entry, then
  `DELETE .../purge`).
- Header: **Empty trash** (confirm stating the count and that it can't be undone) →
  `DELETE /api/entries/trash`.
- `EntryList`: rename the "Delete"/"Deleting…" button label to "Trash"/"Trashing…" to
  match the model (`handleDelete` already says "Move this entry to trash?").
- No component tests (house style); any new pure logic goes to `src/lib` + tests.

**Steps:**
- [ ] Implement; `pnpm test && pnpm lint && pnpm build` green; check the view renders
  in `pnpm dev`.
- [ ] Commit: `feat: trash view — list, restore, delete forever, empty trash (#27)`

---

### Task 4: Smoke checklist

**Files:**
- Create: `docs/smoke-checklist.md`

Per-feature phone checklist, run after each prod deploy. Step 1: verify the header
build timestamp matches the deploy. Add the trash flow: record+save a throwaway →
trash it → confirm gone from list/search → open Trash → restore → confirm back →
trash again → delete forever → confirm gone from Trash → empty trash on a second
throwaway.

**Steps:**
- [ ] Write it; commit: `docs: smoke checklist (first: build timestamp) (#27)`

---

## Out of scope for this plan

- Nav shell / Library / journal view (#29); move entries (#28); `page_label`; search
  chips; `photos.journal_id` cover photos.
- Any schema change.
- Playwright.
