# Organization & navigation design (issue #30)

**Status: approved in principle by the owner 2026-07-18** (clickable mockup reviewed —
https://claude.ai/code/artifact/0fa538dd-c244-4eb9-9610-6beb39478785). This doc is the
design of record for issues #27 (trash view), #28 (move entries), #29 (journal browsing),
and the search growth path. Sequencing proposal at the bottom; nothing here is built yet.

Context: the app is close to daily-driver use. The owner's priorities, in their words:
correctness first, and the ability to "clean up my messes" — which is why trash shipped
before this design (PR #26) and why testing strategy is part of this doc, not an afterthought.

## Navigation: three views on a bottom tab bar

Replaces the single scrolling page (the "page-navigation rework" from Next Steps).

- **Capture** — the current recorder screen, still the landing view. It LOSES the entry
  list (browsing moves to Library) so it stays purely the capture tool: record button,
  status, journal lock, written date, page label (new, below), photo tray, transcript.
- **Library** — journals as the organizing spine ("just the folders"): a grid of journal
  cards (cover photo, label, entry count, date range), an **Unfiled** card for entries
  with no journal (the existing 26 spoken entries live there untouched), and **Trash**
  at the bottom — reachable only from Library, one level away from daily use.
  Tapping a journal opens the **journal view**: that journal's entries in reading order
  (written date ascending, then capture order), page labels and photos inline.
- **Search** — its own view; the power tool (growth path below).

Entry actions (Move to journal…, Trash) live in an action row on the expanded entry card,
in whatever view the card appears.

## Reading sessions: UI flow, not schema

Decided with the owner 2026-07-18. **One recording = one entry** — the chunk is whatever
the reader chooses: half a page, one page, three pages. Photos (0..n) attach to that entry,
one per page covered. No session table, no page table.

- **`entries.page_label`** (new, nullable text, free-form): records what the chunk covers —
  `"pp. 14–16"`, `"p. 12a"` (first half of page 12). Nothing enforces a page↔entry mapping,
  so half pages and multi-page spans both just work.
- **Session stickiness in Capture:** after each save, Capture keeps the locked journal and
  written date, and pre-fills the next page label from the last entry (read pp. 12–13 →
  suggests 14–15; always editable, never forced). An evening of reading is
  record → Done → photos → record, with zero re-setup.
- Sentences crossing a page boundary are fine by construction: they're inside one entry
  (record across the page turn) or across two adjacent entries in reading order.
- The journal view stitches it back together: entries ordered by
  `coalesce(written_at, recorded_at)` ascending, then `recorded_at` (capture order),
  photos rendered inline where they were attached.

This is the same shape of decision as "voice over vision": keep the transcript (and now the
page label) on the entry row where FTS already lives. Search needs no change.

## Trash: the only place permanence exists

Soft-delete shipped (PR #26): DELETE marks `deleted_at`; rows + audio/photo blobs are kept;
list/search/enrichment exclude trashed rows. Issue #27 adds the UI:

- Trash view (from Library): trashed entries, newest-trashed first.
- **Restore** — clears `deleted_at`. One tap.
- **Delete forever** (per entry) and **Empty trash** — the ONLY destructive actions in the
  app, each behind its own explicit, loud confirm. Purge = the retained tested hard-delete
  substrate: `deletePhotosByEntry` → `deleteEntry` (photos rows first — no CASCADE), then
  best-effort `deleteBlobPaths` (audio via `audioBlobPath`, photos via `photoBlobPath`).
- Future (owner, parked): snapshot backups discussion. Note: Neon gives point-in-time
  restore on the DB side already; blobs have no safety net — one more reason trash keeps them.

## Move entries between journals (issue #28)

- `PATCH /api/entries/[id]` accepting `{ journalId: string | null }` — validated against
  `journals` exactly like the save route now does (400 Unknown journal). Null = unfile.
- UI: "Move to journal…" in the expanded card's action row → picker listing journals + none.
- Also the cleanup tool for mis-filed test data, alongside trash.

## Search & filter: the power tool — grown over time, NOT launch scope

Owner direction 2026-07-18: search/filter should become a super-powerful tool (journals,
date ranges, other conditions) — explicitly **"over time, not at launch."** So the launch
requirement is the architecture, not the feature list:

- **Filter state is the URL** (query params). Bookmarkable, back-button-correct, and the
  param grammar is shared: a Library journal card is just a canned search underneath
  (one journal, reading order). `parseSearchFilters`/`buildSearchQueryString` already exist —
  they grow, they don't get replaced.
- **UI is composable filter chips:** active filters render as removable pills; "+ add filter"
  lists available conditions. Adding a condition over time = one SQL-builder clause + one
  chip, no redesign.
- **Launch scope:** what exists today (free text, from/to, single journal) presented in the
  new chip UI, plus sort (relevance / newest / oldest / reading order).
- **Growth backlog** (each one small, in rough order of owner value): multiple journals at
  once; written/recorded date-field switch; tag filter (enrichment tags); has photos;
  has audio / audio partial; unfiled only; in-trash; duration range. Free text stays the
  spine — same Postgres FTS engine throughout.

## Data-model additions (all nullable, additive — no existing data touched)

- `entries.page_label text` — reading-session page label.
- `photos.journal_id text REFERENCES journals(id)`, nullable — journal cover photos
  (front/back), mirroring how entry photos work (private blob, gated proxy). A photo row
  belongs to an entry XOR a journal.
- Nothing else. Move/trash-view/journal-views/search-growth are query + UI work only.
  Verified 2026-07-18: `journal_id`, `written_at`, `deleted_at`, the `photos` child table,
  and entry-row FTS all survive the reframe unchanged.

## Testing strategy (owner-agreed 2026-07-18)

1. **Pure-logic TDD in `src/lib`** — unchanged, the existing 242-test layer.
2. **Route-level integration tests — REQUIRED for the organization features.** Route
   handlers are plain functions: call GET/POST/PATCH/DELETE with a constructed `Request`
   and injected fakes (runner, blob fns). Covers auth gating, status codes, orchestration
   order. Data-safety invariants get explicit tests: *trash destroys nothing*;
   *purge only ever targets already-trashed ids*.
3. **Phone smoke checklist** — `docs/smoke-checklist.md` (to be created with the first
   build PR), updated per feature, run after each prod deploy. First line: verify the
   header build timestamp — 2026-07-18's lesson (smoke-tested an undeployed build).
4. Optional later: local Playwright smoke (login → list → search → trash → restore).
   Recording itself stays manual (mic + WebRTC + OpenAI).

## Proposed build order

1. **Trash view** (#27) — small, completes the safety story; unblocks fearless cleanup.
2. **Navigation shell + Library + journal view** (#29) — the reframe's skeleton; includes
   moving the entry list out of Capture; journal covers ride along.
3. **Move entries** (#28) — needs the action row from step 2.
4. **Capture session polish** — `page_label` + sticky suggestion.
5. **Search growth increments** — chip UI first (launch scope), then one condition at a
   time from the backlog, indefinitely.

Passkeys + PWA (Next Steps) remain queued behind this, unless the owner reorders.
