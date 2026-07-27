# Journal management: rename, delete, dates, kind (PR A)

Owner request 2026-07-27: CRUD on journal ("folder") names; stored date ranges on journals;
a kind/category to eventually distinguish old paper journals from live capture.

Decisions (owner-confirmed):
- Delete is **blocked unless empty** — 409 with counts; the owner empties a journal
  deliberately via existing select-all + bulk move. No auto-move-to-Unfiled. A future
  "journal archive" state may come later; not now.
- `kind` column lands now (nullable text, values `archive` | null = live), editable in the
  manage UI. Library grouping/badging by kind is **deferred** pending discussion — do not
  build grouping.
- Stored date range overrides the computed-from-entries range where set; computed stays as
  fallback.

## Schema (db/schema.sql — additive, idempotent, matches existing ALTER idiom)

```sql
ALTER TABLE journals ADD COLUMN IF NOT EXISTS started_on date;
ALTER TABLE journals ADD COLUMN IF NOT EXISTS ended_on date;
ALTER TABLE journals ADD COLUMN IF NOT EXISTS kind text;
```

No `updated_at` on journals — not needed.

## Lib (src/lib/journal.ts + db.ts)

- Extend `JournalRecord`/`rowToJournal`/select lists with `startedOn`, `endedOn`, `kind`.
  `journalSummariesSql` also returns them (LibraryView/JournalView need them).
- `validateJournalUpdate(patch)` — partial `{label?, notes?, startedOn?, endedOn?, kind?}`;
  at least one key; label trimmed non-empty (reuse existing label limits from
  `validateJournalInput`); notes nullable string; dates `YYYY-MM-DD` or null, and when both
  set `started_on <= ended_on`; kind `"archive"` or null.
- `updateJournalSql(id, patch)` — dynamic SET for provided keys only, RETURNING full row.
- `countJournalEntriesSql(id)` — one query over ALL entries referencing the journal
  (FK cares about trashed rows too):
  `select count(*)::int as total, count(*) filter (where deleted_at is not null)::int as trashed from entries where journal_id = $1`.
- `clearJournalMoveRefsSql(id)` — one statement nulling both sides:
  `update entry_moves set from_journal_id = case when from_journal_id = $1 then null else from_journal_id end, to_journal_id = case when to_journal_id = $1 then null else to_journal_id end where from_journal_id = $1 or to_journal_id = $1`.
  (entry_moves FKs journals with no ON DELETE — even an empty journal can have move history;
  same manual-cleanup idiom as `src/lib/purge.ts`.)
- `deleteJournalSql(id)` — `delete from journals where id = $1 returning id`.
- db.ts wrappers: `updateJournal`, `countJournalEntries`, `deleteJournal` (clears move refs
  first, then deletes — order matters, mirror purge.ts sequencing).

## Route: src/app/api/journals/[id]/route.ts (first dynamic segment under /api/journals)

Next 16 idiom: `{ params }: { params: Promise<{ id: string }> }`.

- `PATCH` — 401 no session; 400 invalid body; 404 unknown journal; else update, 200
  `{ journal }`.
- `DELETE` — 401; 404 unknown; `countJournalEntries` > 0 → **409**
  `{ error, entryCount, trashedCount }` (message must mention trash when the blockers are
  trashed entries — the visible count in the UI excludes trash, so this is the confusing
  case); else clear refs + delete, 200 `{ ok: true }`. Deleting the active journal is
  allowed (no journal is active afterwards). Catch a racing FK violation on delete and
  return 409, not 500.

## UI

- `JournalView.tsx` header (h2 at ~147): add a manage toggle (pencil/⋯) opening an inline
  panel — label input, kind select (— / archive), started/ended date inputs, notes
  textarea (column already exists), Save/Cancel, Delete. Delete disabled with the count
  message when non-empty; confirm before delete (match the existing Trash confirm
  pattern); on success navigate to /library.
- Date range display: stored range wins when either date is set, else the computed
  `formatEntryDateRange`. Add a small pure helper (extend `src/lib/date-range.ts`),
  unit-tested. Use it in JournalView and, if LibraryView cards already show a range,
  there too.
- `useJournals.ts`: add `update(id, patch)` and `remove(id)`; refresh after both.
- No JournalBar/capture changes.

## Tests (repo idioms — route tests mock @/lib/db + @/lib/auth-server; SQL builders assert {text, values})

- `journal.test.ts`: validateJournalUpdate matrix, updateJournalSql (single-field, multi-
  field, value ordering), countJournalEntriesSql, clearJournalMoveRefsSql, deleteJournalSql,
  extended rowToJournal/summaries.
- New `src/app/api/journals/[id]/route.test.ts`: PATCH 401/400/404/200 + 500-with-detail;
  DELETE 401/404/409 (incl. trashed-only counts in the message)/200 verifying
  clear-refs-before-delete call order.
- `db.test.ts`: new wrappers.
- date-range helper tests.

## Out of scope

Library grouping/badges by kind; journal archive/hide state; auto-move on delete;
capture-UI changes; any entries-table change (that's PR B).
