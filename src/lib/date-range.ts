// Library card date line (issue #29): the month+year span of a journal's
// entries, from the summary aggregates (min/max effective date). Default
// locale, same as the card dates rendered elsewhere; pure so it's
// unit-testable. Same-month collapse works by comparing the formatted
// strings — equal month+year text means one date is enough.

export function formatEntryDateRange(
  firstAt: string | null,
  lastAt: string | null,
): string | null {
  if (firstAt == null) return null;
  const fmt = (iso: string) =>
    new Date(iso).toLocaleDateString(undefined, { month: "short", year: "numeric" });
  const first = fmt(firstAt);
  const last = lastAt == null ? first : fmt(lastAt);
  return first === last ? first : `${first} – ${last}`;
}
