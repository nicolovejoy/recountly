"use client";

// Entries not filed under any journal (issue #29). Newest-first — these are
// spoken entries, not a paper journal, so no sort=reading. limit=200 matches
// the journal view so the list isn't truncated at the default 50.
//
// Select mode (issue #28 bulk-file, extended to bulk trash + select-all for
// issue #40): a "Select" toggle adds a checkbox per row; SelectionBar then
// PATCHes (move) or DELETEs (trash) each selected id sequentially via
// useBulkSelection (no new bulk endpoint — small N) and reloads. Bulk trash
// asks ONE confirm for the whole batch, not one per entry.

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { EntryRecord } from "@/lib/entry";
import { buildSearchQueryString } from "@/lib/search";
import EntryCard from "./EntryCard";
import SelectionBar, { UNFILED_VALUE } from "./SelectionBar";
import SelectModeToggle from "./SelectModeToggle";
import { useBulkSelection } from "./useBulkSelection";
import { useJournals } from "./useJournals";

export default function UnfiledView() {
  const [entries, setEntries] = useState<EntryRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { journals } = useJournals();

  const bulk = useBulkSelection();

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

  async function handleBulkMove() {
    if (!bulk.bulkTarget || bulk.selected.size === 0) return;
    const journalId = bulk.bulkTarget === UNFILED_VALUE ? null : bulk.bulkTarget;
    await bulk.runBatch("move", async (id) => {
      try {
        const res = await fetch(`/api/entries/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ journalId }),
        });
        return res.ok;
      } catch {
        return false;
      }
    });
    reload();
  }

  async function handleBulkTrash() {
    if (bulk.selected.size === 0) return;
    const n = bulk.selected.size;
    if (!window.confirm(`Trash ${n} ${n === 1 ? "entry" : "entries"}?`)) return;
    await bulk.runBatch("trash", async (id) => {
      try {
        const res = await fetch(`/api/entries/${id}`, { method: "DELETE" });
        return res.ok;
      } catch {
        return false;
      }
    });
    reload();
  }

  const allSelected = (entries?.length ?? 0) > 0 && bulk.selected.size === entries?.length;

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
          <SelectModeToggle
            selectMode={bulk.selectMode}
            allSelected={allSelected}
            busy={bulk.busy}
            onEnter={bulk.enterSelectMode}
            onExit={bulk.exitSelectMode}
            onSelectAll={() => bulk.selectAllIds(entries.map((e) => e.id))}
            onClear={bulk.clearSelection}
          />
        )}
      </div>

      {bulk.selectMode && (
        <SelectionBar
          count={bulk.selected.size}
          journals={journals}
          includeUnfiledOption={false}
          bulkTarget={bulk.bulkTarget}
          onBulkTargetChange={bulk.setBulkTarget}
          busy={bulk.busy}
          onMove={handleBulkMove}
          onTrash={handleBulkTrash}
          error={bulk.error}
        />
      )}

      {error && <p className="text-sm text-red-500">Couldn’t load entries: {error}</p>}

      {entries && entries.length === 0 && !error && (
        <p className="text-sm text-foreground/40">No unfiled entries.</p>
      )}

      <div className="flex flex-col gap-3">
        {entries?.map((e) => (
          <div key={e.id} className="flex items-start gap-2">
            {bulk.selectMode && (
              <input
                type="checkbox"
                checked={bulk.selected.has(e.id)}
                onChange={() => bulk.toggle(e.id)}
                disabled={bulk.busy}
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
