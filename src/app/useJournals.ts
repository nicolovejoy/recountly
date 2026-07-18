"use client";

// Imperative journal state (physical-journal archive): fetches the journal
// list, exposes the active journal (the capture lock), and wraps create +
// activate. The lock lives in the DB — PUT /api/journals/active — so it
// survives reloads and device switches. Same layering as useRecorder: this
// hook owns the fetches; components stay presentational.

import { useCallback, useEffect, useState } from "react";
import type { JournalRecord } from "@/lib/journal";

export function useJournals() {
  const [journals, setJournals] = useState<JournalRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => {
    fetch("/api/journals")
      .then(async (res) => {
        if (!res.ok) throw new Error(`journals route ${res.status}`);
        return (await res.json()) as { journals: JournalRecord[] };
      })
      .then((data) => {
        setJournals(data.journals);
        setError(null);
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
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

  const active = journals?.find((j) => j.active) ?? null;
  return { journals, active, error, create, setActive };
}
