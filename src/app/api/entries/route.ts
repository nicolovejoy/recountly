// Entry persistence API (Phase 2).
//   POST /api/entries  — save an entry (multipart: transcript + fields + optional audio)
//   GET  /api/entries  — newest-first list
// The secret-bearing work (DB, Blob) stays server-side; the browser posts the
// transcript it already has plus a best-effort audio file. All the logic this
// route leans on (validate, build, SQL, blob path) is unit-tested in src/lib.

import { ulid } from "@/lib/ulid";
import { validateEntryInput, buildEntryRecord, type EntryInput } from "@/lib/entry";
import { uploadAudio, audioProxyPath } from "@/lib/blob";
import { insertEntry, listEntries } from "@/lib/db";

export async function GET() {
  try {
    const entries = await listEntries();
    return Response.json({ entries });
  } catch (err) {
    return Response.json(
      { error: "Failed to list entries", detail: String(err) },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
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

  // Best-effort audio: a File part may be absent (paused entry, unsupported
  // browser) or empty. Only treat a non-empty file as audio.
  const audio = form.get("audio");
  const hasAudio = audio instanceof File && audio.size > 0;
  if (hasAudio) {
    input.audioMime = audio.type || "application/octet-stream";
    input.audioBytes = audio.size;
  }

  const errors = validateEntryInput(input);
  if (errors.length) {
    return Response.json({ error: "Invalid entry", problems: errors }, { status: 400 });
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

  const record = buildEntryRecord(input, { id, audioUrl, now: new Date() });

  try {
    await insertEntry(record);
  } catch (err) {
    return Response.json(
      { error: "Failed to save entry", detail: String(err) },
      { status: 500 },
    );
  }

  return Response.json({ entry: record }, { status: 201 });
}
