"use client";

// Per-entry detail page (issue #39), reached by tapping a card in Library/
// Search or via the post-save redirect. Transcript-first: unlike EntryCard's
// clamped preview, the full transcript reads top-to-bottom with nothing
// hidden. Same client-fetches-a-gated-route idiom as JournalView/EntryList —
// GET /api/entries/[id] for the row, GET /api/entries/[id]/photos for photos
// (getEntry doesn't carry photoCount, so this always fetches, unlike
// EntryCard's photoCount-gated fetch). Move…/Trash mirror EntryCard's
// handlers; trashing an entry you're looking at leaves nothing to show, so
// success routes back to Library instead of leaving a dead page mounted.

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { formatElapsed } from "@/lib/elapsed";
import type { EntryRecord } from "@/lib/entry";
import type { PhotoRecord } from "@/lib/photo";
import { useJournals } from "./useJournals";

// Sentinel for the Move picker's "Unfiled" option — same idea as
// EntryCard.tsx's UNFILED_VALUE / search.ts's UNFILED_FILTER.
const UNFILED_VALUE = "__unfiled__";

function formatWhen(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

export default function EntryDetail({ id }: { id: string }) {
  const router = useRouter();
  // undefined = loading; null = 404 (unknown or trashed).
  const [entry, setEntry] = useState<EntryRecord | null | undefined>(undefined);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [photos, setPhotos] = useState<PhotoRecord[] | null>(null);
  const { journals } = useJournals();

  const [trashing, setTrashing] = useState(false);
  const [trashError, setTrashError] = useState<string | null>(null);
  const [movePickerOpen, setMovePickerOpen] = useState(false);
  const [moving, setMoving] = useState(false);
  const [moveError, setMoveError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetch(`/api/entries/${id}`)
      .then(async (res) => {
        if (res.status === 404) return null;
        if (!res.ok) throw new Error(`entry route ${res.status}`);
        return ((await res.json()) as { entry: EntryRecord }).entry;
      })
      .then((e) => {
        if (alive) setEntry(e);
      })
      .catch((err) => {
        if (alive) setLoadError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      alive = false;
    };
  }, [id]);

  // Photos aren't on the GET /api/entries/[id] payload (unlike the list/
  // search routes' photoCount) — fetch once the entry itself has loaded.
  useEffect(() => {
    if (!entry) return;
    let alive = true;
    fetch(`/api/entries/${entry.id}/photos`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`photos route ${res.status}`);
        return (await res.json()) as { photos: PhotoRecord[] };
      })
      .then((data) => {
        if (alive) setPhotos(data.photos);
      })
      .catch(() => {
        // The transcript is still readable without photos; leave them unset.
      });
    return () => {
      alive = false;
    };
  }, [entry]);

  async function handleDelete() {
    if (!entry) return;
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
      const res = await fetch(`/api/entries/${entry.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`delete route ${res.status}`);
      // Nothing left to show on this page once it's trashed.
      router.push("/library");
    } catch (err) {
      setTrashError(err instanceof Error ? err.message : String(err));
      setTrashing(false);
    }
  }

  async function handleMove(journalId: string | null) {
    if (!entry) return;
    setMoving(true);
    setMoveError(null);
    try {
      const res = await fetch(`/api/entries/${entry.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ journalId }),
      });
      if (!res.ok) throw new Error(`move route ${res.status}`);
      setMovePickerOpen(false);
      setEntry((prev) => (prev ? { ...prev, journalId } : prev));
    } catch (err) {
      setMoveError(err instanceof Error ? err.message : String(err));
    } finally {
      setMoving(false);
    }
  }

  const journalLabel =
    entry?.journalId ? (journals?.find((j) => j.id === entry.journalId)?.label ?? "journal") : null;

  return (
    <section className="flex flex-col gap-4">
      <Link href="/library" className="text-xs text-foreground/40 hover:text-foreground/70">
        ← Library
      </Link>

      {loadError && (
        <p className="text-sm text-red-500">Couldn’t load entry: {loadError}</p>
      )}

      {entry === null && !loadError && (
        <p className="text-sm text-foreground/40">No such entry.</p>
      )}

      {entry === undefined && !loadError && (
        <p className="text-sm text-foreground/40">Loading…</p>
      )}

      {entry && (
        <>
          <div className="flex flex-col gap-2">
            <h1 className="text-lg font-medium text-foreground/90">
              {entry.title ?? formatWhen(entry.recordedAt)}
            </h1>
            {entry.title && (
              <span className="text-xs text-foreground/40">{formatWhen(entry.recordedAt)}</span>
            )}
            {(journalLabel || entry.writtenAt) && (
              <div className="flex flex-wrap items-center gap-2 text-xs text-foreground/40">
                {journalLabel && (
                  <span className="rounded-full border border-foreground/10 px-2 py-0.5">
                    📓 {journalLabel}
                  </span>
                )}
                {entry.writtenAt && (
                  <span>written {new Date(entry.writtenAt).toLocaleDateString()}</span>
                )}
              </div>
            )}
            {entry.summary && (
              <p className="text-sm italic text-foreground/60">{entry.summary}</p>
            )}
            {entry.tags.length > 0 && (
              <ul className="flex flex-wrap gap-1.5">
                {entry.tags.map((tag) => (
                  <li
                    key={tag}
                    className="rounded-full bg-foreground/5 px-2 py-0.5 text-xs text-foreground/60"
                  >
                    {tag}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Transcript-first: full text, no clamp — this is the read view. */}
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground/80">
            {entry.transcript}
          </p>

          {entry.audioUrl && (
            <audio controls preload="metadata" src={entry.audioUrl} className="w-full">
              <track kind="captions" />
            </audio>
          )}
          {entry.audioUrl && entry.audioComplete === false && (
            <p className="text-xs text-amber-600">
              ⚠ Audio is partial — this entry was paused, so only the last segment was
              recorded. The transcript is complete.
            </p>
          )}

          {(photos?.length ?? 0) > 0 && (
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

          <div className="flex flex-col gap-2 border-t border-foreground/10 pt-3">
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs tabular-nums text-foreground/50">
                {formatElapsed(entry.durationSeconds)}
              </span>
              <span className="flex shrink-0 items-baseline gap-2">
                <button
                  type="button"
                  onClick={() => setMovePickerOpen((open) => !open)}
                  disabled={moving}
                  className="text-xs text-foreground/40 hover:text-foreground/70 disabled:opacity-50"
                >
                  {moving ? "Moving…" : "Move…"}
                </button>
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
                  {entry.journalId !== null && <option value={UNFILED_VALUE}>Unfiled</option>}
                  {journals
                    ?.filter((j) => j.id !== entry.journalId)
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
            {moveError && (
              <p className="text-sm text-red-500">Couldn’t move entry: {moveError}</p>
            )}
            {trashError && (
              <p className="text-sm text-red-500">Couldn’t trash entry: {trashError}</p>
            )}
          </div>
        </>
      )}
    </section>
  );
}
