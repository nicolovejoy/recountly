# Physical journal archive (plan — 2026-07-14)

Ingest a shelf of old physical paper journals into recountly: group recordings by a physical
journal, attach photos of pages (sometimes), and read pages aloud to transcribe them.

Status: **decided in shape, not yet built or scheduled.** No schema work has started.

## The decision that shapes everything: voice is the point

**Reading pages aloud is the feature, not the ingestion cost.** Owner, 2026-07-14: *"it's not
just about getting it done. I enjoy and learn from that part."* The archive's value includes the
act of reading his own old words aloud — a faster path to the same text would miss the point.

**So: no LLM vision/OCR.** It was raised (twice, independently — the enrichment path already
talks to Anthropic, and Claude has vision) as a way to skip reading pages aloud. Rejected on the
merits, not on feasibility. Owner's handwriting is by his own account terrible, so OCR would
likely struggle anyway — but that's the weaker reason. The real one is that reading aloud is
something he wants to do. A vision spike remains an optional curiosity; it is **not** a blocker
and nothing in this plan waits on it.

**This is why the plan is small.** The obvious design pulls page text into search, which sounds
like widening the existing index but isn't: `entries.transcript_tsv` is a `GENERATED ALWAYS AS
(...) STORED` column, and Postgres generated columns can only reference columns in the *same
row* — they cannot reach a child `photos` table. Pulling OCR text into search would mean
replacing the search mechanism (trigger-maintained tsv, or a UNION across two indexes, or
denormalizing photo text onto the entry). Choosing voice means **the transcript is already on
the entry row and already indexed**. That entire problem evaporates. Photos become pure
artifacts, like audio.

## Plan

1. **`journals` table** — `id`, `label`, `notes` (optional free text), `created_at`. Its only job
   is "this recording belongs to that notebook." Resist structured metadata (era, location,
   mood) until a real need to filter by one appears.
2. **`entries.journal_id`** — nullable FK. Normal spoken entries leave it null.
3. **`entries.written_at`** — nullable timestamptz: when the page was *written* (1994), as
   distinct from the existing `recorded_at` NOT NULL ("when it was actually spoken" — for a
   legacy page, when it was read aloud). Search sorts/filters on
   `coalesce(written_at, recorded_at)`. ⚠️ Do **not** name this `occurred_at` — two date columns
   with near-identical names and subtly different meanings is a trap; `written_at` says what it
   means next to `recorded_at`.
4. **`photos` table** — `id`, `entry_id` FK, blob reference, mime, bytes. Entry 1—* Photo.
5. **Active-journal lock (UI)** — mark a journal active so every capture defaults to it without
   re-selecting. This is the one piece of UI worth building deliberately: re-selecting the
   notebook across hundreds of pages is where friction compounds.
6. **Search: unchanged.** The voice transcript is the searchable text and it's already indexed.
   Add a journal filter beside the existing date filter — same pattern, one more dimension.

## Non-negotiable: photos are NOT best-effort

Audio is best-effort by design (`audio_url` has always been nullable; the transcript survives a
lost segment). **Photos must not inherit that.** They need a verified upload with a real error
surfaced to the user.

Issue #10 — closed 2026-07-14 — was every private audio upload failing *silently* for weeks,
across both the 23 imports and normal prod recordings. It hid precisely *because* audio is
best-effort: nothing was supposed to complain. A lost audio segment is survivable; a lost page
photo is not — nothing else captures that artifact, and re-shooting means finding the notebook
again. Same reason photos stream through an auth-gated proxy (`/api/photo/[id]`, mirroring
`/api/audio/[id]`) over a **private** blob store — never a public blob URL.

## Open question (only one)

**Do photo-only entries need to exist** — a page photographed but not read? If no, the schema
change stays tiny: `journal_id`, `written_at`, `photos`, done. If yes, three NOT NULLs have to
loosen: `transcript`, `duration_seconds`, `recorded_at` — and `duration_seconds` has no meaning
for a photograph (what's the duration of a page?), so it'd need to go nullable or take a
sentinel.

**Default: no.** If reading aloud is the point, every entry has a reading, so every entry has a
transcript and a duration, and photos attach to those entries. Loosen later if the habit
actually wants it — consistent with not building speculative structure.

## Constraints

- **Still single-user.** Does not revive `user_id` — see the Garm decision in `CLAUDE.md`. This
  is the owner's own archive.
- **The DB is the organization** (original brief) — a journal is a row and a foreign key, never
  a folder.
- Reuse what exists: one content type, one search path, one enrichment path. A page read aloud
  and a thought spoken this morning are the same kind of thing — dated, titled, tagged,
  summarized, searchable — differing only in how the content arrived.

## Deliberately not building

Vision/OCR (above) · page numbering or ordinals (capture order gives rough sequence free;
don't track ordinals without a need for exact reconstruction) · OCR confidence or transcription
edit history (one editor, plain overwritable text) · any access control or sharing layer ·
a polymorphic "attachment" system to future-proof for video/PDF · duplicate-page detection ·
a background job/queue for LLM calls (enrichment is already synchronous best-effort on save
and that's fine at this scale) · embeddings or a vector index (plain FTS is enough here).
