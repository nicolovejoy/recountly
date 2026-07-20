// Pure tab-bar model (issue #29) — no React, unit-tested. The single source
// of truth for which tabs exist and which one a pathname belongs to, so the
// TabBar component stays a thin renderer.

export type Tab = "capture" | "library" | "search";

export const TABS: ReadonlyArray<{ tab: Tab; href: string; label: string }> = [
  { tab: "capture", href: "/", label: "Capture" },
  { tab: "library", href: "/library", label: "Library" },
  { tab: "search", href: "/search", label: "Search" },
];

// Segment-aware prefix match: /library and everything under it (trash, a
// journal id) highlight Library; anything unrecognized falls back to Capture.
// /entry/[id] (issue #39) is the detail page reached from Library — it also
// lights Library, the browsing home.
export function activeTab(pathname: string): Tab {
  if (pathname === "/library" || pathname.startsWith("/library/")) return "library";
  if (pathname === "/entry" || pathname.startsWith("/entry/")) return "library";
  if (pathname === "/search" || pathname.startsWith("/search/")) return "search";
  return "capture";
}
