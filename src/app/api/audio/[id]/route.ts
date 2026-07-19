// Audio playback proxy (Phase 2 — private audio).
//   GET /api/audio/[id] — stream one entry's private audio blob.
// Audio blobs are stored with access:"private", so they are NOT world-readable
// by URL. Playback comes through here instead: this route is gated by Vercel
// Authentication (Deployment Protection) like the rest of the app, looks up the
// entry to learn its mime, fetches the private blob server-side with the
// BLOB_READ_WRITE_TOKEN, and streams it back to the authenticated owner.
//
// Issue #41: the <audio> element showed 0:00/0:00 until play. iOS Safari
// reads duration by probing with byte-range GETs (e.g. for the trailing moov
// atom in an mp4) rather than downloading the whole file up front, and this
// route answered every request with 200 + no Accept-Ranges, so Safari had no
// way to know Range was supported and never got a duration before playback
// started. @vercel/blob's get() has no server-side Range passthrough (its
// GetBlobResult type only models 200/304), so Range support is implemented
// here: fetch the full private blob, then slice the buffer for a 206 when the
// request carries a Range header. Fine at personal-journal scale.

import { get } from "@vercel/blob";
import { getEntry } from "@/lib/db";
import { audioBlobPath } from "@/lib/blob";
import { getServerSession } from "@/lib/auth-server";
import { parseRange } from "@/lib/range";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!(await getServerSession())) {
    return new Response("Unauthorized", { status: 401 });
  }
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

  const contentType = result.blob.contentType ?? entry.audioMime;
  const size = result.blob.size;
  const range = parseRange(req.headers.get("range"), size);

  if (range.type === "unsatisfiable") {
    return new Response(null, {
      status: 416,
      headers: { "Content-Range": `bytes */${size}`, "Accept-Ranges": "bytes" },
    });
  }

  if (range.type === "none") {
    return new Response(result.stream, {
      headers: {
        "Content-Type": contentType,
        "Content-Length": String(size),
        "Accept-Ranges": "bytes",
        "Cache-Control": "private, max-age=31536000, immutable",
      },
    });
  }

  // Satisfiable Range request: @vercel/blob's get() has no server-side Range
  // passthrough, so buffer the full body and slice it ourselves.
  const buffer = Buffer.from(await new Response(result.stream).arrayBuffer());
  const slice = buffer.subarray(range.start, range.end + 1);
  return new Response(slice, {
    status: 206,
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(slice.length),
      "Content-Range": `bytes ${range.start}-${range.end}/${size}`,
      "Accept-Ranges": "bytes",
      "Cache-Control": "private, max-age=31536000, immutable",
    },
  });
}
