"use client";

// Newest-first list of saved entries (Phase 2). Fetches GET /api/entries on
// mount and whenever reloadKey changes (RecorderClient bumps it after a save).
// Presentational only — the API already returns entries ordered recorded_at
// DESC, so this just renders them.

import { useEffect, useState } from "react";
import { formatElapsed } from "@/lib/elapsed";
import type { EntryRecord } from "@/lib/entry";

function formatWhen(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

export default function EntryList({ reloadKey }: { reloadKey: number }) {
  const [entries, setEntries] = useState<EntryRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/entries")
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
  }, [reloadKey]);

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-medium text-foreground/50">Entries</h2>

      {error && (
        <p className="text-sm text-red-500">Couldn’t load entries: {error}</p>
      )}

      {entries && entries.length === 0 && !error && (
        <p className="text-sm text-foreground/40">No entries yet — record one above.</p>
      )}

      <ul className="flex flex-col gap-3">
        {entries?.map((e) => (
          <li
            key={e.id}
            className="flex flex-col gap-2 rounded-xl border border-foreground/10 p-4"
          >
            <div className="flex items-center justify-between text-xs text-foreground/50">
              <span>{e.title ?? formatWhen(e.recordedAt)}</span>
              <span className="tabular-nums">{formatElapsed(e.durationSeconds)}</span>
            </div>
            <p className="line-clamp-3 whitespace-pre-wrap text-sm leading-relaxed text-foreground/80">
              {e.transcript}
            </p>
            {e.audioUrl && (
              <audio controls preload="none" src={e.audioUrl} className="mt-1 w-full">
                <track kind="captions" />
              </audio>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
