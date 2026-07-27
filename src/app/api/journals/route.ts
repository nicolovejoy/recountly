// Journals API (physical-journal archive, issue #15).
//   GET  /api/journals — list, active-first then newest-first
//   POST /api/journals — create ({ label, notes? }), never active on creation
// All logic (validation, SQL, mapping) is unit-tested in src/lib/journal.ts.

import { ulid } from "@/lib/ulid";
import { validateJournalInput, type JournalRecord } from "@/lib/journal";
import { insertJournal, listJournals } from "@/lib/db";
import { getServerSession } from "@/lib/auth-server";

export async function GET() {
  if (!(await getServerSession())) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const journals = await listJournals();
    return Response.json({ journals });
  } catch (err) {
    return Response.json(
      { error: "Failed to list journals", detail: String(err) },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  if (!(await getServerSession())) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  let body: { label?: unknown; notes?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Expected JSON body" }, { status: 400 });
  }
  const errors = validateJournalInput(body);
  if (errors.length) {
    return Response.json({ error: "Invalid journal", problems: errors }, { status: 400 });
  }
  const journal: JournalRecord = {
    id: ulid(),
    label: (body.label as string).trim(),
    notes: typeof body.notes === "string" && body.notes.trim() ? body.notes.trim() : null,
    active: false,
    createdAt: new Date().toISOString(),
    // startedOn/endedOn/kind (PR A) aren't set on creation — insertJournalSql
    // doesn't even write these columns (they default to null); only PATCH
    // /api/journals/[id] sets them later.
    startedOn: null,
    endedOn: null,
    kind: null,
  };
  try {
    await insertJournal(journal);
  } catch (err) {
    return Response.json(
      { error: "Failed to create journal", detail: String(err) },
      { status: 500 },
    );
  }
  return Response.json({ journal }, { status: 201 });
}
