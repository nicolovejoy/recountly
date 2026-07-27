import { describe, it, expect } from "vitest";
import { formatEntryDateRange, resolveJournalDateRange } from "./date-range";

// Library card date line: month+year span of a journal's entries.
describe("formatEntryDateRange", () => {
  it("is null when there are no entries (firstAt null)", () => {
    expect(formatEntryDateRange(null, null)).toBeNull();
  });

  it("collapses to a single month when both dates fall in it", () => {
    expect(formatEntryDateRange("1994-03-01T12:00:00Z", "1994-03-28T12:00:00Z")).toBe(
      "Mar 1994",
    );
  });

  it("spans months within a year", () => {
    expect(formatEntryDateRange("1994-03-01T12:00:00Z", "1994-06-15T12:00:00Z")).toBe(
      "Mar 1994 – Jun 1994",
    );
  });

  it("spans same month across different years", () => {
    expect(formatEntryDateRange("1994-03-01T12:00:00Z", "1995-03-15T12:00:00Z")).toBe(
      "Mar 1994 – Mar 1995",
    );
  });

  it("spans years", () => {
    expect(formatEntryDateRange("1994-03-01T12:00:00Z", "1995-06-15T12:00:00Z")).toBe(
      "Mar 1994 – Jun 1995",
    );
  });

  it("falls back to a single date when lastAt is missing", () => {
    expect(formatEntryDateRange("1994-03-01T12:00:00Z", null)).toBe("Mar 1994");
  });
});

describe("resolveJournalDateRange", () => {
  it("prefers the stored range when both startedOn and endedOn are set", () => {
    expect(
      resolveJournalDateRange(
        "1994-03-01",
        "1994-06-01",
        "2026-01-01T00:00:00Z",
        "2026-02-01T00:00:00Z",
      ),
    ).toBe("Mar 1994 – Jun 1994");
  });

  it("uses the stored range even when it disagrees with the computed range", () => {
    // Owner-set range wins outright — no merging with entry dates.
    expect(
      resolveJournalDateRange("1970-01-01", "1970-12-01", "2026-01-01T00:00:00Z", null),
    ).toBe("Jan 1970 – Dec 1970");
  });

  it("shows a single date when only startedOn is set", () => {
    expect(resolveJournalDateRange("1994-03-01", null, null, null)).toBe("Mar 1994");
  });

  it("shows a single date when only endedOn is set", () => {
    expect(resolveJournalDateRange(null, "1994-06-01", null, null)).toBe("Jun 1994");
  });

  it("falls back to the computed range when neither startedOn nor endedOn is set", () => {
    expect(
      resolveJournalDateRange(null, null, "1994-03-01T12:00:00Z", "1994-06-15T12:00:00Z"),
    ).toBe("Mar 1994 – Jun 1994");
  });

  it("falls back to null when neither the stored nor computed range has data", () => {
    expect(resolveJournalDateRange(null, null, null, null)).toBeNull();
  });
});
