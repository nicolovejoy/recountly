// Library card date line (issue #29): the month+year span of a journal's
// entries, from the summary aggregates (min/max effective date). Default
// locale, same as the card dates rendered elsewhere; pure so it's
// unit-testable. Same-month collapse works by comparing the formatted
// strings — equal month+year text means one date is enough.

import { writtenAtIso } from "./written-at";

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

// Journal management (PR A): an owner-set date range (startedOn/endedOn —
// YYYY-MM-DD, from journals.started_on/ended_on) overrides the computed-
// from-entries range as soon as either is set; the computed range
// (firstEntryAt/lastEntryAt) is the fallback when neither is set. Whichever
// pair wins, reuses formatEntryDateRange's month+year formatting/collapse —
// a single stored date (only startedOn or only endedOn) is shown as one date.
// startedOn/endedOn are bare YYYY-MM-DD (no time/zone) — anchored at local
// noon via writtenAtIso (same idiom as written-at.ts) before formatting, so
// the displayed month/year can't shift a day off UTC-midnight parsing in a
// timezone west of UTC.
export function resolveJournalDateRange(
  startedOn: string | null,
  endedOn: string | null,
  firstEntryAt: string | null,
  lastEntryAt: string | null,
): string | null {
  if (startedOn != null || endedOn != null) {
    const start = startedOn != null ? (writtenAtIso(startedOn) ?? null) : null;
    const end = endedOn != null ? (writtenAtIso(endedOn) ?? null) : null;
    return formatEntryDateRange(start ?? end, end ?? start);
  }
  return formatEntryDateRange(firstEntryAt, lastEntryAt);
}
