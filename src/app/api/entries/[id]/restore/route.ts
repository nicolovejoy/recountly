// Un-trash (issue #27). POST /api/entries/[id]/restore clears deleted_at so
// the entry reappears in the list/search. 404 covers both unknown ids and
// entries that aren't in the trash — restoreEntry's UPDATE matches neither.

import { restoreEntry } from "@/lib/db";
import { getServerSession } from "@/lib/auth-server";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!(await getServerSession())) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;

  let restored: boolean;
  try {
    restored = await restoreEntry(id);
  } catch (err) {
    return Response.json(
      { error: "Restore failed", detail: String(err) },
      { status: 500 },
    );
  }

  if (!restored) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  return Response.json({ restored: id });
}
