// Route tests for journal management (PR A): mock the lib layers, call the
// handler with a constructed Request + Next 16 promised params, assert
// status + JSON. House pattern (src/app/api/entries/[id]/route.test.ts).

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth-server", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/db", () => ({
  getJournal: vi.fn(),
  updateJournal: vi.fn(),
  countJournalEntries: vi.fn(),
  deleteJournal: vi.fn(),
}));

import { PATCH, DELETE } from "./route";
import { getServerSession } from "@/lib/auth-server";
import { getJournal, updateJournal, countJournalEntries, deleteJournal } from "@/lib/db";

const mockSession = vi.mocked(getServerSession);
const mockGetJournal = vi.mocked(getJournal);
const mockUpdateJournal = vi.mocked(updateJournal);
const mockCountJournalEntries = vi.mocked(countJournalEntries);
const mockDeleteJournal = vi.mocked(deleteJournal);

const callPatch = (id: string, body: unknown) =>
  PATCH(
    new Request(`http://test/api/journals/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) },
  );

const callDelete = (id: string) =>
  DELETE(new Request(`http://test/api/journals/${id}`, { method: "DELETE" }), {
    params: Promise.resolve({ id }),
  });

const journal = { id: "01JRNL", label: "Red notebook" } as never;

beforeEach(() => {
  vi.clearAllMocks();
  mockSession.mockResolvedValue({} as never);
});

describe("PATCH /api/journals/[id]", () => {
  it("401s without a session and never touches the db", async () => {
    mockSession.mockResolvedValue(null as never);
    const res = await callPatch("01JRNL", { label: "New label" });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
    expect(mockUpdateJournal).not.toHaveBeenCalled();
  });

  it("400s on a non-JSON body", async () => {
    const res = await PATCH(
      new Request("http://test/api/journals/01JRNL", { method: "PATCH", body: "not json" }),
      { params: Promise.resolve({ id: "01JRNL" }) },
    );
    expect(res.status).toBe(400);
    expect(mockUpdateJournal).not.toHaveBeenCalled();
  });

  it("400s on an empty patch", async () => {
    const res = await callPatch("01JRNL", {});
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.problems).toContain("at least one field is required");
    expect(mockUpdateJournal).not.toHaveBeenCalled();
  });

  it("400s on an invalid patch (bad kind)", async () => {
    const res = await callPatch("01JRNL", { kind: "nope" });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.problems).toContain('kind must be "archive" or null');
    expect(mockUpdateJournal).not.toHaveBeenCalled();
  });

  it("404s for an unknown journal (updateJournal returns null)", async () => {
    mockUpdateJournal.mockResolvedValue(null);
    const res = await callPatch("nope", { label: "New label" });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Not found" });
  });

  it("200s with the updated journal", async () => {
    mockUpdateJournal.mockResolvedValue(journal);
    const res = await callPatch("01JRNL", { label: "New label" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ journal });
    expect(mockUpdateJournal).toHaveBeenCalledWith("01JRNL", { label: "New label" });
  });

  it("500s with detail when updateJournal throws", async () => {
    mockUpdateJournal.mockRejectedValue(new Error("boom"));
    const res = await callPatch("01JRNL", { label: "New label" });
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("Failed to update journal");
    expect(body.detail).toContain("boom");
  });
});

describe("DELETE /api/journals/[id]", () => {
  it("401s without a session and never touches the db", async () => {
    mockSession.mockResolvedValue(null as never);
    const res = await callDelete("01JRNL");
    expect(res.status).toBe(401);
    expect(mockGetJournal).not.toHaveBeenCalled();
  });

  it("404s for an unknown journal", async () => {
    mockGetJournal.mockResolvedValue(null);
    const res = await callDelete("nope");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Not found" });
    expect(mockCountJournalEntries).not.toHaveBeenCalled();
  });

  it("409s with counts when the journal still has live entries", async () => {
    mockGetJournal.mockResolvedValue(journal);
    mockCountJournalEntries.mockResolvedValue({ total: 3, trashed: 0 });
    const res = await callDelete("01JRNL");
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.entryCount).toBe(3);
    expect(body.trashedCount).toBe(0);
    expect(body.error).toContain("3 entries");
    expect(body.error).not.toContain("trash");
    expect(mockDeleteJournal).not.toHaveBeenCalled();
  });

  it("409s and mentions trash when the only blockers are trashed entries (the confusing case)", async () => {
    mockGetJournal.mockResolvedValue(journal);
    mockCountJournalEntries.mockResolvedValue({ total: 2, trashed: 2 });
    const res = await callDelete("01JRNL");
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.entryCount).toBe(2);
    expect(body.trashedCount).toBe(2);
    expect(body.error.toLowerCase()).toContain("trash");
    expect(mockDeleteJournal).not.toHaveBeenCalled();
  });

  it("409s and mentions trash when live AND trashed entries both remain", async () => {
    mockGetJournal.mockResolvedValue(journal);
    mockCountJournalEntries.mockResolvedValue({ total: 5, trashed: 2 });
    const res = await callDelete("01JRNL");
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.toLowerCase()).toContain("trash");
    expect(body.error).toContain("3"); // 5 total - 2 trashed = 3 live
    expect(mockDeleteJournal).not.toHaveBeenCalled();
  });

  it("deletes an empty journal (0 total entries)", async () => {
    mockGetJournal.mockResolvedValue(journal);
    mockCountJournalEntries.mockResolvedValue({ total: 0, trashed: 0 });
    mockDeleteJournal.mockResolvedValue(true);
    const res = await callDelete("01JRNL");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(mockDeleteJournal).toHaveBeenCalledWith("01JRNL");
  });

  it("checks existence, then the entry count, then deletes — in that order", async () => {
    mockGetJournal.mockResolvedValue(journal);
    mockCountJournalEntries.mockResolvedValue({ total: 0, trashed: 0 });
    mockDeleteJournal.mockResolvedValue(true);
    await callDelete("01JRNL");
    const getOrder = mockGetJournal.mock.invocationCallOrder[0];
    const countOrder = mockCountJournalEntries.mock.invocationCallOrder[0];
    const deleteOrder = mockDeleteJournal.mock.invocationCallOrder[0];
    expect(getOrder).toBeLessThan(countOrder);
    expect(countOrder).toBeLessThan(deleteOrder);
  });

  it("404s when deleteJournal finds no live row (race)", async () => {
    mockGetJournal.mockResolvedValue(journal);
    mockCountJournalEntries.mockResolvedValue({ total: 0, trashed: 0 });
    mockDeleteJournal.mockResolvedValue(false);
    const res = await callDelete("01JRNL");
    expect(res.status).toBe(404);
  });

  it("409s (not 500) on a racing FK violation during delete", async () => {
    mockGetJournal.mockResolvedValue(journal);
    mockCountJournalEntries.mockResolvedValue({ total: 0, trashed: 0 });
    mockDeleteJournal.mockRejectedValue(new Error('violates foreign key constraint "entries_journal_id_fkey"'));
    const res = await callDelete("01JRNL");
    expect(res.status).toBe(409);
  });

  it("500s with detail on any other error", async () => {
    mockGetJournal.mockResolvedValue(journal);
    mockCountJournalEntries.mockRejectedValue(new Error("boom"));
    const res = await callDelete("01JRNL");
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("Delete failed");
    expect(body.detail).toContain("boom");
  });
});
