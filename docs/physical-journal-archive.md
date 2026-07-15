# Physical journal archive (idea — 2026-07-14, not designed yet)

Owner's ask, verbatim in substance: *ingest old physical journals — group recordings by a
physical journal, add images of the pages (sometimes, not always), and optionally read a page
aloud to get a transcription. Store audio + transcription + images in one private searchable
archive.*

Owner's own framing: "that idea will take some development." Not scoped or scheduled. This
file exists so the thinking survives the session — it is **not** a plan.

## Why this is bigger than it looks

It breaks two assumptions the current schema is built on:

1. **Entries are flat.** There is no grouping concept anywhere — no parent, no collection, no
   ordering beyond `recorded_at`. "Group recordings by a physical journal" is the first real
   hierarchy recountly would have: *journal (a physical book) → page → media*.
2. **Media means audio.** `entries` has exactly one media slot (`audio_url`/`audio_mime`/
   `audio_bytes`/`audio_complete`), singular and best-effort. Page images are a second media
   type, plural per page, and *not* best-effort — a lost page photo is a lost artifact, unlike
   a lost audio segment whose transcript survives.

Also note `recorded_at` currently means "when it was spoken." For an old journal there are two
distinct dates — when the page was *written* (1998) and when it was *read aloud* (2026) — and
search almost certainly wants the former. That's a real modeling decision, not a detail.

## The question that decides the shape

**Does a page image get transcribed by voice, or by vision?** The owner proposed reading pages
aloud. But the enrichment path already talks to Anthropic, and Claude has vision — a page photo
could be transcribed directly, no reading required.

These aren't equivalent, and it isn't obvious which is wanted:

- **Read aloud** — slow (real-time per page), but it's *his voice reading his own words*, which
  may be the point of the archive rather than a cost of it. Produces audio, which vision can't.
- **Vision OCR** — fast, scales to a whole box of journals in an afternoon, and makes images
  searchable without any reading. Produces no audio, and handwriting accuracy is unknown until
  tested on his actual handwriting.
- **Both** — photo for the artifact, vision for searchable text, voice optionally on the pages
  worth narrating. Probably the real answer, but it's the most work.

Worth a 10-minute experiment before any schema work: photograph two or three real pages, run
them through Claude vision, and see whether the handwriting transcribes usably. That result
should drive the design — if vision reads his handwriting well, "read every page aloud" stops
being a requirement and becomes an option.

## Open questions

1. Vision, voice, or both (above)?
2. Is a *page* an entry, or does a journal hold pages that each hold entries? (Cheapest version:
   add `journal_id` + `page_number` to `entries`, no new tables. That may be enough.)
3. `recorded_at` vs. a new `written_at` — which does search sort and filter on?
4. Are images searchable via their transcript only, or does the archive want per-image OCR text
   stored separately?
5. Does this stay best-effort like audio, or do page images need real upload guarantees?
   (Issue #10 is the cautionary tale — best-effort media failed silently for weeks.)

## Constraints this must respect

- **Still single-user.** This is not a multi-user feature and does not revive `user_id` — see
  the Garm decision in `CLAUDE.md`. It's the owner's own archive.
- **Private by construction.** Page images are at least as sensitive as the audio; they go to
  the private Blob store and stream through an auth-gated proxy like `/api/audio/[id]` does.
  Never a public blob URL.
- **The DB is the organization** (from the original brief) — no directory hierarchy. A journal
  is a row and a foreign key, not a folder.
- Reuse the existing search: transcripts already have a `transcript_tsv` GIN index. Page text
  should land somewhere that index can reach rather than growing a parallel search path.
