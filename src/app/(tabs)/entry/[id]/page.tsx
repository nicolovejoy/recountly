// Next 16: params is a Promise in dynamic segments. Mirrors
// (tabs)/library/[journalId]/page.tsx.

import { Suspense } from "react";
import EntryDetail from "../../../EntryDetail";

// EntryDetail reads useSearchParams (issue #39's ?saved=1 post-save toast),
// which forces a Suspense boundary at build time (Next 16) — same reasoning
// as login/page.tsx.
export default async function EntryDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <Suspense>
      <EntryDetail id={id} />
    </Suspense>
  );
}
