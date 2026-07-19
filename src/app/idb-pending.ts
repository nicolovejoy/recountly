"use client";

// Thin IndexedDB glue implementing PendingStore over a single object store
// keyed by id (issue #23 Task 9). IndexedDB stores Blobs natively, so a whole
// PendingSave record (JSON body + audio/photo Blobs) round-trips without any
// serialization step. Deliberately untested — this is browser-only plumbing;
// the logic under test is retryPending in src/lib/pending-save.ts.

import type { PendingSave, PendingStore } from "@/lib/pending-save";

const DB_NAME = "recountly-pending-saves";
const DB_VERSION = 1;
const STORE_NAME = "pending";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, mode);
      const store = tx.objectStore(STORE_NAME);
      const req = run(store);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

export const idbPendingStore: PendingStore = {
  async put(rec: PendingSave): Promise<void> {
    await withStore("readwrite", (store) => store.put(rec));
  },
  async getAll(): Promise<PendingSave[]> {
    const all = await withStore<PendingSave[]>("readonly", (store) => store.getAll());
    return all ?? [];
  },
  async delete(id: string): Promise<void> {
    await withStore("readwrite", (store) => store.delete(id));
  },
};
