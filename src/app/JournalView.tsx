"use client";

// One journal's entries (issue #29 + owner-requested sort control). Default order
// is newest-first (recorded_at desc, the API's default — no sort param sent);
// a small select lets the owner switch to oldest-first (sort=reading,
// coalesce(written_at, recorded_at) asc — API value unchanged; the owner found
// "Reading order" unclear, issue #40). The summaries fetch (header: label,
// count, date range — and the 404 copy when the id is unknown) runs once on
// mount; only the entries list re-fetches when the sort changes. journalLabel
// is null on the cards: the chip is redundant inside the journal's own view.
// Page labels are a later capture-polish task.
//
// Select mode (issue #40 — same SelectionBar/useBulkSelection as UnfiledView):
// bulk Move (PATCH, excludes this journal from the target list — a no-op)
// and bulk Trash (DELETE, one confirm for the whole batch).

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { EntryRecord } from "@/lib/entry";
import type { JournalSummary } from "@/lib/journal";
import { buildSearchQueryString } from "@/lib/search";
import { formatEntryDateRange } from "@/lib/date-range";
import EntryCard from "./EntryCard";
import SelectionBar, { UNFILED_VALUE } from "./SelectionBar";
import SelectModeToggle from "./SelectModeToggle";
import { useBulkSelection } from "./useBulkSelection";
import { useJournals } from "./useJournals";

type SortOption = "newest" | "reading";

export default function JournalView({ journalId }: { journalId: string }) {
  // undefined = loading; null = no such journal.
  const [summary, setSummary] = useState<JournalSummary | null | undefined>(undefined);
  const [entries, setEntries] = useState<EntryRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sort, setSort] = useState<SortOption>("newest");
  const { journals } = useJournals(); // options for each card's Move picker

  const bulk = useBulkSelection();
  // Generation counter (same idiom as useJournals) so a manual reload()
  // triggered by a bulk action can't be clobbered by a stale in-flight
  // response from the sort-change effect landing after it, or vice versa.
  const genRef = useRef(0);

  useEffect(() => {
    let alive = true;
    fetch("/api/journals/summaries")
      .then(async (res) => {
        if (!res.ok) throw new Error(`summaries route ${res.status}`);
        return (await res.json()) as { journals: JournalSummary[] };
      })
      .then((summaries) => {
        if (!alive) return;
        setSummary(summaries.journals.find((j) => j.id === journalId) ?? null);
      })
      .catch((err) => {
        if (alive) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      alive = false;
    };
  }, [journalId]);

  const reload = useCallback(() => {
    const gen = ++genRef.current;
    const queryString = buildSearchQueryString({
      journalId,
      sort: sort === "reading" ? "reading" : undefined,
      limit: 200,
    });
    fetch(`/api/entries${queryString}`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`list route ${res.status}`);
        return (await res.json()) as { entries: EntryRecord[] };
      })
      .then((list) => {
        if (gen !== genRef.current) return;
        setEntries(list.entries);
        setError(null);
      })
      .catch((err) => {
        if (gen !== genRef.current) return;
        setError(err instanceof Error ? err.message : String(err));
      });
  }, [journalId, sort]);

  useEffect(() => {
    reload();
  }, [reload]);

  async function handleBulkMove() {
    if (!bulk.bulkTarget || bulk.selected.size === 0) return;
    const targetJournalId = bulk.bulkTarget === UNFILED_VALUE ? null : bulk.bulkTarget;
    await bulk.runBatch("move", async (id) => {
      try {
        const res = await fetch(`/api/entries/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ journalId: targetJournalId }),
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

  const range = summary ? formatEntryDateRange(summary.firstEntryAt, summary.lastEntryAt) : null;
  // Live count: the summaries snapshot goes stale when onTrashed removes a row
  // locally, so prefer the loaded entries list; fall back while still loading.
  const entryCount = entries ? entries.length : summary?.entryCount;
  const allSelected = (entries?.length ?? 0) > 0 && bulk.selected.size === entries?.length;
  // Moving to the current journal is a no-op — exclude it from the target list.
  const moveTargets = journals?.filter((j) => j.id !== journalId) ?? null;

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
          <div className="flex items-start justify-between gap-3">
            <h2 className="text-sm font-medium text-foreground/90">{summary.label}</h2>
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
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs text-foreground/50">
              {entryCount} {entryCount === 1 ? "entry" : "entries"}
              {range && ` · ${range}`}
            </p>
            <label className="flex items-center gap-1 text-xs text-foreground/50">
              <span>Sort</span>
              <select
                value={sort}
                onChange={(e) => setSort(e.target.value as SortOption)}
                aria-label="Sort entries"
                className="rounded-lg border border-foreground/15 bg-transparent px-2 py-1 text-xs outline-none focus:border-foreground/40"
              >
                <option value="newest">Newest first</option>
                <option value="reading">Oldest first</option>
              </select>
            </label>
          </div>
        </div>
      )}

      {bulk.selectMode && (
        <SelectionBar
          count={bulk.selected.size}
          journals={moveTargets}
          includeUnfiledOption={true}
          bulkTarget={bulk.bulkTarget}
          onBulkTargetChange={bulk.setBulkTarget}
          busy={bulk.busy}
          onMove={handleBulkMove}
          onTrash={handleBulkTrash}
          error={bulk.error}
        />
      )}

      {summary && entries && entries.length === 0 && (
        <p className="text-sm text-foreground/40">No entries in this journal yet.</p>
      )}

      {summary && (
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
                    // This view is scoped to one journal — a move anywhere
                    // else (another journal or Unfiled) drops the row.
                    if (newJournalId !== journalId) {
                      setEntries((prev) => prev?.filter((x) => x.id !== id) ?? prev);
                    }
                  }}
                />
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
