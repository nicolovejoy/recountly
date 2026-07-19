import { describe, it, expect } from "vitest";
import { retryPending, type PendingSave, type PendingStore, type RetryDeps } from "./pending-save";
import type { ClientUploadFn, EntryUploadInput, EntryUploadResult } from "./blob-upload";
import type { SaveRequestBody } from "./save-payload";

// retryPending re-uploads a pending record's blobs then re-POSTs the JSON
// save, deleting the record only on a response that proves the row landed
// (the insert is ON CONFLICT, so a re-POST of an already-landed save is safe
// — no duplicate). A network/5xx failure keeps the record for the next retry.

function makeRecord(id: string, overrides: Partial<PendingSave> = {}): PendingSave {
  const body: SaveRequestBody = {
    id,
    transcript: `transcript ${id}`,
    durationSeconds: 12,
    audio: null,
    photos: [],
  };
  return {
    id,
    body,
    audio: null,
    photos: [],
    createdAt: Date.now(),
    ...overrides,
  };
}

// In-memory fake PendingStore — a Map keyed by id, mirroring the real
// IndexedDB-backed store's contract without touching IndexedDB.
function fakeStore(initial: PendingSave[]): PendingStore & { remaining: () => PendingSave[] } {
  const map = new Map(initial.map((r) => [r.id, r]));
  return {
    async put(rec) {
      map.set(rec.id, rec);
    },
    async getAll() {
      return [...map.values()];
    },
    async delete(id) {
      map.delete(id);
    },
    remaining: () => [...map.values()],
  };
}

const noopUpload: ClientUploadFn = async () => ({ url: "https://blob.example/unused" });

function depsWith(overrides: Partial<RetryDeps>): RetryDeps {
  const uploadBlobs: RetryDeps["uploadBlobs"] = async (): Promise<EntryUploadResult> => ({
    audio: null,
    photos: [],
  });
  const postSave: RetryDeps["postSave"] = async () => ({ ok: true, status: 201 });
  return { uploadBlobs, upload: noopUpload, postSave, ...overrides };
}

describe("retryPending", () => {
  it("re-uploads blobs, re-POSTs, and deletes the record on 201", async () => {
    const store = fakeStore([makeRecord("01A")]);
    const postCalls: SaveRequestBody[] = [];
    const uploadCalls: EntryUploadInput[] = [];
    const deps = depsWith({
      uploadBlobs: async (input) => {
        uploadCalls.push(input);
        return { audio: { pathname: "audio/01A.webm", mime: "audio/webm", bytes: 10, complete: true }, photos: [] };
      },
      postSave: async (body) => {
        postCalls.push(body);
        return { ok: true, status: 201 };
      },
    });

    const result = await retryPending(store, deps);

    expect(result).toEqual({ recovered: 1 });
    expect(uploadCalls).toHaveLength(1);
    expect(uploadCalls[0].entryId).toBe("01A");
    expect(postCalls).toHaveLength(1);
    expect(postCalls[0].id).toBe("01A");
    expect(postCalls[0].audio).toEqual({
      pathname: "audio/01A.webm",
      mime: "audio/webm",
      bytes: 10,
      complete: true,
    });
    expect(store.remaining()).toEqual([]);
  });

  it("keeps the record when postSave rejects (network error)", async () => {
    const store = fakeStore([makeRecord("01B")]);
    const deps = depsWith({
      postSave: async () => {
        throw new Error("network down");
      },
    });

    const result = await retryPending(store, deps);

    expect(result).toEqual({ recovered: 0 });
    expect(store.remaining().map((r) => r.id)).toEqual(["01B"]);
  });

  it("keeps the record on a 5xx response", async () => {
    const store = fakeStore([makeRecord("01C")]);
    const deps = depsWith({
      postSave: async () => ({ ok: false, status: 500 }),
    });

    const result = await retryPending(store, deps);

    expect(result).toEqual({ recovered: 0 });
    expect(store.remaining().map((r) => r.id)).toEqual(["01C"]);
  });

  it("deletes an already-landed record without duplicating the POST", async () => {
    // Simulates a save that landed in the DB but whose 201 ack never reached
    // the client (tab died mid-response). The re-POST hits the idempotent
    // ON CONFLICT insert and comes back 201 — same as a fresh save from
    // retryPending's point of view, deleted with no duplicate row.
    const store = fakeStore([makeRecord("01D")]);
    let postCount = 0;
    const deps = depsWith({
      postSave: async () => {
        postCount += 1;
        return { ok: true, status: 201 };
      },
    });

    const result = await retryPending(store, deps);

    expect(postCount).toBe(1);
    expect(result).toEqual({ recovered: 1 });
    expect(store.remaining()).toEqual([]);
  });

  it("handles multiple records with mixed outcomes", async () => {
    const store = fakeStore([makeRecord("01E"), makeRecord("01F"), makeRecord("01G")]);
    const deps = depsWith({
      postSave: async (body) => {
        if (body.id === "01E") return { ok: true, status: 201 };
        if (body.id === "01F") return { ok: false, status: 500 };
        throw new Error("offline");
      },
    });

    const result = await retryPending(store, deps);

    expect(result).toEqual({ recovered: 1 });
    expect(store.remaining().map((r) => r.id).sort()).toEqual(["01F", "01G"]);
  });

  it("keeps the record when the blob re-upload itself throws", async () => {
    const store = fakeStore([makeRecord("01H")]);
    let postCalled = false;
    const deps = depsWith({
      uploadBlobs: async () => {
        throw new Error("photo blob rejected");
      },
      postSave: async () => {
        postCalled = true;
        return { ok: true, status: 201 };
      },
    });

    const result = await retryPending(store, deps);

    expect(result).toEqual({ recovered: 0 });
    expect(postCalled).toBe(false);
    expect(store.remaining().map((r) => r.id)).toEqual(["01H"]);
  });

  it("returns recovered: 0 for an empty store", async () => {
    const store = fakeStore([]);
    const result = await retryPending(store, depsWith({}));
    expect(result).toEqual({ recovered: 0 });
  });
});
