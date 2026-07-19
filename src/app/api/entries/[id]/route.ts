// Entry delete (issue #9), now soft-delete/trash semantics (owner request:
// worried about permanence). DELETE /api/entries/[id] marks the row
// deleted_at and hides it everywhere (listEntriesSql/searchEntriesSql/
// listUnenrichedSql all filter deleted_at IS NULL) — nothing is destroyed.
// Rows and their audio/photo blobs are kept as-is for later recovery; this
// handler does not touch blobs at all. A future explicit "empty trash" purge
// step can use the retained hard-delete helpers (deleteEntry/
// deletePhotosByEntry in @/lib/db, deleteEntrySql/deletePhotosByEntrySql)
// plus blob cleanup — none of that runs here.

import { softDeleteEntry, getEntry, getJournal, moveEntry } from "@/lib/db";
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

// Move an entry between journals (issue #28). Body: { journalId: string | null }
// — null files it to Unfiled. Mirrors POST /api/entries's journal validation
// (400 "Unknown journal", getJournal pre-check) and the trash routes' 404 shape.
// A same-journal move is a no-op: 200, no entry_moves row written (moveEntry's
// atomic UPDATE+INSERT only runs when the journal is actually changing).
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!(await getServerSession())) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;

  let body: { journalId?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Expected JSON body" }, { status: 400 });
  }
  if (body.journalId !== null && typeof body.journalId !== "string") {
    return Response.json(
      { error: "journalId must be a journal id string or null" },
      { status: 400 },
    );
  }
  const journalId = body.journalId as string | null;

  try {
    const entry = await getEntry(id);
    if (!entry || entry.deletedAt) {
      return Response.json({ error: "Not found" }, { status: 404 });
    }

    if (journalId && !(await getJournal(journalId))) {
      return Response.json({ error: "Unknown journal" }, { status: 400 });
    }

    if (entry.journalId === journalId) {
      return Response.json({ moved: id, journalId });
    }

    const moved = await moveEntry(id, journalId);
    if (!moved) {
      return Response.json({ error: "Not found" }, { status: 404 });
    }
  } catch (err) {
    return Response.json(
      { error: "Move failed", detail: String(err) },
      { status: 500 },
    );
  }

  return Response.json({ moved: id, journalId });
}
