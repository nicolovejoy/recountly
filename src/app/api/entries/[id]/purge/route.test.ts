// Route-level tests: mock the lib layers, call the handler with a constructed
// Request + Next 16 promised params, assert status + JSON.
//
// The purge invariant ("purge only ever targets already-trashed rows") lives
// in @/lib/purge; the route's job is to delegate to it and never touch the
// hard-delete db helpers itself — the db mock below proves that.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth-server", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/purge", () => ({ purgeTrashedEntry: vi.fn() }));
// If the route ever imported delete helpers directly, these spies would catch it.
vi.mock("@/lib/db", () => ({
  deleteEntry: vi.fn(),
  deletePhotosByEntry: vi.fn(),
  deleteEntryMovesByEntry: vi.fn(),
}));

import { DELETE } from "./route";
import { getServerSession } from "@/lib/auth-server";
import { purgeTrashedEntry } from "@/lib/purge";
import { deleteEntry, deletePhotosByEntry, deleteEntryMovesByEntry } from "@/lib/db";

const mockSession = vi.mocked(getServerSession);
const mockPurge = vi.mocked(purgeTrashedEntry);

const call = (id: string) =>
  DELETE(new Request(`http://test/api/entries/${id}/purge`, { method: "DELETE" }), {
    params: Promise.resolve({ id }),
  });

beforeEach(() => {
  vi.clearAllMocks();
  mockSession.mockResolvedValue({} as never);
});

describe("DELETE /api/entries/[id]/purge", () => {
  it("401s without a session", async () => {
    mockSession.mockResolvedValue(null as never);
    const res = await call("e1");
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
    expect(mockPurge).not.toHaveBeenCalled();
  });

  it("purges a trashed entry", async () => {
    mockPurge.mockResolvedValue("purged");
    const res = await call("e1");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ purged: "e1" });
    expect(mockPurge).toHaveBeenCalledWith("e1");
  });

  it("404s for an unknown id", async () => {
    mockPurge.mockResolvedValue("not_found");
    const res = await call("nope");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Not found" });
  });

  it("409s for a live (not-trashed) id and performs no deletes", async () => {
    mockPurge.mockResolvedValue("not_trashed");
    const res = await call("live");
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "Entry is not in the trash" });
    // The lib guard returned before deleting; the route itself must never
    // reach for the hard-delete helpers.
    expect(deleteEntry).not.toHaveBeenCalled();
    expect(deletePhotosByEntry).not.toHaveBeenCalled();
    expect(deleteEntryMovesByEntry).not.toHaveBeenCalled();
  });

  it("never calls the hard-delete helpers directly even on success (moved-then-purged included)", async () => {
    mockPurge.mockResolvedValue("purged");
    await call("e1");
    expect(deleteEntry).not.toHaveBeenCalled();
    expect(deletePhotosByEntry).not.toHaveBeenCalled();
    expect(deleteEntryMovesByEntry).not.toHaveBeenCalled();
  });

  it("500s with detail when purge throws", async () => {
    mockPurge.mockRejectedValue(new Error("boom"));
    const res = await call("e1");
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("Purge failed");
    expect(body.detail).toContain("boom");
  });
});
