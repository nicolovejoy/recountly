"use client";

// Entries not filed under any journal (issue #29). Newest-first — these are
// spoken entries, not a paper journal, so no sort=reading. limit=200 matches
// the journal view so the list isn't truncated at the default 50.

import { useEffect, useState } from "react";
import Link from "next/link";
import type { EntryRecord } from "@/lib/entry";
import { buildSearchQueryString } from "@/lib/search";
import EntryCard from "./EntryCard";

export default function UnfiledView() {
  const [entries, setEntries] = useState<EntryRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const queryString = buildSearchQueryString({ unfiled: true, limit: 200 });
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
  }, []);

  return (
    <section className="flex flex-col gap-3">
      <Link href="/library" className="text-xs text-foreground/40 hover:text-foreground/70">
        ← Library
      </Link>

      <div className="flex flex-col gap-1">
        <h2 className="text-sm font-medium text-foreground/90">Unfiled</h2>
        {entries && (
          <p className="text-xs text-foreground/50">
            {entries.length} {entries.length === 1 ? "entry" : "entries"}
          </p>
        )}
      </div>

      {error && <p className="text-sm text-red-500">Couldn’t load entries: {error}</p>}

      {entries && entries.length === 0 && !error && (
        <p className="text-sm text-foreground/40">No unfiled entries.</p>
      )}

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
    </section>
  );
}
