import { describe, it, expect } from "vitest";
import { parseSearchFilters, buildSearchQueryString } from "./search";

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
