"use client";

// One saved-entry card, extracted from EntryList (issue #29) so the Library
// journal/unfiled views can reuse it: title/date/duration, journal chip,
// written date, summary, tags, clamped transcript preview, collapsed photo
// thumbnails, audio + partial-audio cue, Trash with confirm, Move…
// (issue #28). Per-card state (photos, trashing, moving) lives here; the
// parent only learns about a successful trash/move via onTrashed/onMoved and
// decides whether the row stays (e.g. a view filtered to one journal drops a
// row that moved elsewhere). journalLabel null hides the chip (redundant
// inside a journal's own view).
//
// Issue #39: the whole non-interactive body (title, date, journal chip,
// summary, tags, transcript preview, photo thumbnails) is now a tap target to
// /entry/[id] — the old in-card "Show more/less" expand + audio + full photos
// moved to that detail page; this card only ever shows a clamped 3-line
// preview. The action row (Move…/Trash/the move <select>) and the audio
// player stay OUTSIDE the tap target so they don't fight it for clicks. In
// select mode (issue #40 — the checkbox is rendered by the parent, sibling to
// this card) the tap target is inert instead of a Link: selection already has
// its own control, and navigating away mid-select would be surprising.

import { useEffect, useState } from "react";
import Link from "next/link";
import { formatElapsed } from "@/lib/elapsed";
import type { EntryRecord } from "@/lib/entry";
import type { PhotoRecord } from "@/lib/photo";

// Sentinel for the Move picker's "Unfiled" option — distinct from any real
// journal id (ULIDs/imp_*), same idea as search.ts's UNFILED_FILTER.
const UNFILED_VALUE = "__unfiled__";

