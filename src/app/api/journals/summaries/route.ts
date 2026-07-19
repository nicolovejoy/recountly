// Journal summaries (issue #29). One fetch feeds the whole Library page:
//   GET /api/journals/summaries — { journals: JournalSummary[], unfiledCount }
// Static segment: no dynamic sibling under api/journals, no conflict.
// SQL + row mapping are unit-tested in src/lib (journal.ts, db.ts).

import { listJournalSummaries, countUnfiledEntries } from "@/lib/db";
import { getServerSession } from "@/lib/auth-server";

export async function GET() {
  if (!(await getServerSession())) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const [journals, unfiledCount] = await Promise.all([
      listJournalSummaries(),
      countUnfiledEntries(),
    ]);
    return Response.json({ journals, unfiledCount });
  } catch (err) {
    return Response.json(
      { error: "Failed to list journal summaries", detail: String(err) },
      { status: 500 },
    );
  }
}
