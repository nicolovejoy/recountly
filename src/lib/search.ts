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
  return out;
}

// Filters → "?q=…&from=…" (or "" when empty) for the client fetch URL.
export function buildSearchQueryString(f: SearchFilters): string {
  const params = new URLSearchParams();
  const q = f.query?.trim();
  if (q) params.set("q", q);
  if (f.from) params.set("from", f.from);
  if (f.to) params.set("to", f.to);
  const s = params.toString();
  return s ? `?${s}` : "";
}
