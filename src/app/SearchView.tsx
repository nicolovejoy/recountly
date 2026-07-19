"use client";

// Search tab (issue #29): the existing entry list + SearchBar, moved off the
// capture page. Trash lives at /library/trash; list views refetch on mount
// when visited, so no reloadKey plumbing from outside is needed.

import { useJournals } from "./useJournals";
import EntryList from "./EntryList";

export default function SearchView() {
  const { journals } = useJournals();

  return <EntryList journals={journals} />;
}
