// Next 16: params is a Promise in dynamic segments. Mirrors
// (tabs)/library/[journalId]/page.tsx.

import EntryDetail from "../../../EntryDetail";

export default async function EntryDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <EntryDetail id={id} />;
}
