"use client";

// Search tab (issue #29): the existing entry list + SearchBar, moved off the
// capture page. The showTrash toggle is TEMPORARY — moved verbatim from
// RecorderClient so trash stays reachable this commit; the /library/trash
// route (Task 5) removes it. List views refetch on mount when visited, so no
// reloadKey plumbing from outside is needed.

import { useState } from "react";
import { useJournals } from "./useJournals";
import EntryList from "./EntryList";
import TrashView from "./TrashView";

export default function SearchView() {
  const { journals } = useJournals();
  const [showTrash, setShowTrash] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  return showTrash ? (
    <TrashView
      onBack={() => setShowTrash(false)}
      onRestored={() => setReloadKey((k) => k + 1)}
    />
  ) : (
    <EntryList
      reloadKey={reloadKey}
      journals={journals}
      onShowTrash={() => setShowTrash(true)}
    />
  );
}
