// Pure glue between the HTTP layer and SearchFilters (Phase 3). The route turns
// request query params into filters; the client turns its filter state back into
// a query string. Kept here, driver- and DOM-free, so both directions are
// unit-tested without a request or a browser.

import type { SearchFilters } from "./entry-sql";

// Request query params (?q&from&to) → normalized filters. Blank values are
// dropped so an empty search box degrades to the plain newest-first list.
export function parseSearchFilters(params: URLSearchParams): SearchFilters {
  const out: SearchFilters = {};
  const q = params.get("q")?.trim();
  if (q) out.query = q;
  const from = params.get("from")?.trim();
  if (from) out.from = from;
  const to = params.get("to")?.trim();
  if (to) out.to = to;
  const journal = params.get("journal")?.trim();
  if (journal) out.journalId = journal;
  // Only the literal "1" opts in, and journalId wins when both are set —
  // mirrors searchEntriesSql, which ignores unfiled alongside a journalId.
  if (params.get("unfiled") === "1" && !out.journalId) out.unfiled = true;
  // Only the non-default literal is accepted; "newest" is implicit and never
  // round-trips, anything else is dropped.
  if (params.get("sort") === "reading") out.sort = "reading";
  // The journal view asks for 200 so a full notebook isn't truncated at the
  // default 50. Non-integers are dropped; out-of-range values clamp to 1..200.
  const limitRaw = params.get("limit")?.trim();
  if (limitRaw) {
    const limit = Number(limitRaw);
    if (Number.isInteger(limit)) out.limit = Math.min(200, Math.max(1, limit));
  }
  return out;
}

// The journal <select> carries one extra choice — Unfiled — that isn't a
// journal id. The sentinel can't collide with real ids (ULIDs/imp_*).
export const UNFILED_FILTER = "__unfiled__";

// Select value → the journal-shaped part of SearchFilters. "" (all) → neither.
export function journalFilterToSearch(
  value: string,
): Pick<SearchFilters, "journalId" | "unfiled"> {
  if (!value) return {};
  if (value === UNFILED_FILTER) return { unfiled: true };
  return { journalId: value };
}

// Filters → "?q=…&from=…" (or "" when empty) for the client fetch URL.
export function buildSearchQueryString(f: SearchFilters): string {
  const params = new URLSearchParams();
  const q = f.query?.trim();
  if (q) params.set("q", q);
  if (f.from) params.set("from", f.from);
  if (f.to) params.set("to", f.to);
  if (f.journalId) params.set("journal", f.journalId);
  if (f.unfiled) params.set("unfiled", "1");
  if (f.sort === "reading") params.set("sort", "reading");
  if (f.limit != null) params.set("limit", String(f.limit));
  const s = params.toString();
  return s ? `?${s}` : "";
}
