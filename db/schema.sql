-- recountly entries — the database IS the index (no nested directory tree).
-- Columns mirror EntryRecord in src/lib/entry.ts. Apply against the Neon
-- (Vercel Postgres) database, e.g.  psql "$DATABASE_URL" -f db/schema.sql
-- Idempotent: safe to run more than once.

CREATE TABLE IF NOT EXISTS entries (
  id               text         PRIMARY KEY,          -- ULID-style, time-sortable (src/lib/ulid.ts)
  recorded_at      timestamptz  NOT NULL,             -- when it was actually spoken
  created_at       timestamptz  NOT NULL DEFAULT now(),
  updated_at       timestamptz  NOT NULL DEFAULT now(),
  duration_seconds integer      NOT NULL,
  transcript       text         NOT NULL,
  title            text,                              -- LLM-generated later (Phase 4)
  tags             text[]       NOT NULL DEFAULT '{}',
  audio_url        text,                              -- Vercel Blob reference; null = best-effort audio not saved
  audio_mime       text,
  audio_bytes      integer
);

-- Newest-first entry list (Phase 2) — order by when it was spoken.
CREATE INDEX IF NOT EXISTS entries_recorded_at_desc ON entries (recorded_at DESC);

-- NOTE (Phase 3): full-text search will add a tsvector + GIN index over
-- transcript. Deferred until the search phase so we don't carry unused indexes.
