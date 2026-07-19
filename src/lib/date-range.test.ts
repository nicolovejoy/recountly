import { describe, it, expect } from "vitest";
import { formatEntryDateRange } from "./date-range";

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
