// Tiny pure helper for checkbox-list selection state (bulk-file, issue #28).
// Immutable so it drops straight into useState's updater form.
export function toggleSelected(selected: Set<string>, id: string): Set<string> {
  const next = new Set(selected);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}
