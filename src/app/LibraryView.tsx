"use client";

// Library tab (issue #29): one card per journal (cover placeholder — Task 6
// fills it — label, live-entry count, date range) plus the Unfiled card.
// Nearly all existing entries are unfiled, so that card links to
// /library/unfiled or Library would be a dead end for them. One fetch of
// GET /api/journals/summaries feeds the whole page; refetches on mount each
// visit. Trash link at the bottom → /library/trash.

import { useEffect, useState } from "react";
import Link from "next/link";
import type { JournalSummary } from "@/lib/journal";
import { formatEntryDateRange } from "@/lib/date-range";

interface Summaries {
  journals: JournalSummary[];
  unfiledCount: number;
}

function entryCountLabel(n: number): string {
  return `${n} ${n === 1 ? "entry" : "entries"}`;
}

// Fixed-size cover slot; Task 6 replaces the placeholder with the cover photo.
function CoverSlot() {
  return <div className="h-16 w-12 shrink-0 rounded-lg bg-foreground/5" />;
}

export default function LibraryView() {
  const [data, setData] = useState<Summaries | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/journals/summaries")
      .then(async (res) => {
        if (!res.ok) throw new Error(`summaries route ${res.status}`);
        return (await res.json()) as Summaries;
      })
      .then((d) => {
        if (!alive) return;
        setData(d);
        setError(null);
      })
      .catch((err) => {
        if (alive) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      alive = false;
    };
  }, []);

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-medium text-foreground/50">Library</h2>

      {error && <p className="text-sm text-red-500">Couldn’t load library: {error}</p>}

      <ul className="flex flex-col gap-3">
        {data?.journals.map((j) => {
          const range = formatEntryDateRange(j.firstEntryAt, j.lastEntryAt);
          return (
            <li key={j.id}>
              <Link
                href={`/library/${j.id}`}
                className="flex items-center gap-3 rounded-xl border border-foreground/10 p-4"
              >
                <CoverSlot />
                <span className="flex flex-col gap-1">
                  <span className="text-sm font-medium text-foreground/90">{j.label}</span>
                  <span className="text-xs text-foreground/50">
                    {entryCountLabel(j.entryCount)}
                  </span>
                  {range && <span className="text-xs text-foreground/40">{range}</span>}
                </span>
              </Link>
            </li>
          );
        })}
        {data && (
          <li>
            <Link
              href="/library/unfiled"
              className="flex items-center gap-3 rounded-xl border border-foreground/10 p-4"
            >
              <CoverSlot />
              <span className="flex flex-col gap-1">
                <span className="text-sm font-medium text-foreground/90">Unfiled</span>
                <span className="text-xs text-foreground/50">
                  {entryCountLabel(data.unfiledCount)}
                </span>
              </span>
            </Link>
          </li>
        )}
      </ul>

      <Link
        href="/library/trash"
        className="self-start text-xs text-foreground/40 hover:text-foreground/70"
      >
        Trash
      </Link>
    </section>
  );
}
