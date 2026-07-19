// Route-level tests: mock the lib layers, call the handler with a constructed
// Request + Next 16 promised params, assert status + JSON.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth-server", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/db", () => ({
  softDeleteEntry: vi.fn(),
  getEntry: vi.fn(),
  getJournal: vi.fn(),
  moveEntry: vi.fn(),
}));

import { DELETE, PATCH } from "./route";
import { getServerSession } from "@/lib/auth-server";
import { softDeleteEntry, getEntry, getJournal, moveEntry } from "@/lib/db";

const mockSession = vi.mocked(getServerSession);
const mockSoftDelete = vi.mocked(softDeleteEntry);
const mockGetEntry = vi.mocked(getEntry);
const mockGetJournal = vi.mocked(getJournal);
const mockMove = vi.mocked(moveEntry);

const callDelete = (id: string) =>
  DELETE(new Request(`http://test/api/entries/${id}`, { method: "DELETE" }), {
    params: Promise.resolve({ id }),
  });

const callPatch = (id: string, body: unknown) =>
  PATCH(
    new Request(`http://test/api/entries/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) },
  );

const liveEntry = (journalId: string | null) =>
  ({ id: "e1", journalId, deletedAt: undefined }) as never;

beforeEach(() => {
  vi.clearAllMocks();
  mockSession.mockResolvedValue({} as never);
});

describe("DELETE /api/entries/[id]", () => {
  it("401s without a session", async () => {
    mockSession.mockResolvedValue(null as never);
    const res = await callDelete("e1");
    expect(res.status).toBe(401);
    expect(mockSoftDelete).not.toHaveBeenCalled();
  });

  it("trashes a live entry", async () => {
    mockSoftDelete.mockResolvedValue(true);
    const res = await callDelete("e1");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ trashed: "e1" });
  });

  it("404s for an unknown id", async () => {
    mockSoftDelete.mockResolvedValue(false);
    const res = await callDelete("nope");
    expect(res.status).toBe(404);
  });

  it("500s with detail when softDeleteEntry throws", async () => {
    mockSoftDelete.mockRejectedValue(new Error("boom"));
    const res = await callDelete("e1");
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.detail).toContain("boom");
  });
});

describe("PATCH /api/entries/[id] (move, issue #28)", () => {
  it("401s without a session", async () => {
    mockSession.mockResolvedValue(null as never);
    const res = await callPatch("e1", { journalId: "01J" });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
    expect(mockGetEntry).not.toHaveBeenCalled();
  });

  it("400s on a non-JSON body", async () => {
    const res = await PATCH(
      new Request("http://test/api/entries/e1", { method: "PATCH", body: "not json" }),
      { params: Promise.resolve({ id: "e1" }) },
    );
    expect(res.status).toBe(400);
  });

  it("400s when journalId is neither a string nor null", async () => {
    const res = await callPatch("e1", { journalId: 42 });
    expect(res.status).toBe(400);
    expect(mockGetEntry).not.toHaveBeenCalled();
  });

  it("404s for an unknown entry id", async () => {
    mockGetEntry.mockResolvedValue(null);
    const res = await callPatch("nope", { journalId: "01J" });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Not found" });
    expect(mockMove).not.toHaveBeenCalled();
  });

  it("404s for a trashed entry", async () => {
    mockGetEntry.mockResolvedValue({
      id: "e1",
      journalId: null,
      deletedAt: "2026-07-19T00:00:00.000Z",
    } as never);
    const res = await callPatch("e1", { journalId: "01J" });
    expect(res.status).toBe(404);
    expect(mockMove).not.toHaveBeenCalled();
  });

  it("400s for an unknown target journal", async () => {
    mockGetEntry.mockResolvedValue(liveEntry(null));
    mockGetJournal.mockResolvedValue(null);
    const res = await callPatch("e1", { journalId: "01NOPE" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Unknown journal" });
    expect(mockMove).not.toHaveBeenCalled();
  });

  it("moves an entry from one journal to another", async () => {
    mockGetEntry.mockResolvedValue(liveEntry("01OLD"));
    mockGetJournal.mockResolvedValue({ id: "01NEW" } as never);
    mockMove.mockResolvedValue(true);
    const res = await callPatch("e1", { journalId: "01NEW" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ moved: "e1", journalId: "01NEW" });
    expect(mockMove).toHaveBeenCalledWith("e1", "01NEW");
  });

  it("moves an entry to Unfiled (journalId: null)", async () => {
    mockGetEntry.mockResolvedValue(liveEntry("01OLD"));
    mockMove.mockResolvedValue(true);
    const res = await callPatch("e1", { journalId: null });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ moved: "e1", journalId: null });
    expect(mockGetJournal).not.toHaveBeenCalled();
    expect(mockMove).toHaveBeenCalledWith("e1", null);
  });

  it("moves an entry out of Unfiled into a journal", async () => {
    mockGetEntry.mockResolvedValue(liveEntry(null));
    mockGetJournal.mockResolvedValue({ id: "01NEW" } as never);
    mockMove.mockResolvedValue(true);
    const res = await callPatch("e1", { journalId: "01NEW" });
    expect(res.status).toBe(200);
    expect(mockMove).toHaveBeenCalledWith("e1", "01NEW");
  });

  it("no-ops a same-journal move: 200, no log write", async () => {
    mockGetEntry.mockResolvedValue(liveEntry("01SAME"));
    mockGetJournal.mockResolvedValue({ id: "01SAME" } as never);
    const res = await callPatch("e1", { journalId: "01SAME" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ moved: "e1", journalId: "01SAME" });
    expect(mockMove).not.toHaveBeenCalled();
  });

  it("no-ops staying Unfiled without calling getJournal or moveEntry", async () => {
    mockGetEntry.mockResolvedValue(liveEntry(null));
    const res = await callPatch("e1", { journalId: null });
    expect(res.status).toBe(200);
    expect(mockGetJournal).not.toHaveBeenCalled();
    expect(mockMove).not.toHaveBeenCalled();
  });

  it("404s when moveEntry finds no live row (race with a concurrent trash)", async () => {
    mockGetEntry.mockResolvedValue(liveEntry("01OLD"));
    mockGetJournal.mockResolvedValue({ id: "01NEW" } as never);
    mockMove.mockResolvedValue(false);
    const res = await callPatch("e1", { journalId: "01NEW" });
    expect(res.status).toBe(404);
  });

  it("500s with detail when getEntry throws", async () => {
    mockGetEntry.mockRejectedValue(new Error("boom"));
    const res = await callPatch("e1", { journalId: "01NEW" });
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("Move failed");
    expect(body.detail).toContain("boom");
  });
});
