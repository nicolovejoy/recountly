// Delete forever (issue #27). DELETE /api/entries/[id]/purge permanently
// destroys a trashed entry via the tested purge orchestration in @/lib/purge
// (photo rows → entry row → best-effort blob deletes). The route stays glue:
// the "only purge already-trashed rows" invariant is enforced in the lib, and
// this handler never touches the hard-delete db helpers itself.

import { purgeTrashedEntry } from "@/lib/purge";
import { getServerSession } from "@/lib/auth-server";

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!(await getServerSession())) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;

  try {
    const result = await purgeTrashedEntry(id);
    if (result === "not_found") {
      return Response.json({ error: "Not found" }, { status: 404 });
    }
    if (result === "not_trashed") {
      return Response.json({ error: "Entry is not in the trash" }, { status: 409 });
    }
    return Response.json({ purged: id });
  } catch (err) {
    return Response.json(
      { error: "Purge failed", detail: String(err) },
      { status: 500 },
    );
  }
}
