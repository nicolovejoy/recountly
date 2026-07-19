"use client";

// Saved entries (Phase 2) + search/filter (Phase 3). Holds the filter state,
// debounces the free-text query, and fetches GET /api/entries?q&from&to. The API
// returns rows already ordered (relevance when searching, else newest-first), so
// this just renders them. Refetches when filters change, on mount (each tab
// visit remounts it), or when the parent bumps reloadKey (e.g. after a trash
// restore). Tap a transcript to expand it full-length.

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { formatElapsed } from "@/lib/elapsed";
import { buildSearchQueryString } from "@/lib/search";
import type { EntryRecord } from "@/lib/entry";
import type { JournalRecord } from "@/lib/journal";
import type { PhotoRecord } from "@/lib/photo";
import SearchBar from "./SearchBar";

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

export default function EntryList({
  reloadKey = 0,
  journals,
  onShowTrash,
}: {
  reloadKey?: number;
  journals: JournalRecord[] | null;
  onShowTrash: () => void;
}) {
  const [query, setQuery] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [journalFilter, setJournalFilter] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [entries, setEntries] = useState<EntryRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const journalLabel = useMemo(() => {
    const m = new Map<string, string>();
    journals?.forEach((j) => m.set(j.id, j.label));
    return m;
  }, [journals]);

  // Photos are fetched lazily on first expand and cached per entry id.
  const [photosByEntry, setPhotosByEntry] = useState<Record<string, PhotoRecord[]>>({});

  // Debounce the free-text box so we don't fire a request per keystroke.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query), 300);
    return () => clearTimeout(t);
  }, [query]);

  const queryString = useMemo(
    () =>
      buildSearchQueryString({
        query: debouncedQuery,
        from,
        to,
        journalId: journalFilter || undefined,
      }),
    [debouncedQuery, from, to, journalFilter],
  );
  const isSearching = Boolean(debouncedQuery || from || to || journalFilter);

  useEffect(() => {
    let alive = true;
    fetch(`/api/entries${queryString}`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`list route ${res.status}`);
        return (await res.json()) as { entries: EntryRecord[] };
      })
      .then((data) => {
        if (!alive) return;
        setEntries(data.entries);
        setError(null);
      })
      .catch((err) => {
        if (alive) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      alive = false;
    };
  }, [queryString, reloadKey]);

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    if (!(id in photosByEntry)) {
      // Mark as requested immediately so a double-tap doesn't double-fetch.
      setPhotosByEntry((prev) => ({ ...prev, [id]: [] }));
      fetch(`/api/entries/${id}/photos`)
        .then(async (res) => {
          if (!res.ok) throw new Error(`photos route ${res.status}`);
          return (await res.json()) as { photos: PhotoRecord[] };
        })
        .then((data) => setPhotosByEntry((prev) => ({ ...prev, [id]: data.photos })))
        .catch(() => {
          // Leave the cached empty list; the transcript is still readable.
        });
    }
  }

  async function handleDelete(id: string) {
    if (
      !window.confirm(
        "Move this entry to trash? It disappears from the list but nothing is destroyed — it can be recovered later.",
      )
    ) {
      return;
    }
    setDeletingId(id);
    setDeleteError(null);
    try {
      const res = await fetch(`/api/entries/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`delete route ${res.status}`);
      setEntries((prev) => prev?.filter((e) => e.id !== id) ?? prev);
      setExpanded((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      setPhotosByEntry((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : String(err));
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-medium text-foreground/50">Entries</h2>
        <button
          type="button"
          onClick={onShowTrash}
          className="text-xs text-foreground/40 hover:text-foreground/70"
        >
          Trash
        </button>
      </div>

      <SearchBar
        query={query}
        from={from}
        to={to}
        journal={journalFilter}
        journals={journals}
        onChange={(p) => {
          if (p.query !== undefined) setQuery(p.query);
          if (p.from !== undefined) setFrom(p.from);
          if (p.to !== undefined) setTo(p.to);
          if (p.journal !== undefined) setJournalFilter(p.journal);
        }}
        onClear={() => {
          setQuery("");
          setFrom("");
          setTo("");
          setJournalFilter("");
        }}
      />

      {error && (
        <p className="text-sm text-red-500">Couldn’t load entries: {error}</p>
      )}

      {deleteError && (
        <p className="text-sm text-red-500">Couldn’t trash entry: {deleteError}</p>
      )}

      {entries && entries.length === 0 && !error && (
        <p className="text-sm text-foreground/40">
          {isSearching ? "No entries match." : "No entries yet — record one above."}
        </p>
      )}

      <ul className="flex flex-col gap-3">
        {entries?.map((e) => {
          const isOpen = expanded.has(e.id);
          return (
            <li
              key={e.id}
              className="flex flex-col gap-2 rounded-xl border border-foreground/10 p-4"
            >
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
                    onClick={() => handleDelete(e.id)}
                    disabled={deletingId === e.id}
                    className="text-xs text-foreground/40 hover:text-red-500 disabled:opacity-50"
                  >
                    {deletingId === e.id ? "Trashing…" : "Trash"}
                  </button>
                </span>
              </div>
              {e.title && (
                <span className="text-xs text-foreground/40">{formatWhen(e.recordedAt)}</span>
              )}
              {(e.journalId || e.writtenAt) && (
                <div className="flex flex-wrap items-center gap-2 text-xs text-foreground/40">
                  {e.journalId && (
                    <span className="rounded-full border border-foreground/10 px-2 py-0.5">
                      📓 {journalLabel.get(e.journalId) ?? "journal"}
                    </span>
                  )}
                  {e.writtenAt && (
                    <span>written {new Date(e.writtenAt).toLocaleDateString()}</span>
                  )}
                </div>
              )}
              {e.summary && (
                <p className="text-sm italic text-foreground/60">{e.summary}</p>
              )}
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
                onToggle={() => toggle(e.id)}
                photoCount={e.photoCount ?? 0}
              />
              {isOpen && (photosByEntry[e.id]?.length ?? 0) > 0 && (
                <ul className="flex flex-wrap gap-2">
                  {photosByEntry[e.id].map((p) => (
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
        })}
      </ul>
    </section>
  );
}
