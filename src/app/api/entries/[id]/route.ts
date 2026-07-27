// Entry delete (issue #9), now soft-delete/trash semantics (owner request:
// worried about permanence). DELETE /api/entries/[id] marks the row
// deleted_at and hides it everywhere (listEntriesSql/searchEntriesSql/
// listUnenrichedSql all filter deleted_at IS NULL) — nothing is destroyed.
// Rows and their audio/photo blobs are kept as-is for later recovery; this
// handler does not touch blobs at all. A future explicit "empty trash" purge
// step can use the retained hard-delete helpers (deleteEntry/
// deletePhotosByEntry in @/lib/db, deleteEntrySql/deletePhotosByEntrySql)
// plus blob cleanup — none of that runs here.

import { softDeleteEntry, getEntry, getJournal, moveEntry, updateEntryMetadata } from "@/lib/db";
import { validateEntryMetadataPatch } from "@/lib/entry";
import { getServerSession } from "@/lib/auth-server";

// The two shapes PATCH accepts (PR B): a move ({journalId}) or a metadata
// edit (any of title/notes/location/writtenAt) — never both, never neither.
const METADATA_KEYS = ["title", "notes", "location", "writtenAt"] as const;

// Single-entry fetch for the detail page (issue #39). Photos are NOT included
// here — the page reuses the existing GET /api/entries/[id]/photos rather
// than duplicating that query. Mirrors PATCH's "trashed looks like unknown"
// guard so a bookmarked/trashed id 404s instead of leaking the row.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!(await getServerSession())) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;

  try {
    const entry = await getEntry(id);
    if (!entry || entry.deletedAt) {
      return Response.json({ error: "Not found" }, { status: 404 });
    }
    return Response.json({ entry });
  } catch (err) {
    return Response.json(
      { error: "Failed to load entry", detail: String(err) },
      { status: 500 },
    );
  }
}

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

// PATCH /api/entries/[id] handles two disjoint request shapes (PR B adds the
// second alongside issue #28's original):
//   - a MOVE: body has journalId (string | null) — unchanged from #28.
//   - a METADATA EDIT: body has any of title/notes/location/writtenAt.
// A body with both, or neither, is a 400 — the two never mix in one request.
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!(await getServerSession())) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Expected JSON body" }, { status: 400 });
  }

  const hasJournalId = Object.prototype.hasOwnProperty.call(body, "journalId");
  const hasMetadata = METADATA_KEYS.some((k) => Object.prototype.hasOwnProperty.call(body, k));

  if (hasJournalId && hasMetadata) {
    return Response.json(
      { error: "Body must be either a move (journalId) or a metadata edit, not both" },
      { status: 400 },
    );
  }
  if (!hasJournalId && !hasMetadata) {
    return Response.json(
      { error: "Body must include journalId or an entry metadata field" },
      { status: 400 },
    );
  }

  return hasMetadata ? patchMetadata(id, body) : patchMove(id, body);
}

// Move an entry between journals (issue #28). Body: { journalId: string | null }
// — null files it to Unfiled. Mirrors POST /api/entries's journal validation
// (400 "Unknown journal", getJournal pre-check) and the trash routes' 404 shape.
// A same-journal move is a no-op: 200, no entry_moves row written (moveEntry's
// atomic UPDATE+INSERT only runs when the journal is actually changing).
async function patchMove(id: string, body: { journalId?: unknown }) {
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

// Metadata edit (PR B): title/notes/location/writtenAt, any subset. 404 when
// no LIVE row matched (unknown or trashed id — updateEntryMetadataSql's
// deleted_at IS NULL guard), mirroring the trash/move routes' shape.
async function patchMetadata(id: string, body: unknown) {
  const parsed = validateEntryMetadataPatch(body);
  if (!parsed.ok) {
    return Response.json(
      { error: "Invalid entry update", problems: parsed.problems },
      { status: 400 },
    );
  }

  try {
    const entry = await updateEntryMetadata(id, parsed.patch);
    if (!entry) {
      return Response.json({ error: "Not found" }, { status: 404 });
    }
    return Response.json({ entry });
  } catch (err) {
    return Response.json(
      { error: "Failed to update entry", detail: String(err) },
      { status: 500 },
    );
  }
}
