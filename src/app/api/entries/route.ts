// Entry persistence API (Phase 2).
//   POST /api/entries  — save an entry (multipart: transcript + fields + optional audio)
//   GET  /api/entries  — newest-first list
// The secret-bearing work (DB, Blob) stays server-side; the browser posts the
// transcript it already has plus a best-effort audio file. All the logic this
// route leans on (validate, build, SQL, blob path) is unit-tested in src/lib.

import { ulid } from "@/lib/ulid";
import {
  validateEntryInput,
  buildEntryRecord,
  type EntryInput,
  type EntryEnrichment,
} from "@/lib/entry";
import { uploadAudio, audioProxyPath } from "@/lib/blob";
import { uploadPhoto, photoProxyPath, type PhotoRecord } from "@/lib/photo";
import { insertEntry, insertPhoto, searchEntries, getJournal } from "@/lib/db";
import { enrichTranscript } from "@/lib/enrich";
import { getAnthropic } from "@/lib/anthropic";
import { parseSearchFilters } from "@/lib/search";
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

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json({ error: "Expected multipart/form-data" }, { status: 400 });
  }

  const input: EntryInput = {
    transcript: String(form.get("transcript") ?? ""),
    durationSeconds: Number(form.get("durationSeconds") ?? NaN),
  };
  const recordedAt = form.get("recordedAt");
  if (typeof recordedAt === "string" && recordedAt) input.recordedAt = recordedAt;
  const journalId = form.get("journalId");
  if (typeof journalId === "string" && journalId) input.journalId = journalId;
  const writtenAt = form.get("writtenAt");
  if (typeof writtenAt === "string" && writtenAt) input.writtenAt = writtenAt;

  // Best-effort audio: a File part may be absent (paused entry, unsupported
  // browser) or empty. Only treat a non-empty file as audio.
  const audio = form.get("audio");
  const hasAudio = audio instanceof File && audio.size > 0;
  if (hasAudio) {
    input.audioMime = audio.type || "application/octet-stream";
    input.audioBytes = audio.size;
    // false only when the client explicitly says so (paused mid-entry).
    input.audioComplete = form.get("audioComplete") !== "false";
  }

  // Page photos are NOT best-effort (unlike audio): any problem here fails the
  // save loudly so the owner can re-shoot the page now — issue #10 is why.
  const MAX_PHOTO_BYTES = 8 * 1024 * 1024;
  const photoFiles = form
    .getAll("photo")
    .filter((p): p is File => p instanceof File && p.size > 0);
  const photoProblems: string[] = [];
  for (const f of photoFiles) {
    if (!f.type.startsWith("image/")) {
      photoProblems.push(`photo ${f.name} is not an image (${f.type || "unknown type"})`);
    }
    if (f.size > MAX_PHOTO_BYTES) {
      photoProblems.push(`photo ${f.name} exceeds ${MAX_PHOTO_BYTES} bytes`);
    }
  }

  const errors = [...validateEntryInput(input), ...photoProblems];
  if (errors.length) {
    return Response.json({ error: "Invalid entry", problems: errors }, { status: 400 });
  }

  // Checked before any blob upload: a journalId that doesn't exist would
  // otherwise let photo/audio blobs upload and then fail the entry INSERT on
  // the FK (entries.journal_id REFERENCES journals(id)), orphaning them.
  if (input.journalId && !(await getJournal(input.journalId))) {
    return Response.json({ error: "Unknown journal" }, { status: 400 });
  }

  const id = ulid();

  let audioUrl: string | null = null;
  if (hasAudio) {
    try {
      await uploadAudio(id, audio, input.audioMime!, input.audioBytes!);
      // Store the gated proxy path, not the private blob URL — playback goes
      // through GET /api/audio/[id] (auth-gated) which streams the private blob.
      audioUrl = audioProxyPath(id);
    } catch (err) {
      // Audio is best-effort — a failed upload must not lose the transcript.
      // Drop the audio fields and save the entry without it.
      console.error("audio upload failed; saving entry without audio", err);
      audioUrl = null;
      input.audioMime = undefined;
      input.audioBytes = undefined;
    }
  }

  const photoRecords: PhotoRecord[] = [];
  for (const f of photoFiles) {
    const photoId = ulid();
    try {
      await uploadPhoto(photoId, f, f.type, f.size);
    } catch (err) {
      // NOT best-effort: the entry is not saved, the client must retry.
      return Response.json(
        { error: "Photo upload failed — entry NOT saved. Keep the page handy and retry.", detail: String(err) },
        { status: 502 },
      );
    }
    photoRecords.push({
      id: photoId,
      entryId: id,
      mime: f.type,
      bytes: f.size,
      createdAt: new Date().toISOString(),
    });
  }

  // Best-effort LLM enrichment (Phase 4): one structured call generates a
  // title + tags + summary. Like audio, a failure must not fail the save — the
  // raw transcript is untouched and a later backfill can fill enrichment in.
  // getAnthropic() throws if the key is unset; the catch covers that too.
  let enrichment: EntryEnrichment | null = null;
  try {
    enrichment = await enrichTranscript(input.transcript.trim(), getAnthropic());
  } catch (err) {
    console.error("enrichment failed; saving entry without it", err);
  }

  const record = buildEntryRecord(input, { id, audioUrl, now: new Date(), enrichment });

  try {
    await insertEntry(record);
  } catch (err) {
    return Response.json(
      { error: "Failed to save entry", detail: String(err) },
      { status: 500 },
    );
  }

  try {
    for (const p of photoRecords) await insertPhoto(p);
  } catch (err) {
    // The entry row saved but a photo record didn't — surface it loudly rather
    // than pretend the save was clean; the blob exists, the row can be re-added.
    return Response.json(
      { error: "Entry saved but recording a photo failed", detail: String(err), entry: record },
      { status: 500 },
    );
  }

  return Response.json(
    {
      entry: record,
      photos: photoRecords.map((p) => ({ id: p.id, url: photoProxyPath(p.id) })),
    },
    { status: 201 },
  );
}
