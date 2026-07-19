// Next 16: params is a Promise in dynamic segments.

import JournalView from "../../../JournalView";

export default async function JournalPage({
  params,
}: {
  params: Promise<{ journalId: string }>;
}) {
  const { journalId } = await params;
  return <JournalView journalId={journalId} />;
}
