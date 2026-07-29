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
//
// Manage panel (PR A, 2026-07-27): rename/edit dates+kind and delete. The
// summaries fetch already carries notes/startedOn/endedOn/kind (journal.ts),
// so opening the panel needs no extra request — it just seeds the form from
// `summary`. Delete is blocked unless the journal is empty; the client-side
// disable uses the LIVE entry count (all the UI can see), but the real guard
// is the route's 409 with total/trashed counts, surfaced verbatim on failure.

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { EntryRecord } from "@/lib/entry";
import type { JournalSummary, JournalUpdate } from "@/lib/journal";
import { buildSearchQueryString } from "@/lib/search";
import { resolveJournalDateRange } from "@/lib/date-range";
import { useConfirm } from "./ConfirmDialog";
import EntryCard from "./EntryCard";
import SelectionBar, { UNFILED_VALUE } from "./SelectionBar";
import SelectModeToggle from "./SelectModeToggle";
import { useBulkSelection } from "./useBulkSelection";
import { useEscUp } from "./useEscUp";
import { useJournals } from "./useJournals";

type SortOption = "newest" | "reading";

interface ManageForm {
  label: string;
  notes: string;
  kind: "" | "archive";
  startedOn: string;
  endedOn: string;
}

function toManageForm(s: JournalSummary): ManageForm {
  return {
    label: s.label,
    notes: s.notes ?? "",
    kind: s.kind === "archive" ? "archive" : "",
    startedOn: s.startedOn ?? "",
    endedOn: s.endedOn ?? "",
  };
}

