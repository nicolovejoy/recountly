import { describe, it, expect } from "vitest";
import {
  parseSearchFilters,
  buildSearchQueryString,
  journalFilterToSearch,
  UNFILED_FILTER,
} from "./search";

describe("parseSearchFilters", () => {
  it("pulls q/from/to out of query params", () => {
    const f = parseSearchFilters(
      new URLSearchParams("q=morning+walk&from=2026-06-01&to=2026-06-13"),
    );
    expect(f).toEqual({ query: "morning walk", from: "2026-06-01", to: "2026-06-13" });
  });

  it("drops blank values (empty box → plain list)", () => {
    const f = parseSearchFilters(new URLSearchParams("q=%20%20&from=&to="));
    expect(f).toEqual({});
  });

  it("returns an empty object when nothing is set", () => {
    expect(parseSearchFilters(new URLSearchParams(""))).toEqual({});
  });
});

describe("buildSearchQueryString", () => {
  it("round-trips with parseSearchFilters", () => {
    const filters = { query: "walk", from: "2026-06-01", to: "2026-06-13" };
    const qs = buildSearchQueryString(filters);
    expect(parseSearchFilters(new URLSearchParams(qs))).toEqual(filters);
  });

  it("omits blank query and yields '' for no filters", () => {
    expect(buildSearchQueryString({})).toBe("");
    expect(buildSearchQueryString({ query: "   " })).toBe("");
  });

  it("url-encodes the query", () => {
    expect(buildSearchQueryString({ query: "a & b" })).toContain("q=a+%26+b");
  });
});

describe("sort / limit / unfiled params (issue #29)", () => {
  it("parses ?sort= accepting only the literal 'reading'", () => {
    expect(parseSearchFilters(new URLSearchParams("sort=reading"))).toEqual({
      sort: "reading",
    });
    expect(parseSearchFilters(new URLSearchParams("sort=newest"))).toEqual({});
    expect(parseSearchFilters(new URLSearchParams("sort=bogus"))).toEqual({});
  });

  it("parses ?limit= as an integer clamped to 1..200, dropping bogus values", () => {
    expect(parseSearchFilters(new URLSearchParams("limit=200"))).toEqual({ limit: 200 });
    expect(parseSearchFilters(new URLSearchParams("limit=500"))).toEqual({ limit: 200 });
    expect(parseSearchFilters(new URLSearchParams("limit=0"))).toEqual({ limit: 1 });
    expect(parseSearchFilters(new URLSearchParams("limit=-5"))).toEqual({ limit: 1 });
    expect(parseSearchFilters(new URLSearchParams("limit=abc"))).toEqual({});
    expect(parseSearchFilters(new URLSearchParams("limit=2.5"))).toEqual({});
    expect(parseSearchFilters(new URLSearchParams("limit="))).toEqual({});
  });

  it("parses ?unfiled= accepting only the literal '1', dropped when journal is present (journalId wins)", () => {
    expect(parseSearchFilters(new URLSearchParams("unfiled=1"))).toEqual({
      unfiled: true,
    });
    expect(parseSearchFilters(new URLSearchParams("unfiled=true"))).toEqual({});
    expect(parseSearchFilters(new URLSearchParams("unfiled=1&journal=01JRNL"))).toEqual({
      journalId: "01JRNL",
    });
  });

  it("round-trips sort + limit + unfiled through buildSearchQueryString", () => {
    const journalView = { journalId: "01JRNL", sort: "reading" as const, limit: 200 };
    expect(
      parseSearchFilters(new URLSearchParams(buildSearchQueryString(journalView))),
    ).toEqual(journalView);
    const unfiledView = { unfiled: true, limit: 200 };
    expect(
      parseSearchFilters(new URLSearchParams(buildSearchQueryString(unfiledView))),
    ).toEqual(unfiledView);
  });

  it("never emits sort=newest (the default) or an unset limit/unfiled", () => {
    expect(buildSearchQueryString({ sort: "newest" })).toBe("");
    expect(buildSearchQueryString({})).toBe("");
  });
});

describe("journal filter param", () => {
  it("parses ?journal= into journalId, dropping blanks", () => {
    expect(parseSearchFilters(new URLSearchParams("journal=01JRNL"))).toEqual({
      journalId: "01JRNL",
    });
    expect(parseSearchFilters(new URLSearchParams("journal=%20%20"))).toEqual({});
  });

  it("round-trips journalId through buildSearchQueryString", () => {
    expect(buildSearchQueryString({ journalId: "01JRNL", query: "cabin" })).toBe(
      "?q=cabin&journal=01JRNL",
    );
  });
});

describe("journalFilterToSearch", () => {
  it("maps empty (all) to no filter", () => {
    expect(journalFilterToSearch("")).toEqual({});
  });

  it("maps the unfiled sentinel to the unfiled filter", () => {
    expect(journalFilterToSearch(UNFILED_FILTER)).toEqual({ unfiled: true });
  });

  it("maps anything else to a journalId", () => {
    expect(journalFilterToSearch("jrn_abc")).toEqual({ journalId: "jrn_abc" });
  });

  it("round-trips through buildSearchQueryString", () => {
    expect(buildSearchQueryString(journalFilterToSearch(UNFILED_FILTER))).toBe("?unfiled=1");
    expect(buildSearchQueryString(journalFilterToSearch("jrn_abc"))).toBe("?journal=jrn_abc");
  });
});
