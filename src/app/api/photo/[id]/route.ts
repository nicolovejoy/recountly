// Photo proxy (physical-journal archive, issue #16).
//   GET /api/photo/[id] — stream one private page-photo blob.
// Photos are stored access:"private" so they are NOT world-readable by URL;
// this auth-gated route looks up the photo row for its mime, fetches the
// private blob server-side, and streams it back to the authenticated owner.
// Mirrors GET /api/audio/[id].

import { get } from "@vercel/blob";
import { getPhoto } from "@/lib/db";
import { photoBlobPath } from "@/lib/photo";
import { getServerSession } from "@/lib/auth-server";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!(await getServerSession())) {
    return new Response("Unauthorized", { status: 401 });
  }
  const { id } = await params;

  let photo;
  try {
    photo = await getPhoto(id);
  } catch (err) {
    return Response.json(
      { error: "Failed to look up photo", detail: String(err) },
      { status: 500 },
    );
  }
  if (!photo) {
    return new Response("Not found", { status: 404 });
  }

  let result;
  try {
    result = await get(photoBlobPath(id, photo.mime), { access: "private" });
  } catch (err) {
    return Response.json(
      { error: "Failed to fetch photo", detail: String(err) },
      { status: 502 },
    );
  }
  if (!result || result.statusCode !== 200) {
    return new Response("Not found", { status: 404 });
  }

  return new Response(result.stream, {
    headers: {
      "Content-Type": result.blob.contentType ?? photo.mime,
      "Content-Length": String(result.blob.size),
      "Cache-Control": "private, max-age=31536000, immutable",
    },
  });
}
