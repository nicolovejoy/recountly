// Entry persistence API.
//   POST /api/entries  — save an entry (JSON: ids + blob pathnames + text)
//   GET  /api/entries  — newest-first list
// Issue #23: audio + photos now upload client-direct to Vercel Blob, so the
// save POST carries only a small JSON body (fits fetch keepalive) — no binaries
// pass through the function body and the 4.5 MB body cap is gone. Enrichment
// runs off the response path via after(). All the logic this route leans on
// (validate/parse, build, SQL, blob path) is unit-tested in src/lib.

import { after } from "next/server";
import { buildEntryRecord } from "@/lib/entry";
import { audioProxyPath } from "@/lib/blob";
import { photoProxyPath, type PhotoRecord } from "@/lib/photo";
import {
  insertEntry,
  insertPhoto,
  searchEntries,
  getJournal,
  updateEntryEnrichment,
} from "@/lib/db";
import { enrichTranscript } from "@/lib/enrich";
import { getAnthropic } from "@/lib/anthropic";
import { parseSearchFilters } from "@/lib/search";
import { parseSaveBody } from "@/lib/save-payload";
import { getServerSession } from "@/lib/auth-server";

export async function GET(request: Request) {
  if (!(await getServerSession())) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    // ?q&from&to drive Phase 3 search; with none set this is the newest-first list.
    const filters = parseSearchFilters(new URL(request.url).searchParams);
    const entries = await searchEntries(filters);
    return Response.json({ entries });
  } catch (err) {
    return Response.json(
      { error: "Failed to list entries", detail: String(err) },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  if (!(await getServerSession())) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return Response.json({ error: "Expected application/json" }, { status: 400 });
  }

  // The blobs are already in the store (client-direct upload); this validates
  // only the small JSON contract (ids + pathnames + text) — save-payload.ts.
  const parsed = parseSaveBody(raw);
  if (!parsed.ok) {
    return Response.json(
      { error: "Invalid entry", problems: parsed.problems },
      { status: 400 },
    );
  }
  const { input, audio, photos } = parsed;
  // The client mints the entry id (isomorphic ulid) — it's the primary key and
  // the idempotency key. parseSaveBody has already asserted it's a non-empty string.
  const id = (raw as { id: string }).id;

  // Kept even though uploads now precede the POST: a client desync could still
  // send a stale journalId, and the check documents the FK constraint
  // (entries.journal_id REFERENCES journals(id)).
  // ⚠️ Because blobs upload client-direct BEFORE this POST, a 400 here no longer
  // prevents orphan blobs — the audio/photo blobs are already in the store. That
  // is acceptable (id-keyed, reclaimed by a future purge sweep); in practice
  // journalId always comes from the client's own active journal, so a miss here
  // is near-impossible from the real UI.
  if (input.journalId && !(await getJournal(input.journalId))) {
    return Response.json({ error: "Unknown journal" }, { status: 400 });
  }

  // audioUrl is the gated proxy path (not the private blob URL) — playback goes
  // through GET /api/audio/[id]. Enrichment runs after the response (see below),
  // so the inserted row starts with empty title/tags/summary.
  const audioUrl = audio ? audioProxyPath(id) : null;
  const record = buildEntryRecord(input, { id, audioUrl, now: new Date(), enrichment: null });

  const photoRecords: PhotoRecord[] = photos.map((p) => ({
    id: p.id,
    entryId: id,
    mime: p.mime,
    bytes: p.bytes,
    createdAt: new Date().toISOString(),
  }));

  try {
    // Idempotent (ON CONFLICT): a pending-save/recovery re-POST can't duplicate.
    await insertEntry(record);
    for (const p of photoRecords) await insertPhoto(p);
  } catch (err) {
    return Response.json(
      { error: "Failed to save entry", detail: String(err) },
      { status: 500 },
    );
  }

  // Best-effort LLM enrichment (Phase 4) moved OFF the request path (issue #23):
  // it adds 1–3s of Haiku latency to the vulnerable save window, so schedule it
  // with after() to run once the 201 is sent. Any failure is swallowed — the raw
  // transcript is untouched and the /api/entries/enrich backfill is the safety net.
  after(async () => {
    try {
      const enrichment = await enrichTranscript(record.transcript, getAnthropic());
      if (enrichment) {
        await updateEntryEnrichment(id, enrichment, new Date().toISOString());
      }
    } catch (err) {
      console.error("enrichment failed (deferred); entry saved without it", err);
    }
  });

  return Response.json(
    {
      entry: record,
      photos: photoRecords.map((p) => ({ id: p.id, url: photoProxyPath(p.id) })),
    },
    { status: 201 },
  );
}
