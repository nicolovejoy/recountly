"use client";

// Search tab (issue #29): the existing entry list + SearchBar, moved off the
// capture page. Fetches /api/journals/summaries once — it carries both the
// journal list (for the filter dropdown + chips) and unfiledCount, which
// gates the "Unfiled" filter choice.

import { useEffect, useState } from "react";
import type { JournalSummary } from "@/lib/journal";
import EntryList from "./EntryList";

export default function SearchView() {
  const [journals, setJournals] = useState<JournalSummary[] | null>(null);
  const [unfiledCount, setUnfiledCount] = useState(0);

  useEffect(() => {
    let alive = true;
    fetch("/api/journals/summaries")
      .then(async (res) => {
        if (!res.ok) throw new Error(`summaries route ${res.status}`);
        return (await res.json()) as {
          journals: JournalSummary[];
          unfiledCount: number;
        };
      })
      .then((data) => {
        if (!alive) return;
        setJournals(data.journals);
        setUnfiledCount(data.unfiledCount);
      })
      .catch(() => {
        // The dropdown just stays journal-less; EntryList surfaces list errors.
        if (alive) setJournals([]);
      });
    return () => {
      alive = false;
    };
  }, []);

  return <EntryList journals={journals} unfiledCount={unfiledCount} />;
}
