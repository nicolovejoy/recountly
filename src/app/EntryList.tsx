"use client";

// Saved entries (Phase 2) + search/filter (Phase 3). Holds the filter state,
// debounces the free-text query, and fetches GET /api/entries?q&from&to. The API
// returns rows already ordered (relevance when searching, else newest-first), so
// this just renders them. Refetches when filters change or RecorderClient bumps
// reloadKey after a save. Tap a transcript to expand it full-length.

import { useEffect, useMemo, useState } from "react";
import { formatElapsed } from "@/lib/elapsed";
import { buildSearchQueryString } from "@/lib/search";
import type { EntryRecord } from "@/lib/entry";
import SearchBar from "./SearchBar";

function formatWhen(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

export default function EntryList({ reloadKey }: { reloadKey: number }) {
  const [query, setQuery] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [entries, setEntries] = useState<EntryRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // Debounce the free-text box so we don't fire a request per keystroke.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query), 300);
    return () => clearTimeout(t);
  }, [query]);

  const queryString = useMemo(
    () => buildSearchQueryString({ query: debouncedQuery, from, to }),
    [debouncedQuery, from, to],
  );
  const isSearching = Boolean(debouncedQuery || from || to);

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
  }

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-medium text-foreground/50">Entries</h2>

      <SearchBar
        query={query}
        from={from}
        to={to}
        onChange={(p) => {
          if (p.query !== undefined) setQuery(p.query);
          if (p.from !== undefined) setFrom(p.from);
          if (p.to !== undefined) setTo(p.to);
        }}
        onClear={() => {
          setQuery("");
          setFrom("");
          setTo("");
        }}
      />

      {error && (
        <p className="text-sm text-red-500">Couldn’t load entries: {error}</p>
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
                <span className="shrink-0 text-xs tabular-nums text-foreground/50">
                  {formatElapsed(e.durationSeconds)}
                </span>
              </div>
              {e.title && (
                <span className="text-xs text-foreground/40">{formatWhen(e.recordedAt)}</span>
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
              <button
                type="button"
                onClick={() => toggle(e.id)}
                aria-expanded={isOpen}
                className="text-left"
              >
                <p
                  className={`whitespace-pre-wrap text-sm leading-relaxed text-foreground/80 ${
                    isOpen ? "" : "line-clamp-3"
                  }`}
                >
                  {e.transcript}
                </p>
                <span className="mt-1 inline-block text-xs text-foreground/40">
                  {isOpen ? "Show less" : "Show more"}
                </span>
              </button>
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
