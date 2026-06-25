// Enrichment backfill (Phase 4 thread 1).
//   POST /api/entries/enrich — enrich up to N rows where enriched_at IS NULL.
// Auth-gated; the owner triggers this once to enrich entries saved before
// inline enrichment landed. Each call is best-effort per row: a row that fails
// to enrich is skipped (stays unenriched) so re-running picks it up next time.

import { listUnenriched, updateEntryEnrichment } from "@/lib/db";
import { enrichTranscript } from "@/lib/enrich";
import { getAnthropic } from "@/lib/anthropic";
import { getServerSession } from "@/lib/auth-server";

// Bound per-call work so we stay well under the function timeout. Re-run until
// `remaining` is 0 to drain a larger backlog.
const BATCH = 25;

export async function POST() {
  if (!(await getServerSession())) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  let rows;
  try {
    rows = await listUnenriched(BATCH);
  } catch (err) {
    return Response.json(
      { error: "Failed to list unenriched entries", detail: String(err) },
      { status: 500 },
    );
  }

  let client;
  try {
    client = getAnthropic();
  } catch (err) {
    return Response.json({ error: "Enrichment unavailable", detail: String(err) }, { status: 503 });
  }

  let enriched = 0;
  let failed = 0;
  for (const row of rows) {
    const e = await enrichTranscript(row.transcript, client);
    if (!e) {
      failed++;
      continue;
    }
    try {
      await updateEntryEnrichment(row.id, e, new Date().toISOString());
      enriched++;
    } catch (err) {
      console.error(`failed to write enrichment for ${row.id}`, err);
      failed++;
    }
  }

  // `remaining` undercounts if more than BATCH rows were unenriched (we only
  // fetched BATCH) — a nonzero scanned-with-leftover signals "run again".
  return Response.json({ scanned: rows.length, enriched, failed });
}
