// Trash collection (issue #27). Static segment: Next routes /api/entries/trash
// here, not to the [id] dynamic route — static beats dynamic.
//   GET    /api/entries/trash — trashed entries, newest-trashed first
//   DELETE /api/entries/trash — empty the trash (purge everything in it)

import { listTrashedEntries } from "@/lib/db";
import { emptyTrash } from "@/lib/purge";
import { getServerSession } from "@/lib/auth-server";

export async function GET() {
  if (!(await getServerSession())) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const entries = await listTrashedEntries();
    return Response.json({ entries });
  } catch (err) {
    return Response.json(
      { error: "Failed to list trash", detail: String(err) },
      { status: 500 },
    );
  }
}

export async function DELETE() {
  if (!(await getServerSession())) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const purged = await emptyTrash();
    return Response.json({ purged });
  } catch (err) {
    return Response.json(
      { error: "Empty trash failed", detail: String(err) },
      { status: 500 },
    );
  }
}
