# Entry metadata editing: title, notes, location, written date (PR B)

Owner request 2026-07-27: editable entry titles; free-text notes on entries (e.g. "chat
with Paul Reed"); a location field defaulting to "home"; edit the original/written date
after save. Notes and location must be searchable.

Decisions (owner-confirmed):
- All of these are **post-save edits on the entry detail page**. The save path
  (save-payload.ts, pending-save, RecorderClient) is untouched — do not thread new fields
  through capture.
- Location defaults to `home` for NEW entries only (DB default); existing rows stay null
  (don't fabricate history).
- FTS grows to cover title + notes + location + transcript.

## Schema (db/schema.sql)

```sql
ALTER TABLE entries ADD COLUMN IF NOT EXISTS notes text;
ALTER TABLE entries ADD COLUMN IF NOT EXISTS location text;
ALTER TABLE entries ALTER COLUMN location SET DEFAULT 'home';
```

ADD without a default (existing rows stay null), then SET DEFAULT so only future inserts
get `home`. ⚠️ For the default to apply, `insertEntrySql` must NOT list `location` (or
`notes`) in its column list — extend the SELECT `COLUMNS` string and `rowToEntry` only,
leave the insert untouched.

FTS rebuild — `transcript_tsv` is a STORED generated column; expressions can't be altered
in place. Guarded drop + recreate, idempotent across repeated `pnpm db:migrate` runs:

```sql
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'entries' AND column_name = 'transcript_tsv'
      AND (generation_expression IS NULL OR generation_expression NOT LIKE '%notes%')
  ) THEN
    EXECUTE 'ALTER TABLE entries DROP COLUMN transcript_tsv';
  END IF;
END $$;
ALTER TABLE entries ADD COLUMN IF NOT EXISTS transcript_tsv tsvector
  GENERATED ALWAYS AS (
    to_tsvector('english',
      coalesce(title, '') || ' ' || coalesce(notes, '') || ' ' ||
      coalesce(location, '') || ' ' || transcript)
  ) STORED;
CREATE INDEX IF NOT EXISTS <existing GIN index name> ON entries USING gin (transcript_tsv);
```

Dropping the column drops the GIN index — recreate it under its current name (read it from
schema.sql). ⚠️ Check how `pnpm db:migrate` executes schema.sql before writing this: if it
splits statements on `;`, the `DO $$ ... $$` block will break and the runner needs adjusting
(pg's simple query protocol accepts the whole file as one multi-statement string).
`searchEntriesSql` itself needs no change — it queries the column, not the expression.

## Lib (src/lib/entry.ts, entry-sql.ts, db.ts)

- `EntryRecord` (and rowToEntry/COLUMNS) gains `notes: string | null`,
  `location: string | null`. `EntryInput`/`buildEntryRecord`/`validateEntryInput`
  unchanged.
- `validateEntryMetadataPatch(body)` — partial `{title?, notes?, location?, writtenAt?}`;
  at least one known key; strings trimmed, `""` → null (clearing title falls back to the
  timestamp render; clearing location → null, not "home"); sane length caps (title ~300,
  location ~200, notes generous); writtenAt ISO timestamp or null (client sends the same
  local-noon ISO used at capture — reuse `writtenAtIso`).
- `updateEntryMetadataSql(id, patch)` — dynamic SET for provided keys + `updated_at =
  now()`, `WHERE id = $1 AND deleted_at IS NULL`, RETURNING the full COLUMNS row. Plain
  UPDATE — no CTE, no entry_moves audit (that idiom is for journal moves only).
- db.ts: `updateEntryMetadata(id, patch)` → row or null.
- **Enrichment must not clobber an edited title**: change `updateEnrichmentSql` to
  `title = coalesce(entries.title, $n)` so enrichment only fills a null title. (Save-time
  enrichment races a fast user edit on the #54 detail page; backfill re-runs exist too.)
  Summary/tags stay enrichment-owned. Test this.

## Route: PATCH /api/entries/[id] (src/app/api/entries/[id]/route.ts)

Two clearly separated branches on the existing PATCH:
- body contains `journalId` → existing move path, unchanged;
- body contains only metadata keys → validate, `updateEntryMetadata`, 404 when no row
  (unknown or trashed), 200 `{ entry }`;
- body mixing `journalId` with metadata keys, or matching neither → 400.

## UI (src/app/EntryDetail.tsx)

- "Edit" button in the actions row → metadata block becomes a form: title input
  (placeholder = the formatWhen fallback), location input, written-date input (date picker,
  empty = none; available for all entries, not just journal ones), notes textarea.
  Save → PATCH → optimistic `setEntry` merge (follow the `handleMove` idiom, ~line 257);
  Cancel restores; surface errors like existing handlers.
- Display mode: notes as its own pre-wrap block under the summary (render only when
  non-null); location chip next to the journal/written badges (render when non-null — new
  entries will show "home", that's intended); written date badge already exists.
- Hide the Edit affordance while the #54 post-save placeholder/poll is still active
  (the poll's `setEntry` on completion would clobber an in-flight edit).
- EntryCard: no changes (detail-only surface; search finds notes/location).

## Tests

- `entry-sql.test.ts`: `updateEntryMetadataSql` describe (each field alone, combined,
  ""→null handling upstream, WHERE deleted_at clause, RETURNING shape, value ordering);
  updated `updateEnrichmentSql` coalesce behavior; COLUMNS/rowToEntry additions.
- `entry.test.ts`: validateEntryMetadataPatch matrix (unknown keys, empty patch, clears,
  caps, writtenAt parsing).
- `db.test.ts`: wrapper.
- `src/app/api/entries/[id]/route.test.ts`: metadata PATCH 401/400 (empty, mixed with
  journalId)/404 trashed/200 happy + 500-with-detail; regression: move PATCH still works.

## Out of scope

Geolocation autofill (manual text only for now); transcript editing on the detail page;
notes/location at capture time; EntryCard display; search-UI changes (#36 owns those).
