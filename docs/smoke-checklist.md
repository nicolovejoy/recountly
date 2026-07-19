# Phone smoke checklist

Run on the phone after each prod deploy (prod redeploys on merge to main only).

1. **Build timestamp first.** Open https://recountly.org — the header build timestamp
   must match the deploy you think you're testing, and it's visible on all three tabs
   (Capture, Library, Search). If it doesn't match, stop: you're smoke testing an old
   build (or a PR preview).

## Core capture

2. Record a short throwaway entry → words appear live → Done → "Saved ✓" toast.
3. Entry appears at the top of the Search list; audio plays.

### Client-direct upload (#23, Phase A)

Since #23 the save path uploads audio + photos straight to Vercel Blob from the browser
(via `POST /api/blob/upload` client tokens), then POSTs a small JSON body — no more
multipart. What to check:
- A long recording **plus several photos** (a payload that previously tripped the ~4.5 MB
  function-body cap) now saves cleanly.
- The entry's audio plays through `/api/audio/[id]`; attached photos show on expand
  through `/api/photo/[id]`.
- A photo-upload failure keeps the photo tray (photos are not best-effort); an audio-only
  hiccup still saves the transcript.

## Nav shell (#29)

4. While recording (and while paused), the Library and Search tabs are disabled with
   the hint "Recording in progress — tap Done before leaving" → Done → tabs live
   again.
5. A saved entry filed under a journal appears in that journal's view (Library →
   journal card, reading order) and in Search (newest-first).
6. Back button walks Library → journal → Library.

## Trash (#27, routed at /library/trash since #29)

7. Trash the throwaway from Search (Trash button on the entry card, confirm) → gone
   from the list; a search that matched it returns nothing.
8. Open Library → Trash → the entry is listed with its trashed date.
9. Restore → gone from Trash; back in both Library (its journal / Unfiled) and Search.
10. Trash it again → Delete forever (confirm) → gone from Trash; still gone after
    reload.
11. Record + trash a second throwaway → Empty trash (confirm shows count) → Trash view
    empty; still empty after reload.
