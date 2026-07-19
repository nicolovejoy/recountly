// Static segment — beats the [journalId] dynamic sibling, same precedence as
// api/entries/trash vs [id].

import TrashView from "../../../TrashView";

export default function TrashPage() {
  return <TrashView />;
}
