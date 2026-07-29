import { describe, it, expect } from "vitest";
import { buildSearchSnippet, parseQueryTerms } from "./search-snippet";

describe("parseQueryTerms", () => {
  it("keeps a quoted phrase as one multi-word term, drops -negated terms and OR", () => {
    expect(parseQueryTerms('"morning walk" -tea coffee OR "iced coffee"')).toEqual([
      ["morning", "walk"],
      ["coffee"],
      ["iced", "coffee"],
    ]);
  });

  it("drops a negated bare word entirely", () => {
    expect(parseQueryTerms("coffee -tea")).toEqual([["coffee"]]);
  });

  it("returns nothing for an empty or whitespace-only query", () => {
    expect(parseQueryTerms("")).toEqual([]);
    expect(parseQueryTerms("   ")).toEqual([]);
  });
});

describe("buildSearchSnippet — centering + ellipses", () => {
  it("centers the window on the first match and ellipses both trimmed ends", () => {
    const before = "pad ".repeat(60).trim();
    const after = "pad ".repeat(60).trim();
    const text = `${before} lighthouse ${after}`;

    const result = buildSearchSnippet(text, "lighthouse");

    expect(result.segments[0]).toEqual({ text: "…", match: false });
    expect(result.segments[result.segments.length - 1]).toEqual({
      text: "…",
      match: false,
    });
    expect(result.matchCount).toBe(1);
    expect(result.shownIndex).toBe(1);

    const matches = result.segments.filter((s) => s.match);
    expect(matches).toHaveLength(1);
    expect(matches[0].text.toLowerCase()).toBe("lighthouse");

    const shownLen = result.segments.reduce((n, s) => n + s.text.length, 0);
    expect(shownLen).toBeLessThan(text.length);
  });

  it("adds no ellipsis when the match and surrounding text both fit in the window", () => {
    const text = "Lighthouse keeper watched the waves crash quietly against the rocks.";
    const result = buildSearchSnippet(text, "lighthouse");

    expect(result.segments.some((s) => s.text === "…")).toBe(false);
    expect(result.segments[0]).toEqual({ text: "Lighthouse", match: true });
    expect(result.matchCount).toBe(1);
  });
});

describe("buildSearchSnippet — highlighting", () => {
  it("highlights every distinct query term visible in the window", () => {
    const text = "We took a long morning walk through the park before breakfast.";
    const result = buildSearchSnippet(text, "walk park");

    const matches = result.segments.filter((s) => s.match).map((s) => s.text);
    expect(matches).toEqual(["walk", "park"]);
    expect(result.matchCount).toBe(2);
  });

  it("is case-insensitive and preserves the source text's casing when highlighting", () => {
    const text = "I went for a Walk today.";
    const result = buildSearchSnippet(text, "walk");

    const matches = result.segments.filter((s) => s.match);
    expect(matches).toEqual([{ text: "Walk", match: true }]);
    expect(result.matchCount).toBe(1);
  });

  it("does not highlight a negated term even when it's present in the text", () => {
    const text = "I love coffee but not tea in the evening whatsoever.";
    const result = buildSearchSnippet(text, "coffee -tea");

    const matches = result.segments.filter((s) => s.match).map((s) => s.text);
    expect(matches).toEqual(["coffee"]);
    expect(result.matchCount).toBe(1);
  });

  it("counts occurrences and reports (1 of N) data", () => {
    const text = "Return the book. I will return it soon, I promise to return it.";
    const result = buildSearchSnippet(text, "return");

    const matches = result.segments.filter((s) => s.match).map((s) => s.text);
    expect(matches).toEqual(["Return", "return", "return"]);
    expect(result.matchCount).toBe(3);
    expect(result.shownIndex).toBe(1);
  });
});

describe("buildSearchSnippet — stem/prefix fallback (Postgres FTS stemming)", () => {
  it("matches a shorter stem in the text when the typed word is longer (running → run)", () => {
    const text = "I went for a run this morning.";
    const result = buildSearchSnippet(text, "running");

    const matches = result.segments.filter((s) => s.match).map((s) => s.text);
    expect(matches).toEqual(["run"]);
    expect(result.matchCount).toBe(1);
  });

  it("matches a longer word in the text when the typed word is a shorter stem (run → running)", () => {
    const text = "I love running every morning.";
    const result = buildSearchSnippet(text, "run");

    const matches = result.segments.filter((s) => s.match).map((s) => s.text);
    expect(matches).toEqual(["running"]);
    expect(result.matchCount).toBe(1);
  });
});

describe("buildSearchSnippet — no literal or stem match", () => {
  it("falls back to the from-the-top text with no count on an irregular stem (runs vs. ran)", () => {
    const text = "Yesterday I ran five miles before breakfast.";
    const result = buildSearchSnippet(text, "runs");

    expect(result).toEqual({
      segments: [{ text, match: false }],
      matchCount: 0,
      shownIndex: 0,
    });
  });

  it("falls back to the from-the-top text with no count when the query matches nothing at all", () => {
    const text = "The stars were bright over the quiet valley.";
    const result = buildSearchSnippet(text, "banana");

    expect(result).toEqual({
      segments: [{ text, match: false }],
      matchCount: 0,
      shownIndex: 0,
    });
  });
});

describe("buildSearchSnippet — edge cases", () => {
  it("returns the full text unmatched for an empty query", () => {
    const text = "some entry text";
    expect(buildSearchSnippet(text, "")).toEqual({
      segments: [{ text, match: false }],
      matchCount: 0,
      shownIndex: 0,
    });
  });

  it("returns an empty segment for empty text", () => {
    expect(buildSearchSnippet("", "term")).toEqual({
      segments: [{ text: "", match: false }],
      matchCount: 0,
      shownIndex: 0,
    });
  });

  it("matches a whole phrase as one occurrence, not one per word", () => {
    const text = "Today's morning walk was refreshing.";
    const result = buildSearchSnippet(text, '"morning walk"');

    expect(result.matchCount).toBe(1);
    const matches = result.segments.filter((s) => s.match).map((s) => s.text);
    expect(matches).toEqual(["morning walk"]);
  });
});
