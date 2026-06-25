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
  title            text,                              -- LLM-generated (Phase 4 enrichment)
  tags             text[]       NOT NULL DEFAULT '{}',
  summary          text,                              -- LLM-generated summary (Phase 4)
  enriched_at      timestamptz,                       -- when enrichment last ran; null = not yet
  enrichment_model text,                              -- which model produced the enrichment
  audio_url        text,                              -- Vercel Blob reference; null = best-effort audio not saved
  audio_mime       text,
  audio_bytes      integer,
  audio_complete   boolean                            -- true = audio covers whole entry; false = partial (paused); null = no audio
);

-- Backfill the audio_complete column onto pre-existing tables (the CREATE above
-- is a no-op once the table exists). Nullable; old rows stay null = "unknown".
ALTER TABLE entries ADD COLUMN IF NOT EXISTS audio_complete boolean;

-- Phase 4 thread 1: LLM enrichment. title/tags already exist; these add the
-- summary plus provenance (when enriched, which model). Nullable; old rows stay
-- null until the backfill endpoint (POST /api/entries/enrich) fills them in.
ALTER TABLE entries ADD COLUMN IF NOT EXISTS summary          text;
ALTER TABLE entries ADD COLUMN IF NOT EXISTS enriched_at      timestamptz;
ALTER TABLE entries ADD COLUMN IF NOT EXISTS enrichment_model text;

-- Newest-first entry list (Phase 2) — order by when it was spoken.
CREATE INDEX IF NOT EXISTS entries_recorded_at_desc ON entries (recorded_at DESC);

-- Phase 3 full-text search. A STORED generated column keeps the tsvector in
-- lockstep with title+transcript automatically (no trigger), and the GIN index
-- makes `transcript_tsv @@ websearch_to_tsquery(...)` fast. 'english' config.
ALTER TABLE entries ADD COLUMN IF NOT EXISTS transcript_tsv tsvector
  GENERATED ALWAYS AS (
    to_tsvector('english', coalesce(title, '') || ' ' || transcript)
  ) STORED;

CREATE INDEX IF NOT EXISTS entries_transcript_tsv_gin ON entries USING GIN (transcript_tsv);
