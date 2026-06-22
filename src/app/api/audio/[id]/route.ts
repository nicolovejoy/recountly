// Audio playback proxy (Phase 2 — private audio).
//   GET /api/audio/[id] — stream one entry's private audio blob.
// Audio blobs are stored with access:"private", so they are NOT world-readable
// by URL. Playback comes through here instead: this route is gated by Vercel
// Authentication (Deployment Protection) like the rest of the app, looks up the
// entry to learn its mime, fetches the private blob server-side with the
// BLOB_READ_WRITE_TOKEN, and streams it back to the authenticated owner.
//
// Note: this streams the whole object (no HTTP Range support). Linear playback
// works; scrubbing may re-request from the start. Fine for a personal journal.

import { get } from "@vercel/blob";
import { getEntry } from "@/lib/db";
import { audioBlobPath } from "@/lib/blob";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  let entry;
  try {
    entry = await getEntry(id);
  } catch (err) {
    return Response.json(
      { error: "Failed to look up entry", detail: String(err) },
      { status: 500 },
    );
  }
  if (!entry || !entry.audioMime) {
    return new Response("Not found", { status: 404 });
  }

  let result;
  try {
    result = await get(audioBlobPath(id, entry.audioMime), { access: "private" });
  } catch (err) {
    return Response.json(
      { error: "Failed to fetch audio", detail: String(err) },
      { status: 502 },
    );
  }
  if (!result || result.statusCode !== 200) {
    return new Response("Not found", { status: 404 });
  }

  return new Response(result.stream, {
    headers: {
      "Content-Type": result.blob.contentType ?? entry.audioMime,
      "Content-Length": String(result.blob.size),
      "Cache-Control": "private, max-age=31536000, immutable",
    },
  });
}
