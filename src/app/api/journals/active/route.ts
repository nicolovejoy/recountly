// Active-journal lock (physical-journal archive, issue #15). Exactly one
// journal may be active; captures default to it. PUT { id } activates that
// journal (deactivating the rest atomically); PUT { id: null } clears the lock.

import { setActiveJournal } from "@/lib/db";
import { getServerSession } from "@/lib/auth-server";

export async function PUT(request: Request) {
  if (!(await getServerSession())) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  let body: { id?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Expected JSON body" }, { status: 400 });
  }
  if (body.id !== null && (typeof body.id !== "string" || body.id.length === 0)) {
    return Response.json(
      { error: "id must be a journal id string or null" },
      { status: 400 },
    );
  }
  try {
    await setActiveJournal(body.id as string | null);
  } catch (err) {
    return Response.json(
      { error: "Failed to set active journal", detail: String(err) },
      { status: 500 },
    );
  }
  return Response.json({ ok: true });
}
