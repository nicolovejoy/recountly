// Entry delete (issue #9), now soft-delete/trash semantics (owner request:
// worried about permanence). DELETE /api/entries/[id] marks the row
// deleted_at and hides it everywhere (listEntriesSql/searchEntriesSql/
// listUnenrichedSql all filter deleted_at IS NULL) — nothing is destroyed.
// Rows and their audio/photo blobs are kept as-is for later recovery; this
// handler does not touch blobs at all. A future explicit "empty trash" purge
// step can use the retained hard-delete helpers (deleteEntry/
// deletePhotosByEntry in @/lib/db, deleteEntrySql/deletePhotosByEntrySql)
// plus blob cleanup — none of that runs here.

import { softDeleteEntry } from "@/lib/db";
import { getServerSession } from "@/lib/auth-server";

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!(await getServerSession())) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;

  let trashed: boolean;
  try {
    trashed = await softDeleteEntry(id);
  } catch (err) {
    return Response.json(
      { error: "Delete failed", detail: String(err) },
      { status: 500 },
    );
  }

  if (!trashed) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  return Response.json({ trashed: id });
}
