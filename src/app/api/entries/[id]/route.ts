// Entry delete (issue #9). DELETE /api/entries/[id] removes the DB rows
// (photos then the entry — photos.entry_id has no ON DELETE CASCADE,
// db/schema.sql:73) and then best-effort cleans up the associated blobs
// (audio + photos). A blob-cleanup failure does NOT fail the request — the DB
// rows are already gone, so the entry is deleted from the owner's point of
// view; a stray blob is just disk, not data loss (the mirror of how audio/
// photo upload failures are handled on the write path).

import { getEntry, deleteEntry, deletePhotosByEntry, listPhotosByEntry } from "@/lib/db";
import { audioBlobPath, deleteBlobPaths } from "@/lib/blob";
import { photoBlobPath } from "@/lib/photo";
import { getServerSession } from "@/lib/auth-server";

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!(await getServerSession())) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;

  let blobPaths: string[] = [];
  try {
    const entry = await getEntry(id);
    if (!entry) {
      return Response.json({ error: "Not found" }, { status: 404 });
    }

    const photos = await listPhotosByEntry(id);
    blobPaths = photos.map((p) => photoBlobPath(p.id, p.mime));
    if (entry.audioMime) {
      blobPaths.push(audioBlobPath(id, entry.audioMime));
    }

    // DB deletes first, in dependency order: photos (child) before the entry
    // (parent) — photos.entry_id has no ON DELETE CASCADE.
    await deletePhotosByEntry(id);
    await deleteEntry(id);
  } catch (err) {
    return Response.json(
      { error: "Delete failed", detail: String(err) },
      { status: 500 },
    );
  }

  // Blob cleanup is best-effort: the DB rows are already gone, so a blob
  // failure here must not fail the request — just surface a warning.
  let blobWarning: string | undefined;
  try {
    await deleteBlobPaths(blobPaths);
  } catch (err) {
    blobWarning = String(err);
  }

  return Response.json(
    blobWarning ? { deleted: id, blobWarning } : { deleted: id },
  );
}
