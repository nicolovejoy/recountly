"use client";

// One saved-entry card, extracted from EntryList (issue #29) so the Library
// journal/unfiled views can reuse it: title/date/duration, journal chip,
// written date, summary, tags, clamp-aware expand with lazy photo fetch,
// audio + partial-audio cue, Trash with confirm, Move… (issue #28). Per-card
// state (expanded, photos, trashing, moving) lives here; the parent only
// learns about a successful trash/move via onTrashed/onMoved and decides
// whether the row stays (e.g. a view filtered to one journal drops a row that
// moved elsewhere). journalLabel null hides the chip (redundant inside a
// journal's own view).

import { useLayoutEffect, useRef, useState } from "react";
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

// The 3-line clamp on the collapsed transcript only sometimes actually
// truncates anything, and photos (attached to the entry) are only rendered
// once expanded — so this measures real clamping via scrollHeight vs
// clientHeight (correct at any line width, unlike a character-count guess)
// and renders the Show more/less toggle only when there's something it would
// reveal: either the transcript is genuinely clamped, or the entry has photos.
function EntryTranscript({
  transcript,
  isOpen,
  onToggle,
  photoCount,
}: {
  transcript: string;
  isOpen: boolean;
  onToggle: () => void;
  photoCount: number;
}) {
  const ref = useRef<HTMLParagraphElement>(null);
  const [clamped, setClamped] = useState(false);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setClamped(el.scrollHeight > el.clientHeight + 1);
  }, [transcript]);

  const expandable = clamped || photoCount > 0;

  const paragraph = (
    <p
      ref={ref}
      className={`whitespace-pre-wrap text-sm leading-relaxed text-foreground/80 ${
        isOpen ? "" : "line-clamp-3"
      }`}
    >
      {transcript}
    </p>
  );

  if (!expandable) {
    return paragraph;
  }

  return (
    <button type="button" onClick={onToggle} aria-expanded={isOpen} className="text-left">
      {paragraph}
      <span className="mt-1 inline-block text-xs text-foreground/40">
        {isOpen ? "Show less" : "Show more"}
      </span>
    </button>
  );
}

export default function EntryCard({
  entry: e,
  journalLabel,
  journals,
  onTrashed,
  onMoved,
}: {
  entry: EntryRecord;
  journalLabel: string | null; // null hides the journal chip
  journals: { id: string; label: string }[] | null; // options for the Move picker
  onTrashed: (id: string) => void;
  onMoved: (id: string, journalId: string | null) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  // Photos are fetched lazily on first expand and cached; null = not yet
  // requested (set to [] immediately so a double-tap doesn't double-fetch).
  const [photos, setPhotos] = useState<PhotoRecord[] | null>(null);
  const [trashing, setTrashing] = useState(false);
  const [trashError, setTrashError] = useState<string | null>(null);
  const [movePickerOpen, setMovePickerOpen] = useState(false);
  const [moving, setMoving] = useState(false);
  const [moveError, setMoveError] = useState<string | null>(null);

  function toggle() {
    setIsOpen((open) => !open);
    if (photos === null) {
      // Mark as requested immediately so a double-tap doesn't double-fetch.
      setPhotos([]);
      fetch(`/api/entries/${e.id}/photos`)
        .then(async (res) => {
          if (!res.ok) throw new Error(`photos route ${res.status}`);
          return (await res.json()) as { photos: PhotoRecord[] };
        })
        .then((data) => setPhotos(data.photos))
        .catch(() => {
          // Leave the cached empty list; the transcript is still readable.
        });
    }
  }

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
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm font-medium text-foreground/90">
          {e.title ?? formatWhen(e.recordedAt)}
        </span>
        <span className="flex shrink-0 items-baseline gap-2">
          <span className="text-xs tabular-nums text-foreground/50">
            {formatElapsed(e.durationSeconds)}
          </span>
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
      <EntryTranscript
        transcript={e.transcript}
        isOpen={isOpen}
        onToggle={toggle}
        photoCount={e.photoCount ?? 0}
      />
      {isOpen && (photos?.length ?? 0) > 0 && (
        <ul className="flex flex-wrap gap-2">
          {photos?.map((p) => (
            <li key={p.id}>
              {/* eslint-disable-next-line @next/next/no-img-element -- auth-gated same-origin proxy; next/image's optimizer can't fetch it */}
              <img
                src={`/api/photo/${p.id}`}
                alt="Journal page"
                loading="lazy"
                className="max-h-96 rounded-lg border border-foreground/10"
              />
            </li>
          ))}
        </ul>
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
