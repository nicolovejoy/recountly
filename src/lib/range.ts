// HTTP Range header parsing for GET /api/audio/[id] (issue #41). iOS Safari
// probes an <audio> element's duration via byte-range requests rather than a
// full download, so the proxy needs to answer them — this is the pure parser;
// the route does the fetch/slice/response-shaping. Single-range "bytes=..."
// only (start-end, open-ended start-, and suffix -N); multi-range and other
// units are treated as absent, per RFC 7233 servers may ignore what they
// don't support and serve the full entity instead of erroring.

export type RangeResult =
  | { type: "none" }
  | { type: "unsatisfiable" }
  | { type: "satisfiable"; start: number; end: number };

export function parseRange(header: string | null | undefined, size: number): RangeResult {
  if (!header) return { type: "none" };

  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return { type: "none" };

  const [, startStr, endStr] = match;
  if (startStr === "" && endStr === "") return { type: "none" };

  let start: number;
  let end: number;
  if (startStr === "") {
    // Suffix range: last N bytes.
    const suffixLength = parseInt(endStr, 10);
    if (suffixLength <= 0) return { type: "unsatisfiable" };
    start = Math.max(size - suffixLength, 0);
    end = size - 1;
  } else {
    start = parseInt(startStr, 10);
    end = endStr === "" ? size - 1 : parseInt(endStr, 10);
  }

  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || start > end) {
    return { type: "unsatisfiable" };
  }
  if (size <= 0 || start >= size) {
    return { type: "unsatisfiable" };
  }

  return { type: "satisfiable", start, end: Math.min(end, size - 1) };
}
