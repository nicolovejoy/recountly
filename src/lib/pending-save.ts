// IndexedDB pending-save queue + retry (issue #23 Task 9). Closes the last
// durability gap: a crash/discard between "Done was tapped" and "the 201
// landed" (or the ack reached the client) would otherwise lose the entry.
// The client persists a full snapshot (JSON body + audio/photo Blobs — IDB
// stores Blobs natively) to IndexedDB BEFORE starting uploads, and deletes it
// only once a full-refs 201 confirms the row is durably saved. On the next
// app open, retryPending re-uploads any surviving records' blobs and re-POSTs
// — safe to repeat because the entry/photo inserts are ON CONFLICT (Task 1),
// so a record whose save actually landed but whose ack was lost still
// resolves to a clean 201 with no duplicate row.
//
// Pure over an injectable store + deps — no IndexedDB or network dependency
// here, so this runs and is tested under node. The real IndexedDB-backed
// PendingStore lives in src/app/idb-pending.ts (untested browser glue).

import type { ClientUploadFn, EntryUploadInput, EntryUploadResult } from "./blob-upload";
import type { SaveRequestBody } from "./save-payload";

export interface PendingSave {
  id: string; // entry id — the dedupe key
  body: SaveRequestBody; // the JSON to (re-)POST
  audio: { blob: Blob; mime: string; complete: boolean } | null;
  photos: { id: string; blob: Blob; mime: string }[];
  createdAt: number;
}

// IndexedDB stores Blobs natively, so the whole record round-trips.
export interface PendingStore {
  put(rec: PendingSave): Promise<void>;
  getAll(): Promise<PendingSave[]>;
  delete(id: string): Promise<void>;
}

export interface RetryDeps {
  uploadBlobs: (input: EntryUploadInput, upload: ClientUploadFn) => Promise<EntryUploadResult>;
  upload: ClientUploadFn;
  postSave: (body: SaveRequestBody) => Promise<{ ok: boolean; status: number }>;
}

// Re-upload blobs then re-POST each pending record; delete on a 201 (or any
// response proving the row exists — the insert is ON CONFLICT, so a
// landed-but-unacked save re-POSTs to a 201 with no duplicate). A record is
// kept — for the next retry — on a network failure (uploadBlobs/postSave
// throws) or a non-ok response (e.g. 5xx). Returns how many were recovered.
export async function retryPending(store: PendingStore, deps: RetryDeps): Promise<{ recovered: number }> {
  const records = await store.getAll();
  let recovered = 0;

  for (const rec of records) {
    try {
      const uploaded = await deps.uploadBlobs(
        { entryId: rec.id, audio: rec.audio, photos: rec.photos },
        deps.upload,
      );
      const body: SaveRequestBody = { ...rec.body, audio: uploaded.audio, photos: uploaded.photos };
      const res = await deps.postSave(body);
      if (res.ok) {
        await store.delete(rec.id);
        recovered += 1;
      }
      // else: non-ok response (e.g. 5xx) — keep the record for next retry.
    } catch {
      // Blob re-upload or postSave network failure — keep the record.
    }
  }

  return { recovered };
}
