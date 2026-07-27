// Journal management (PR A, 2026-07-27): rename/edit + delete a journal.
//   PATCH  /api/journals/[id] — partial { label?, notes?, startedOn?,
//     endedOn?, kind? }, at least one key (validateJournalUpdate).
//   DELETE /api/journals/[id] — blocked unless the journal has zero entries
//     referencing it (live OR trashed — the FK doesn't care about trash; an
//     owner emptying via bulk move/trash+purge is the only path in). No
//     auto-move-to-Unfiled. Deleting the active journal is allowed (the DB
//     just ends up with no active journal — no special-casing needed here).
// All logic (validation, SQL, mapping) is unit-tested in src/lib/journal.ts.

import { validateJournalUpdate, type JournalUpdate } from "@/lib/journal";
import { getJournal, updateJournal, countJournalEntries, deleteJournal } from "@/lib/db";
import { getServerSession } from "@/lib/auth-server";

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
  const errors = validateJournalUpdate(body);
  if (errors.length) {
    return Response.json(
      { error: "Invalid journal update", problems: errors },
      { status: 400 },
    );
  }

  try {
    const journal = await updateJournal(id, body as JournalUpdate);
    if (!journal) {
      return Response.json({ error: "Not found" }, { status: 404 });
    }
    return Response.json({ journal });
  } catch (err) {
    return Response.json(
      { error: "Failed to update journal", detail: String(err) },
      { status: 500 },
    );
  }
}

// Delete-blocked-unless-empty message: the owner-facing entry count on the
// journal view/card is LIVE entries only, so a journal that looks empty
// there can still fail to delete because of trashed entries referencing it —
// that's the confusing case, so the message calls out trash explicitly
// whenever any of the blockers are trashed rows.
function blockedMessage(total: number, trashed: number): string {
  const live = total - trashed;
  if (live > 0 && trashed > 0) {
    return `This journal still has ${live} ${live === 1 ? "entry" : "entries"} (plus ${trashed} in trash) — move or empty them first.`;
  }
  if (live > 0) {
    return `This journal still has ${live} ${live === 1 ? "entry" : "entries"} — move ${live === 1 ? "it" : "them"} out first.`;
  }
  return `This journal's only remaining ${trashed === 1 ? "entry is" : "entries are"} in trash — empty the trash or restore ${trashed === 1 ? "it" : "them"} before deleting this journal.`;
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!(await getServerSession())) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;

  try {
    const existing = await getJournal(id);
    if (!existing) {
      return Response.json({ error: "Not found" }, { status: 404 });
    }

    const counts = await countJournalEntries(id);
    if (counts.total > 0) {
      return Response.json(
        {
          error: blockedMessage(counts.total, counts.trashed),
          entryCount: counts.total,
          trashedCount: counts.trashed,
        },
        { status: 409 },
      );
    }

    const deleted = await deleteJournal(id);
    if (!deleted) {
      return Response.json({ error: "Not found" }, { status: 404 });
    }
  } catch (err) {
    // A racing FK violation (an entry got filed here, or moved through here,
    // between the count check and the delete) — surface it as a conflict,
    // not a 500.
    const message = String(err);
    if (/foreign key/i.test(message)) {
      return Response.json({ error: "Journal is no longer empty" }, { status: 409 });
    }
    return Response.json({ error: "Delete failed", detail: message }, { status: 500 });
  }

  return Response.json({ ok: true });
}
