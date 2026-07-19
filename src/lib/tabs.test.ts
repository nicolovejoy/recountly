import { describe, it, expect } from "vitest";
import { TABS, activeTab, type Tab } from "./tabs";

describe("TABS", () => {
  it("lists Capture, Library, Search in order with their hrefs", () => {
    expect(TABS).toEqual([
      { tab: "capture", href: "/", label: "Capture" },
      { tab: "library", href: "/library", label: "Library" },
      { tab: "search", href: "/search", label: "Search" },
    ]);
  });
});

describe("activeTab", () => {
  it.each<[string, Tab]>([
    ["/", "capture"],
    ["/library", "library"],
    ["/library/trash", "library"],
    ["/library/01hxyz", "library"],
    ["/search", "search"],
  ])("%s → %s", (pathname, tab) => {
    expect(activeTab(pathname)).toBe(tab);
  });

  it("falls back to capture for unknown paths", () => {
    expect(activeTab("/login")).toBe("capture");
    expect(activeTab("/nope")).toBe("capture");
  });

  it("does not match prefixes that aren't path segments", () => {
    expect(activeTab("/librarian")).toBe("capture");
    expect(activeTab("/searching")).toBe("capture");
  });
});
