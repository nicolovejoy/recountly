"use client";

// Saved entries (Phase 2) + search/filter (Phase 3). Holds the filter state,
// debounces the free-text query, and fetches GET /api/entries?q&from&to. The API
// returns rows already ordered (relevance when searching, else newest-first), so
// this just renders them. Refetches when filters change, on mount (each tab
// visit remounts it), or when the parent bumps reloadKey.
// Per-card state (expand, photos, trashing) lives in EntryCard
// (extracted for issue #29); a trashed card calls onTrashed and the row is
// dropped here.

import { useEffect, useMemo, useState } from "react";
import {
  buildSearchQueryString,
  journalFilterToSearch,
  UNFILED_FILTER,
} from "@/lib/search";
import type { EntryRecord } from "@/lib/entry";
import EntryCard from "./EntryCard";
import SearchBar from "./SearchBar";

export default function EntryList({
  reloadKey = 0,
  journals,
  unfiledCount = 0,
}: {
  reloadKey?: number;
  journals: { id: string; label: string }[] | null;
  unfiledCount?: number; // > 0 surfaces the Unfiled choice in the journal filter
}) {
  const [query, setQuery] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [journalFilter, setJournalFilter] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [entries, setEntries] = useState<EntryRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const journalLabel = useMemo(() => {
    const m = new Map<string, string>();
    journals?.forEach((j) => m.set(j.id, j.label));
    return m;
  }, [journals]);

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
        ...journalFilterToSearch(journalFilter),
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

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-medium text-foreground/50">Entries</h2>

      <SearchBar
        query={query}
        from={from}
        to={to}
        journal={journalFilter}
        journals={journals}
        hasUnfiled={unfiledCount > 0}
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

      {entries && entries.length === 0 && !error && (
        <p className="text-sm text-foreground/40">
          {isSearching ? "No entries match." : "No entries yet — record one above."}
        </p>
      )}

      <ul className="flex flex-col gap-3">
        {entries?.map((e) => (
          <EntryCard
            key={e.id}
            entry={e}
            journalLabel={
              e.journalId ? (journalLabel.get(e.journalId) ?? "journal") : null
            }
            journals={journals}
            onTrashed={(id) =>
              setEntries((prev) => prev?.filter((x) => x.id !== id) ?? prev)
            }
            onMoved={(id, journalId) =>
              setEntries((prev) => {
                if (!prev) return prev;
                // A journal filter (real or Unfiled) that no longer matches
                // the moved-to journal drops the row, same as onTrashed;
                // otherwise just refresh its journalId (chip updates too).
                if (journalFilter) {
                  const stillMatches =
                    journalFilter === UNFILED_FILTER
                      ? journalId === null
                      : journalId === journalFilter;
                  if (!stillMatches) return prev.filter((x) => x.id !== id);
                }
                return prev.map((x) => (x.id === id ? { ...x, journalId } : x));
              })
            }
          />
        ))}
      </ul>
    </section>
  );
}
