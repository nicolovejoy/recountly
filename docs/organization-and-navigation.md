# Organization & navigation design (issue #30)

Approved by the owner 2026-07-18 (clickable mockup:
https://claude.ai/code/artifact/0fa538dd-c244-4eb9-9610-6beb39478785). Covers issues
#27 (trash view), #28 (move entries), #29 (journal browsing), and the search growth
path. Nothing here is built yet.

## Navigation

Bottom tab bar, three views (replaces the single scrolling page):

- **Capture** — the recorder screen, still the landing view. The entry list moves out;
  what stays: record button, status, journal lock, written date, page label (new,
  below), photo tray, transcript.
- **Library** — journal cards (cover photo, label, entry count, date range), an
  Unfiled card for entries with no journal (the existing spoken entries land there
  untouched), Trash at the bottom. Tapping a journal shows its entries in reading
  order — `coalesce(written_at, recorded_at)` ascending, then `recorded_at` — with
  page labels and photos inline.
- **Search** — its own view; grows over time (below).

Entry actions (Move to journal…, Trash) sit in an action row on the expanded entry
card, in whatever view the card appears.

## Reading sessions

One recording = one entry; the chunk is whatever the reader chooses (half a page,
three pages). Photos attach 0..n per entry. No session or page tables.

- `entries.page_label` (nullable text, free-form): `"pp. 14–16"`, `"p. 12a"`.
- After each save, Capture keeps the locked journal and written date and pre-fills
  the next page label from the last entry (always editable).
- Search needs no change — transcript and page label stay on the entry row.

## Trash view (#27)

Soft delete already shipped (PR #26): rows and blobs are kept, list/search/enrichment
exclude trashed. The view adds: trashed entries newest-first, one-tap Restore, and
Delete forever / Empty trash — each behind an explicit confirm. Purge uses the
existing hard-delete helpers: photo rows → entry row (no CASCADE), then best-effort
blob deletes. Parked: backups; Neon has point-in-time restore, blobs don't — one more
reason trash keeps them.

## Move entries (#28)

`PATCH /api/entries/[id]` accepting `{ journalId: string | null }`, validated against
`journals` like the save route (400 on unknown); null = unfile. UI: "Move to
journal…" picker in the action row.

## Search growth

Owner direction: search should become the power filter tool over time, not at launch.
Launch scope is the architecture:

- Filter state lives in the URL. A Library journal card is a canned search
  underneath; `parseSearchFilters`/`buildSearchQueryString` grow rather than get
  replaced.
- Active filters render as removable chips; "+ add filter" lists conditions. A new
  condition later = one SQL-builder clause + one chip.
- Launch: today's filters (free text, from/to, journal) in the chip UI, plus sort
  (relevance / newest / oldest / reading order).
- Backlog, roughly by value: multiple journals, written/recorded date-field switch,
  tags, has photos, has/partial audio, unfiled only, in-trash, duration range.

## Schema additions (nullable, additive)

- `entries.page_label text`
- `photos.journal_id text REFERENCES journals(id)` — journal cover photos, same
  private-blob/gated-proxy path as entry photos; a photo row belongs to an entry or
  a journal, not both.

Everything else is query + UI work.

## Testing

1. Pure-logic TDD in `src/lib` — unchanged.
2. Route-level integration tests for these features: call handlers with a constructed
   `Request` and injected fakes (runner, blob fns); cover auth gating, status codes,
   orchestration order. Explicit invariant tests: trash destroys nothing; purge only
   targets already-trashed ids.
3. `docs/smoke-checklist.md`, created with the first build PR and updated per
   feature; first step is checking the header build timestamp (2026-07-18 lesson).
4. Maybe later: local Playwright smoke. Recording stays manual (mic + WebRTC).

## Build order

1. Trash view (#27)
2. Nav shell + Library + journal view (#29)
3. Move entries (#28)
4. Capture polish (`page_label` + sticky suggestion)
5. Search increments, one condition at a time

Passkeys + PWA stay queued behind this.
