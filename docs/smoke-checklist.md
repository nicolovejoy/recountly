# Phone smoke checklist

Run on the phone after each prod deploy (prod redeploys on merge to main only).

1. **Build timestamp first.** Open https://recountly.org — the header build timestamp
   must match the deploy you think you're testing. If it doesn't, stop: you're smoke
   testing an old build (or a PR preview).

## Core capture

2. Record a short throwaway entry → words appear live → Done → "Saved ✓" toast.
3. Entry appears at the top of the list; audio plays.

## Trash (#27)

4. Trash the throwaway (Trash button on the expanded card, confirm) → gone from the
   list; a search that matched it returns nothing.
5. Open Trash (button by the Entries heading) → the entry is listed with its trashed
   date.
6. Restore → gone from Trash; back in the entry list.
7. Trash it again → Delete forever (confirm) → gone from Trash; still gone after
   reload.
8. Record + trash a second throwaway → Empty trash (confirm shows count) → Trash view
   empty; still empty after reload.