function formatWhen(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

// The card body: title/date/journal chip/summary/tags/clamped transcript +
// up to 3 photo thumbnails. Extracted so the two tap-target wrappers below
// (Link vs. inert div) don't duplicate the markup.
function EntryCardBody({
  e,
  journalLabel,
  thumbs,
}: {
  e: EntryRecord;
  journalLabel: string | null;
  thumbs: PhotoRecord[];
}) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-medium text-foreground/90">
        {e.title ?? formatWhen(e.recordedAt)}
      </span>
      {e.title && (
        <span className="text-xs text-foreground/40">{formatWhen(e.recordedAt)}</span>
      )}
      {(journalLabel || e.writtenAt) && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-foreground/40">
          {journalLabel && (
            <span className="rounded-full border border-foreground/10 px-2 py-0.5">
              📓 {journalLabel}
            </span>
          )}
          {e.writtenAt && (
            <span>written {new Date(e.writtenAt).toLocaleDateString()}</span>
          )}
        </div>
      )}
      {e.summary && <p className="text-sm italic text-foreground/60">{e.summary}</p>}
      {e.tags.length > 0 && (
        <ul className="flex flex-wrap gap-1.5">
          {e.tags.map((tag) => (
            <li
              key={tag}
              className="rounded-full bg-foreground/5 px-2 py-0.5 text-xs text-foreground/60"
            >
              {tag}
            </li>
          ))}
        </ul>
      )}
      <p className="line-clamp-3 whitespace-pre-wrap text-sm leading-relaxed text-foreground/80">
        {e.transcript}
      </p>
      {thumbs.length > 0 && (
        <ul className="flex flex-wrap gap-1.5">
          {thumbs.map((p) => (
            <li key={p.id}>
              {/* eslint-disable-next-line @next/next/no-img-element -- auth-gated same-origin proxy; next/image's optimizer can't fetch it. CSS-sized, not a real thumbnail — #33 tracks a stored ~300px variant. */}
              <img
                src={`/api/photo/${p.id}`}
                alt="Journal page"
                loading="lazy"
                className="h-16 w-16 rounded-md border border-foreground/10 object-cover"
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function EntryCard({
  entry: e,
  journalLabel,
  journals,
  onTrashed,
  onMoved,
  selectMode = false,
}: {
  entry: EntryRecord;
  journalLabel: string | null; // null hides the journal chip
  journals: { id: string; label: string }[] | null; // options for the Move picker
  onTrashed: (id: string) => void;
  onMoved: (id: string, journalId: string | null) => void;
  // Issue #40's select mode: the checkbox lives in the parent (sibling to
  // this card); while true, the card body doesn't navigate.
  selectMode?: boolean;
}) {
  // Collapsed-card thumbnails, up to 3, fetched once on mount ONLY when the
  // entry has photos (photoCount comes from the list/search queries). One
  // fetch per card-with-photos on render — fine at ~200 entries/list with
  // photos still rare; #33's stored thumbnail variant is the proper fix if
  // this ever gets heavy.
  const [thumbs, setThumbs] = useState<PhotoRecord[]>([]);
  useEffect(() => {
    if ((e.photoCount ?? 0) === 0) return;
    let alive = true;
    fetch(`/api/entries/${e.id}/photos`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`photos route ${res.status}`);
        return (await res.json()) as { photos: PhotoRecord[] };
      })
      .then((data) => {
        if (alive) setThumbs(data.photos.slice(0, 3));
      })
      .catch(() => {
        // Card still reads fine without thumbnails.
      });
    return () => {
      alive = false;
    };
  }, [e.id, e.photoCount]);

  const [trashing, setTrashing] = useState(false);
  const [trashError, setTrashError] = useState<string | null>(null);
  const [movePickerOpen, setMovePickerOpen] = useState(false);
  const [moving, setMoving] = useState(false);
  const [moveError, setMoveError] = useState<string | null>(null);

  async function handleDelete() {
    if (
      !window.confirm(
        "Move this entry to trash? It disappears from the list but nothing is destroyed — it can be recovered later.",
      )
    ) {
      return;
    }
    setTrashing(true);
    setTrashError(null);
    try {
      const res = await fetch(`/api/entries/${e.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`delete route ${res.status}`);
      onTrashed(e.id);
    } catch (err) {
      setTrashError(err instanceof Error ? err.message : String(err));
    } finally {
      setTrashing(false);
    }
  }

  async function handleMove(journalId: string | null) {
    setMoving(true);
    setMoveError(null);
    try {
      const res = await fetch(`/api/entries/${e.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ journalId }),
      });
      if (!res.ok) throw new Error(`move route ${res.status}`);
      setMovePickerOpen(false);
      onMoved(e.id, journalId);
    } catch (err) {
      setMoveError(err instanceof Error ? err.message : String(err));
    } finally {
      setMoving(false);
    }
  }

  return (
    <li className="flex flex-col gap-2 rounded-xl border border-foreground/10 p-4">
      {selectMode ? (
        <EntryCardBody e={e} journalLabel={journalLabel} thumbs={thumbs} />
      ) : (
        <Link href={`/entry/${e.id}`} className="block">
          <EntryCardBody e={e} journalLabel={journalLabel} thumbs={thumbs} />
        </Link>
      )}

      <div className="flex items-center justify-between gap-3">
        <span className="text-xs tabular-nums text-foreground/50">
          {formatElapsed(e.durationSeconds)}
        </span>
        <span className="flex shrink-0 items-baseline gap-2">
          {journals !== null && (
            <button
              type="button"
              onClick={() => setMovePickerOpen((open) => !open)}
              disabled={moving}
              className="text-xs text-foreground/40 hover:text-foreground/70 disabled:opacity-50"
            >
              {moving ? "Moving…" : "Move…"}
            </button>
          )}
          <button
            type="button"
            onClick={handleDelete}
            disabled={trashing}
            className="text-xs text-foreground/40 hover:text-red-500 disabled:opacity-50"
          >
            {trashing ? "Trashing…" : "Trash"}
          </button>
        </span>
      </div>
      {movePickerOpen && (
        <div className="flex items-center gap-2 text-xs text-foreground/50">
          <span>Move to</span>
          <select
            defaultValue=""
            disabled={moving}
            onChange={(ev) => {
              const v = ev.target.value;
              if (!v) return;
              handleMove(v === UNFILED_VALUE ? null : v);
            }}
            aria-label="Move to journal"
            className="rounded-lg border border-foreground/15 bg-transparent px-2 py-1 text-xs outline-none focus:border-foreground/40"
          >
            <option value="" disabled>
              Choose…
            </option>
            {/* Current journal (or Unfiled, if that's where it already is) is
                excluded — picking it would be a no-op move. */}
            {e.journalId !== null && <option value={UNFILED_VALUE}>Unfiled</option>}
            {journals
              ?.filter((j) => j.id !== e.journalId)
              .map((j) => (
                <option key={j.id} value={j.id}>
                  {j.label}
                </option>
              ))}
          </select>
          <button
            type="button"
            onClick={() => setMovePickerOpen(false)}
            className="text-foreground/40 hover:text-foreground/70"
          >
            Cancel
          </button>
        </div>
      )}
      {moveError && <p className="text-sm text-red-500">Couldn’t move entry: {moveError}</p>}
      {trashError && (
        <p className="text-sm text-red-500">Couldn’t trash entry: {trashError}</p>
      )}
      {e.audioUrl && (
        <audio controls preload="metadata" src={e.audioUrl} className="mt-1 w-full">
          <track kind="captions" />
        </audio>
      )}
      {e.audioUrl && e.audioComplete === false && (
        <p className="text-xs text-amber-600">
          ⚠ Audio is partial — this entry was paused, so only the last segment was
          recorded. The transcript is complete.
        </p>
      )}
    </li>
  );
}