export default function JournalView({ journalId }: { journalId: string }) {
  // undefined = loading; null = no such journal.
  const [summary, setSummary] = useState<JournalSummary | null | undefined>(undefined);
  const [entries, setEntries] = useState<EntryRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sort, setSort] = useState<SortOption>("newest");
  const router = useRouter();
  const confirm = useConfirm();
  const { journals, update, remove } = useJournals(); // options for each card's Move picker

  const bulk = useBulkSelection();

  const [managing, setManaging] = useState(false);
  const [form, setForm] = useState<ManageForm | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  // Generation counter (same idiom as useJournals) so a manual reload()
  // triggered by a bulk action can't be clobbered by a stale in-flight
  // response from the sort-change effect landing after it, or vice versa.
  const genRef = useRef(0);

  // History navigation can land on another journal without unmounting this
  // component — an open manage panel would carry the previous journal's form.
  const [panelJournalId, setPanelJournalId] = useState(journalId);
  if (panelJournalId !== journalId) {
    setPanelJournalId(journalId);
    setManaging(false);
    setForm(null);
    setSaveError(null);
    setDeleteError(null);
  }

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
    if (
      !(await confirm({
        title: `Trash ${n} ${n === 1 ? "entry" : "entries"}?`,
        message: "They move to Trash and can be restored later.",
        confirmLabel: "Trash",
        tone: "danger",
      }))
    )
      return;
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

  function toggleManage() {
    if (managing) {
      setManaging(false);
      setForm(null);
      return;
    }
    if (!summary) return;
    setManaging(true);
    setForm(toManageForm(summary));
    setSaveError(null);
    setDeleteError(null);
  }

  async function handleSave() {
    if (!form) return;
    setSaving(true);
    setSaveError(null);
    const patch: JournalUpdate = {
      label: form.label,
      notes: form.notes.trim() === "" ? null : form.notes,
      kind: form.kind === "archive" ? "archive" : null,
      startedOn: form.startedOn === "" ? null : form.startedOn,
      endedOn: form.endedOn === "" ? null : form.endedOn,
    };
    const updated = await update(journalId, patch);
    setSaving(false);
    if (!updated) {
      setSaveError("Save failed");
      return;
    }
    setManaging(false);
    setForm(null);
    // Merge the fields update() can change into the local summary snapshot —
    // updated (a JournalRecord) has no entryCount/firstEntryAt/lastEntryAt,
    // so this only overwrites label/notes/kind/startedOn/endedOn/active.
    setSummary((prev) => (prev ? { ...prev, ...updated } : prev));
  }

  async function handleDelete() {
    if (!summary) return;
    if (
      !(await confirm({
        title: `Delete “${summary.label}”?`,
        message:
          "This can’t be undone. (Blocked while any entries — live or trashed — still reference it.)",
        confirmLabel: "Delete",
        tone: "danger",
      }))
    ) {
      return;
    }
    setDeleting(true);
    setDeleteError(null);
    const result = await remove(journalId);
    setDeleting(false);
    if (!result.ok) {
      setDeleteError(result.error ?? "Delete failed");
      return;
    }
    router.push("/library");
  }

  const range = summary
    ? resolveJournalDateRange(summary.startedOn, summary.endedOn, summary.firstEntryAt, summary.lastEntryAt)
    : null;
  // Live count: the summaries snapshot goes stale when onTrashed removes a row
  // locally, so prefer the loaded entries list; fall back while still loading.
  const entryCount = entries ? entries.length : summary?.entryCount;
  const allSelected = (entries?.length ?? 0) > 0 && bulk.selected.size === entries?.length;
  // Moving to the current journal is a no-op — exclude it from the target list.
  const moveTargets = journals?.filter((j) => j.id !== journalId) ?? null;

  // Esc: close the manage panel first, then leave select mode, then up to
  // the Library.
  useEscUp(() => {
    if (managing) {
      toggleManage();
      return;
    }
    if (bulk.selectMode) {
      bulk.exitSelectMode();
      return;
    }
    router.push("/library");
  });

  return (
    <section className="flex flex-col gap-3">
      <Link href="/library" className="text-xs text-muted hover:text-body">
        ← Library
      </Link>

      {error && <p className="text-sm text-red-500">Couldn’t load journal: {error}</p>}

      {summary === null && !error && (
        <p className="text-sm text-muted">No such journal.</p>
      )}

      {summary && (
        <div className="flex flex-col gap-1">
          <div className="flex items-start justify-between gap-3">
            <h2 className="text-sm font-medium text-foreground">{summary.label}</h2>
            <div className="flex shrink-0 items-center gap-3">
              {!bulk.selectMode && (
                <button
                  type="button"
                  onClick={toggleManage}
                  aria-label={managing ? "Close journal settings" : "Manage journal"}
                  className="text-xs text-muted hover:text-body"
                >
                  {managing ? "✕" : "✏️"}
                </button>
              )}
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
          </div>
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs text-body">
              {entryCount} {entryCount === 1 ? "entry" : "entries"}
              {range && ` · ${range}`}
            </p>
            <label className="flex items-center gap-1 text-xs text-body">
              <span>Sort</span>
              <select
                value={sort}
                onChange={(e) => setSort(e.target.value as SortOption)}
                aria-label="Sort entries"
                className="rounded-lg border border-hairline bg-transparent px-2 py-1 text-xs outline-none focus:border-hairline-strong focus-visible:ring-1 focus-visible:ring-accent"
              >
                <option value="newest">Newest first</option>
                <option value="reading">Oldest first</option>
              </select>
            </label>
          </div>
        </div>
      )}

      {managing && form && (
        <div className="flex flex-col gap-2 rounded-xl border border-hairline-strong bg-surface-raised p-3">
          <label className="flex flex-col gap-1 text-xs text-body">
            <span>Label</span>
            <input
              type="text"
              value={form.label}
              onChange={(e) => setForm({ ...form, label: e.target.value })}
              className="rounded-lg border border-hairline bg-transparent px-2 py-1 text-sm text-foreground outline-none focus:border-hairline-strong focus-visible:ring-1 focus-visible:ring-accent"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-body">
            <span>Kind</span>
            <select
              value={form.kind}
              onChange={(e) => setForm({ ...form, kind: e.target.value as "" | "archive" })}
              className="rounded-lg border border-hairline bg-transparent px-2 py-1 text-sm text-foreground outline-none focus:border-hairline-strong focus-visible:ring-1 focus-visible:ring-accent"
            >
              <option value="">—</option>
              <option value="archive">Archive</option>
            </select>
          </label>
          <div className="flex gap-2">
            <label className="flex flex-1 flex-col gap-1 text-xs text-body">
              <span>Started</span>
              <input
                type="date"
                value={form.startedOn}
                onChange={(e) => setForm({ ...form, startedOn: e.target.value })}
                className="rounded-lg border border-hairline bg-transparent px-2 py-1 text-sm text-foreground outline-none focus:border-hairline-strong focus-visible:ring-1 focus-visible:ring-accent"
              />
            </label>
            <label className="flex flex-1 flex-col gap-1 text-xs text-body">
              <span>Ended</span>
              <input
                type="date"
                value={form.endedOn}
                onChange={(e) => setForm({ ...form, endedOn: e.target.value })}
                className="rounded-lg border border-hairline bg-transparent px-2 py-1 text-sm text-foreground outline-none focus:border-hairline-strong focus-visible:ring-1 focus-visible:ring-accent"
              />
            </label>
          </div>
          <label className="flex flex-col gap-1 text-xs text-body">
            <span>Notes</span>
            <textarea
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              rows={2}
              className="rounded-lg border border-hairline bg-transparent px-2 py-1 text-sm text-foreground outline-none focus:border-hairline-strong focus-visible:ring-1 focus-visible:ring-accent"
            />
          </label>
          {saveError && <p className="text-sm text-red-500">Couldn’t save: {saveError}</p>}

          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleSave}
                disabled={saving}
                className="rounded-lg bg-accent-strong px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
              >
                {saving ? "Saving…" : "Save"}
              </button>
              <button
                type="button"
                onClick={toggleManage}
                disabled={saving}
                className="text-xs text-muted hover:text-body disabled:opacity-50"
              >
                Cancel
              </button>
            </div>
            <button
              type="button"
              onClick={handleDelete}
              disabled={deleting || (entryCount ?? 0) > 0}
              className="text-xs text-muted hover:text-danger disabled:opacity-50"
            >
              {deleting ? "Deleting…" : "Delete journal"}
            </button>
          </div>
          {(entryCount ?? 0) > 0 && (
            <p className="text-xs text-muted">
              {entryCount} {entryCount === 1 ? "entry" : "entries"} — empty this journal first.
            </p>
          )}
          {deleteError && <p className="text-sm text-red-500">{deleteError}</p>}
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
        <p className="text-sm text-muted">No entries in this journal yet.</p>
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
                  selectMode={bulk.selectMode}
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
