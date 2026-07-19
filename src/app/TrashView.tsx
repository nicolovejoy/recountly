"use client";

// Trash view (issue #27), routed at /library/trash (issue #29). Fetches
// GET /api/entries/trash and renders trashed entries (title/summary/date +
// trashed date — no photo/audio expansion in v1) with per-card Restore /
// Delete forever plus a header-level Empty trash. Restore just removes the
// row here — Library/Search refetch on mount when next visited.

import { useEffect, useState } from "react";
import Link from "next/link";
import { formatElapsed } from "@/lib/elapsed";
import type { EntryRecord } from "@/lib/entry";

function formatWhen(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

function entryName(e: EntryRecord): string {
  return e.title ?? formatWhen(e.recordedAt);
}

export default function TrashView() {
  const [entries, setEntries] = useState<EntryRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<{ id: string; kind: "restore" | "purge" } | null>(null);
  const [emptying, setEmptying] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let alive = true;
    fetch("/api/entries/trash")
      .then(async (res) => {
        if (!res.ok) throw new Error(`trash route ${res.status}`);
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

  async function handleRestore(id: string) {
    setBusy({ id, kind: "restore" });
    setActionError(null);
    try {
      const res = await fetch(`/api/entries/${id}/restore`, { method: "POST" });
      if (!res.ok) throw new Error(`restore route ${res.status}`);
      setEntries((prev) => prev?.filter((e) => e.id !== id) ?? prev);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function handlePurge(entry: EntryRecord) {
    if (!window.confirm(`Delete “${entryName(entry)}” forever? This can’t be undone.`)) {
      return;
    }
    setBusy({ id: entry.id, kind: "purge" });
    setActionError(null);
    try {
      const res = await fetch(`/api/entries/${entry.id}/purge`, { method: "DELETE" });
      if (!res.ok) throw new Error(`purge route ${res.status}`);
      setEntries((prev) => prev?.filter((e) => e.id !== entry.id) ?? prev);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function handleEmptyTrash() {
    const n = entries?.length ?? 0;
    if (
      !window.confirm(
        `Permanently delete ${n} trashed ${n === 1 ? "entry" : "entries"}? This can’t be undone.`,
      )
    ) {
      return;
    }
    setEmptying(true);
    setActionError(null);
    try {
      const res = await fetch("/api/entries/trash", { method: "DELETE" });
      if (!res.ok) throw new Error(`empty-trash route ${res.status}`);
      const { purged } = (await res.json()) as { purged: number };
      if (purged >= n) {
        setEntries([]);
      } else {
        // emptyTrash swallows a mid-loop failure, so `purged` can be partial —
        // refetch instead of clearing so leftovers stay visible.
        setReloadKey((k) => k + 1);
      }
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setEmptying(false);
    }
  }

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-medium text-foreground/50">Trash</h2>
        <span className="flex items-baseline gap-3">
          {(entries?.length ?? 0) > 0 && (
            <button
              type="button"
              onClick={handleEmptyTrash}
              disabled={emptying}
              className="text-xs text-foreground/40 hover:text-red-500 disabled:opacity-50"
            >
              {emptying ? "Emptying…" : "Empty trash"}
            </button>
          )}
          <Link
            href="/library"
            className="text-xs text-foreground/40 hover:text-foreground/70"
          >
            ← Library
          </Link>
        </span>
      </div>

      {error && <p className="text-sm text-red-500">Couldn’t load trash: {error}</p>}

      {actionError && <p className="text-sm text-red-500">Couldn’t update trash: {actionError}</p>}

      {entries && entries.length === 0 && !error && (
        <p className="text-sm text-foreground/40">Trash is empty.</p>
      )}

      <ul className="flex flex-col gap-3">
        {entries?.map((e) => {
          const isBusy = busy?.id === e.id;
          return (
            <li
              key={e.id}
              className="flex flex-col gap-2 rounded-xl border border-foreground/10 p-4"
            >
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-sm font-medium text-foreground/90">{entryName(e)}</span>
                <span className="flex shrink-0 items-baseline gap-2">
                  <span className="text-xs tabular-nums text-foreground/50">
                    {formatElapsed(e.durationSeconds)}
                  </span>
                  <button
                    type="button"
                    onClick={() => handleRestore(e.id)}
                    disabled={isBusy || emptying}
                    className="text-xs text-foreground/40 hover:text-foreground/70 disabled:opacity-50"
                  >
                    {isBusy && busy?.kind === "restore" ? "Restoring…" : "Restore"}
                  </button>
                  <button
                    type="button"
                    onClick={() => handlePurge(e)}
                    disabled={isBusy || emptying}
                    className="text-xs text-foreground/40 hover:text-red-500 disabled:opacity-50"
                  >
                    {isBusy && busy?.kind === "purge" ? "Deleting…" : "Delete forever"}
                  </button>
                </span>
              </div>
              {e.title && (
                <span className="text-xs text-foreground/40">{formatWhen(e.recordedAt)}</span>
              )}
              {e.summary && <p className="text-sm italic text-foreground/60">{e.summary}</p>}
              {e.deletedAt && (
                <p className="text-xs text-foreground/40">trashed {formatWhen(e.deletedAt)}</p>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
