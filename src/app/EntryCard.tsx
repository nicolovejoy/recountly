"use client";

// One saved-entry card, extracted from EntryList (issue #29) so the Library
// journal/unfiled views can reuse it: title/date/duration, journal chip,
// written date, summary, tags, clamp-aware expand with lazy photo fetch,
// audio + partial-audio cue, Trash with confirm. Per-card state (expanded,
// photos, trashing) lives here; the parent only learns about a successful
// trash via onTrashed and drops the row. journalLabel null hides the chip
// (redundant inside a journal's own view).

import { useLayoutEffect, useRef, useState } from "react";
import { formatElapsed } from "@/lib/elapsed";
import type { EntryRecord } from "@/lib/entry";
import type { PhotoRecord } from "@/lib/photo";

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
  onTrashed,
}: {
  entry: EntryRecord;
  journalLabel: string | null; // null hides the journal chip
  onTrashed: (id: string) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  // Photos are fetched lazily on first expand and cached; null = not yet
  // requested (set to [] immediately so a double-tap doesn't double-fetch).
  const [photos, setPhotos] = useState<PhotoRecord[] | null>(null);
  const [trashing, setTrashing] = useState(false);
  const [trashError, setTrashError] = useState<string | null>(null);

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
        <audio controls preload="none" src={e.audioUrl} className="mt-1 w-full">
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
