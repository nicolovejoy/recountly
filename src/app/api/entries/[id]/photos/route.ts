// Per-entry photo listing (physical-journal archive, issue #16).
//   GET /api/entries/[id]/photos — the photo records for one entry, capture
// order. The client renders each via the gated proxy (/api/photo/<id>).

import { listPhotosByEntry } from "@/lib/db";
import { getServerSession } from "@/lib/auth-server";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!(await getServerSession())) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  try {
    const photos = await listPhotosByEntry(id);
    return Response.json({ photos });
  } catch (err) {
    return Response.json(
      { error: "Failed to list photos", detail: String(err) },
      { status: 500 },
    );
  }
}
