// Purge orchestration for the trash (issue #27) — permanently destroys a
// trashed entry: photo rows, the entry row, and the audio/photo blobs. Pure
// glue over the tested db/blob layers, itself tested with a fake runner/delFn.
//
// Invariants (see the plan): purge only ever targets already-trashed rows;
// photo rows are deleted before the entry row (no ON DELETE CASCADE); blob
// deletes are best-effort and run AFTER the row deletes, with the paths
// derived before the rows disappear.

import {
  getEntry,
  listPhotosByEntry,
  deletePhotosByEntry,
  deleteEntry,
  listTrashedEntries,
  type QueryRunner,
} from "./db";
import { audioBlobPath, deleteBlobPaths, type DelFn } from "./blob";
import { photoBlobPath } from "./photo";

export type PurgeResult = "purged" | "not_found" | "not_trashed";

// Both injectable for tests; omitted = the real Neon runner / @vercel/blob del.
export interface PurgeDeps {
  runner?: QueryRunner;
  delFn?: DelFn;
}

export async function purgeTrashedEntry(
  id: string,
  deps: PurgeDeps = {},
): Promise<PurgeResult> {
  const entry = await getEntry(id, deps.runner);
  if (!entry) return "not_found";
  if (entry.deletedAt == null) return "not_trashed";

  // Derive every blob path while the rows still exist; the paths are id+mime
  // -deterministic, so nothing else needs to survive the row deletes.
  const photos = await listPhotosByEntry(id, deps.runner);
  const paths: string[] = [];
  if (entry.audioMime != null) paths.push(audioBlobPath(entry.id, entry.audioMime));
  for (const p of photos) paths.push(photoBlobPath(p.id, p.mime));

  await deletePhotosByEntry(id, deps.runner); // before the entry row — no CASCADE
  await deleteEntry(id, deps.runner);
  try {
    await deleteBlobPaths(paths, deps.delFn); // no-op when paths is empty
  } catch {
    // Best-effort, like audio upload: the rows are gone, which is what the
    // owner asked for; an orphaned blob is harmless (and privately stored).
  }
  return "purged";
}

// Far above any plausible single-user trash size; keeps emptyTrash one query
// + N purges rather than a loop that could spin on a failing row.
const EMPTY_TRASH_LIMIT = 1000;

// Purge everything in the trash; returns how many entries were purged. Each
// purge re-checks its own guards, so a row that vanished (or was restored)
// between the list and the purge just doesn't count. A purge that throws
// stops the loop and returns the count so far instead of propagating — a
// later "Empty trash" retry picks up the remainder (the guards make that safe).
export async function emptyTrash(deps: PurgeDeps = {}): Promise<number> {
  const trashed = await listTrashedEntries(EMPTY_TRASH_LIMIT, deps.runner);
  let purged = 0;
  for (const entry of trashed) {
    try {
      if ((await purgeTrashedEntry(entry.id, deps)) === "purged") purged++;
    } catch {
      break;
    }
  }
  return purged;
}
