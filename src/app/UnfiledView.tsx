"use client";

// Entries not filed under any journal (issue #29). Newest-first — these are
// spoken entries, not a paper journal, so no sort=reading. limit=200 matches
// the journal view so the list isn't truncated at the default 50.
//
// Bulk-file (issue #28, owner request: refile the 26 old imports out of
// Unfiled without tapping Move… 26 times): a "Select" mode adds a checkbox
// per row, a target-journal picker, and "Move N entries", which PATCHes each
// selected id sequentially (no new bulk endpoint — small N) then reloads.

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { EntryRecord } from "@/lib/entry";
import { buildSearchQueryString } from "@/lib/search";
import { toggleSelected } from "@/lib/selection";
import EntryCard from "./EntryCard";
import { useJournals } from "./useJournals";

// Distinct from EntryCard's own picker sentinel — same idea, separate constant
// since this one drives a local <select>, not EntryCard's internals.
const UNFILED_VALUE = "__unfiled__";

export default function UnfiledView() {
  const [entries, setEntries] = useState<EntryRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { journals } = useJournals();

  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkTarget, setBulkTarget] = useState("");
  const [bulkMoving, setBulkMoving] = useState(false);
  const [bulkError, setBulkError] = useState<string | null>(null);

  const reload = useCallback(() => {
    const queryString = buildSearchQueryString({ unfiled: true, limit: 200 });
    fetch(`/api/entries${queryString}`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`list route ${res.status}`);
        return (await res.json()) as { entries: EntryRecord[] };
      })
      .then((data) => {
        setEntries(data.entries);
        setError(null);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : String(err));
      });
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  function exitSelectMode() {
    setSelectMode(false);
    setSelected(new Set());
    setBulkTarget("");
    setBulkError(null);
  }

  async function handleBulkMove() {
    if (!bulkTarget || selected.size === 0) return;
    const journalId = bulkTarget === UNFILED_VALUE ? null : bulkTarget;
    setBulkMoving(true);
    setBulkError(null);
    const failed: string[] = [];
    // Sequential on purpose — 26 entries max today, no new bulk endpoint.
    for (const id of selected) {
      try {
        const res = await fetch(`/api/entries/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ journalId }),
        });
        if (!res.ok) failed.push(id);
      } catch {
        failed.push(id);
      }
    }
    setBulkMoving(false);
    if (failed.length > 0) {
      // Keep only the failures selected — the moved ones are about to drop
      // out of this Unfiled list on reload, and a retry must not re-PATCH
      // entries that already succeeded.
      setBulkError(`${failed.length} of ${selected.size} entries failed to move.`);
      setSelected(new Set(failed));
    } else {
      exitSelectMode();
    }
    reload();
  }

  return (
    <section className="flex flex-col gap-3">
      <Link href="/library" className="text-xs text-foreground/40 hover:text-foreground/70">
        ← Library
      </Link>

      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="text-sm font-medium text-foreground/90">Unfiled</h2>
          {entries && (
            <p className="text-xs text-foreground/50">
              {entries.length} {entries.length === 1 ? "entry" : "entries"}
            </p>
          )}
        </div>
        {entries && entries.length > 0 && (
          <button
            type="button"
            onClick={() => (selectMode ? exitSelectMode() : setSelectMode(true))}
            className="shrink-0 text-xs text-foreground/40 hover:text-foreground/70"
          >
            {selectMode ? "Cancel" : "Select"}
          </button>
        )}
      </div>

      {selectMode && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-foreground/10 p-2 text-xs text-foreground/60">
          <span>
            {selected.size} selected
          </span>
          <select
            value={bulkTarget}
            onChange={(ev) => setBulkTarget(ev.target.value)}
            disabled={bulkMoving}
            aria-label="Move selected entries to journal"
            className="rounded-lg border border-foreground/15 bg-transparent px-2 py-1 text-xs outline-none focus:border-foreground/40"
          >
            <option value="">Choose journal…</option>
            {journals?.map((j) => (
              <option key={j.id} value={j.id}>
                {j.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={handleBulkMove}
            disabled={bulkMoving || !bulkTarget || selected.size === 0}
            className="rounded-lg border border-foreground/15 px-2 py-1 text-foreground/70 hover:border-foreground/40 disabled:opacity-40"
          >
            {bulkMoving ? "Moving…" : `Move ${selected.size} ${selected.size === 1 ? "entry" : "entries"}`}
          </button>
          {bulkError && <span className="text-red-500">{bulkError}</span>}
        </div>
      )}

      {error && <p className="text-sm text-red-500">Couldn’t load entries: {error}</p>}

      {entries && entries.length === 0 && !error && (
        <p className="text-sm text-foreground/40">No unfiled entries.</p>
      )}

      <div className="flex flex-col gap-3">
        {entries?.map((e) => (
          <div key={e.id} className="flex items-start gap-2">
            {selectMode && (
              <input
                type="checkbox"
                checked={selected.has(e.id)}
                onChange={() => setSelected((prev) => toggleSelected(prev, e.id))}
                disabled={bulkMoving}
                aria-label={`Select ${e.title ?? "entry"}`}
                className="mt-4 shrink-0"
              />
            )}
            <ul className="flex-1 flex flex-col">
              <EntryCard
                entry={e}
                journalLabel={null}
                journals={journals}
                onTrashed={(id) =>
                  setEntries((prev) => prev?.filter((x) => x.id !== id) ?? prev)
                }
                onMoved={(id, newJournalId) => {
                  // This view is scoped to Unfiled (journalId null) — a move
                  // to any real journal drops the row.
                  if (newJournalId !== null) {
                    setEntries((prev) => prev?.filter((x) => x.id !== id) ?? prev);
                  }
                }}
              />
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}
