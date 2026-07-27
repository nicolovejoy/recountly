"use client";

// Imperative journal state (physical-journal archive): fetches the journal
// list, exposes the active journal (the capture lock), and wraps create +
// activate. The lock lives in the DB — PUT /api/journals/active — so it
// survives reloads and device switches. Same layering as useRecorder: this
// hook owns the fetches; components stay presentational.

import { useCallback, useEffect, useRef, useState } from "react";
import type { JournalRecord, JournalUpdate } from "@/lib/journal";

// DELETE /api/journals/[id]'s 409 body (PR A): delete is blocked unless the
// journal is empty (live + trashed entries both count against it).
export interface JournalDeleteResult {
  ok: boolean;
  error?: string;
  entryCount?: number;
  trashedCount?: number;
}

export function useJournals() {
  const [journals, setJournals] = useState<JournalRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Generation counter (same spirit as EntryList's `alive` flag): create()
  // triggers a reload, then the caller PUTs /active which triggers another —
  // if the first response lands last it must not clobber the second's result.
  const genRef = useRef(0);

  const reload = useCallback(() => {
    const gen = ++genRef.current;
    fetch("/api/journals")
      .then(async (res) => {
        if (!res.ok) throw new Error(`journals route ${res.status}`);
        return (await res.json()) as { journals: JournalRecord[] };
      })
      .then((data) => {
        if (gen !== genRef.current) return;
        setJournals(data.journals);
        setError(null);
      })
      .catch((err) => {
        if (gen !== genRef.current) return;
        setError(err instanceof Error ? err.message : String(err));
      });
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const create = useCallback(
    async (label: string): Promise<JournalRecord | null> => {
      try {
        const res = await fetch("/api/journals", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ label }),
        });
        if (!res.ok) throw new Error(`create failed (${res.status})`);
        const { journal } = (await res.json()) as { journal: JournalRecord };
        reload();
        return journal;
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        return null;
      }
    },
    [reload],
  );

  const setActive = useCallback(
    async (id: string | null): Promise<void> => {
      try {
        const res = await fetch("/api/journals/active", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id }),
        });
        if (!res.ok) throw new Error(`activate failed (${res.status})`);
        reload();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [reload],
  );

  // Journal management (PR A): rename/edit + delete. Both refresh the list on
  // success (same idiom as create/setActive) so the Move picker's target list
  // and other consumers of this hook pick up the change immediately.
  const update = useCallback(
    async (id: string, patch: JournalUpdate): Promise<JournalRecord | null> => {
      try {
        const res = await fetch(`/api/journals/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        });
        if (!res.ok) throw new Error(`update failed (${res.status})`);
        const { journal } = (await res.json()) as { journal: JournalRecord };
        reload();
        return journal;
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        return null;
      }
    },
    [reload],
  );

  const remove = useCallback(
    async (id: string): Promise<JournalDeleteResult> => {
      try {
        const res = await fetch(`/api/journals/${id}`, { method: "DELETE" });
        const body = await res.json().catch(() => ({}) as Record<string, unknown>);
        if (!res.ok) {
          return {
            ok: false,
            error: typeof body.error === "string" ? body.error : `delete failed (${res.status})`,
            entryCount: typeof body.entryCount === "number" ? body.entryCount : undefined,
            trashedCount: typeof body.trashedCount === "number" ? body.trashedCount : undefined,
          };
        }
        reload();
        return { ok: true };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
    [reload],
  );

  const active = journals?.find((j) => j.active) ?? null;
  return { journals, active, error, create, setActive, update, remove };
}
