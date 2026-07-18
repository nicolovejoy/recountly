// The written-date input (physical-journal archive) is a plain <input
// type="date"> yielding "YYYY-MM-DD". Anchor it at LOCAL NOON before
// converting to ISO: parsing a bare date string as UTC midnight would shift
// the calendar day for any timezone west of UTC (a 1994-03-02 page saved from
// California would store 1994-03-01T…). Noon keeps the day stable in every
// real timezone. Blank/malformed input → undefined (field omitted from save).

export function writtenAtIso(dateStr: string): string | undefined {
  const trimmed = dateStr.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return undefined;
  const d = new Date(`${trimmed}T12:00:00`);
  if (Number.isNaN(d.getTime())) return undefined;
  // Reject rollovers like 1994-13-40 that Date "helpfully" normalizes.
  const [y, m, day] = trimmed.split("-").map(Number);
  if (d.getFullYear() !== y || d.getMonth() !== m - 1 || d.getDate() !== day) {
    return undefined;
  }
  return d.toISOString();
}
