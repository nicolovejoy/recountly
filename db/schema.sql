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

-- entries_recorded_at_desc (Phase 2, order by recorded_at DESC) is superseded
-- by entries_effective_at_desc below (coalesce(written_at, recorded_at) DESC) —
-- drop it; DROP INDEX IF EXISTS is idempotent so re-running this file is safe.
DROP INDEX IF EXISTS entries_recorded_at_desc;

-- Phase 3 full-text search. A STORED generated column keeps the tsvector in
-- lockstep with title+transcript automatically (no trigger), and the GIN index
-- makes `transcript_tsv @@ websearch_to_tsquery(...)` fast. 'english' config.
ALTER TABLE entries ADD COLUMN IF NOT EXISTS transcript_tsv tsvector
  GENERATED ALWAYS AS (
    to_tsvector('english', coalesce(title, '') || ' ' || transcript)
  ) STORED;

CREATE INDEX IF NOT EXISTS entries_transcript_tsv_gin ON entries USING GIN (transcript_tsv);

-- Physical journal archive (2026-07-16, issues #15/#16). A journal groups
-- readings by the paper notebook they came from; `active` marks the notebook
-- currently being read so captures default to it (exactly one active row is
-- maintained app-side by setActiveJournalSql's single UPDATE).
CREATE TABLE IF NOT EXISTS journals (
  id         text        PRIMARY KEY,           -- ULID (src/lib/ulid.ts)
  label      text        NOT NULL,
  notes      text,                              -- optional free text
  active     boolean     NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Which notebook an entry belongs to (null = a normal spoken entry) and when
-- the page was originally *written* — as distinct from recorded_at, which for
-- a legacy page is when it was read aloud. NOT named occurred_at (see
-- docs/physical-journal-archive.md).
ALTER TABLE entries ADD COLUMN IF NOT EXISTS journal_id text REFERENCES journals(id);
ALTER TABLE entries ADD COLUMN IF NOT EXISTS written_at timestamptz;

-- Soft-delete (trash): null = live; a trashed entry keeps its row + audio/photo
-- blobs for recovery — deleting hides it everywhere but destroys nothing.
ALTER TABLE entries ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

-- Page photos, 1 entry — * photos. Blobs are PRIVATE, named photos/<id>.<ext>
-- (path derived from id — no URL column), served via the auth-gated
-- GET /api/photo/[id] proxy. Photos are NOT best-effort: a failed upload
-- fails the save (issue #10 is why).
CREATE TABLE IF NOT EXISTS photos (
  id         text        PRIMARY KEY,           -- ULID; capture-ordered
  entry_id   text        NOT NULL REFERENCES entries(id),
  mime       text        NOT NULL,
  bytes      integer     NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS photos_entry_id ON photos (entry_id);

-- The entry's *effective* date: when written if known, else when spoken.
-- List ordering and search date filters use this expression.
CREATE INDEX IF NOT EXISTS entries_effective_at_desc
  ON entries ((coalesce(written_at, recorded_at)) DESC);

-- Move-entry audit log (issue #28). Append-only — no UPDATE/DELETE path in the
-- app. Written atomically with the entries.journal_id UPDATE (moveEntrySql's
-- data-modifying CTE); null journal ids mean Unfiled on either side.
CREATE TABLE IF NOT EXISTS entry_moves (
  id              bigserial   PRIMARY KEY,
  entry_id        text        NOT NULL REFERENCES entries(id),
  from_journal_id text        REFERENCES journals(id),
  to_journal_id   text        REFERENCES journals(id),
  moved_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS entry_moves_entry_id ON entry_moves (entry_id);
