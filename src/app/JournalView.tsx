"use client";

// One journal's entries in reading order (issue #29). Two fetches on mount:
// GET /api/journals/summaries for the header (label, count, date range — and
// the 404 copy when the id is unknown) and GET /api/entries?journal=<id>&
// sort=reading&limit=200 for the rows, rendered in API order (reading order —
// no client re-sort). journalLabel is null on the cards: the chip is redundant
// inside the journal's own view. Page labels are a later capture-polish task.

import { useEffect, useState } from "react";
import Link from "next/link";
import type { EntryRecord } from "@/lib/entry";
import type { JournalSummary } from "@/lib/journal";
import { buildSearchQueryString } from "@/lib/search";
import { formatEntryDateRange } from "@/lib/date-range";
import EntryCard from "./EntryCard";

export default function JournalView({ journalId }: { journalId: string }) {
  // undefined = loading; null = no such journal.
  const [summary, setSummary] = useState<JournalSummary | null | undefined>(undefined);
  const [entries, setEntries] = useState<EntryRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const queryString = buildSearchQueryString({ journalId, sort: "reading", limit: 200 });
    Promise.all([
      fetch("/api/journals/summaries").then(async (res) => {
        if (!res.ok) throw new Error(`summaries route ${res.status}`);
        return (await res.json()) as { journals: JournalSummary[] };
      }),
      fetch(`/api/entries${queryString}`).then(async (res) => {
        if (!res.ok) throw new Error(`list route ${res.status}`);
        return (await res.json()) as { entries: EntryRecord[] };
      }),
    ])
      .then(([summaries, list]) => {
        if (!alive) return;
        setSummary(summaries.journals.find((j) => j.id === journalId) ?? null);
        setEntries(list.entries);
        setError(null);
      })
      .catch((err) => {
        if (alive) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      alive = false;
    };
  }, [journalId]);

  const range = summary ? formatEntryDateRange(summary.firstEntryAt, summary.lastEntryAt) : null;
  // Live count: the summaries snapshot goes stale when onTrashed removes a row
  // locally, so prefer the loaded entries list; fall back while still loading.
  const entryCount = entries ? entries.length : summary?.entryCount;

  return (
    <section className="flex flex-col gap-3">
      <Link href="/library" className="text-xs text-foreground/40 hover:text-foreground/70">
        ← Library
      </Link>

      {error && <p className="text-sm text-red-500">Couldn’t load journal: {error}</p>}

      {summary === null && !error && (
        <p className="text-sm text-foreground/40">No such journal.</p>
      )}

      {summary && (
        <div className="flex flex-col gap-1">
          <h2 className="text-sm font-medium text-foreground/90">{summary.label}</h2>
          <p className="text-xs text-foreground/50">
            {entryCount} {entryCount === 1 ? "entry" : "entries"}
            {range && ` · ${range}`}
          </p>
        </div>
      )}

      {summary && entries && entries.length === 0 && (
        <p className="text-sm text-foreground/40">No entries in this journal yet.</p>
      )}

      {summary && (
        <ul className="flex flex-col gap-3">
          {entries?.map((e) => (
            <EntryCard
              key={e.id}
              entry={e}
              journalLabel={null}
              onTrashed={(id) =>
                setEntries((prev) => prev?.filter((x) => x.id !== id) ?? prev)
              }
            />
          ))}
        </ul>
      )}
    </section>
  );
}
