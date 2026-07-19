// First route-level integration tests in the repo. Pattern: vi.mock the lib
// modules the route leans on, call the exported handlers with constructed
// Requests, assert status + JSON. No server, no DB.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth-server", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/db", () => ({ listTrashedEntries: vi.fn() }));
vi.mock("@/lib/purge", () => ({ emptyTrash: vi.fn() }));

import { GET, DELETE } from "./route";
import { getServerSession } from "@/lib/auth-server";
import { listTrashedEntries } from "@/lib/db";
import { emptyTrash } from "@/lib/purge";

const mockSession = vi.mocked(getServerSession);
const mockList = vi.mocked(listTrashedEntries);
const mockEmpty = vi.mocked(emptyTrash);

beforeEach(() => {
  vi.clearAllMocks();
  mockSession.mockResolvedValue({} as never); // authed unless a test says otherwise
});

describe("GET /api/entries/trash", () => {
  it("401s without a session", async () => {
    mockSession.mockResolvedValue(null as never);
    const res = await GET();
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
    expect(mockList).not.toHaveBeenCalled();
  });

  it("lists trashed entries", async () => {
    const entries = [{ id: "e1" }, { id: "e2" }];
    mockList.mockResolvedValue(entries as never);
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ entries });
  });

  it("500s with detail when the list throws", async () => {
    mockList.mockRejectedValue(new Error("boom"));
    const res = await GET();
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("Failed to list trash");
    expect(body.detail).toContain("boom");
  });
});

describe("DELETE /api/entries/trash", () => {
  it("401s without a session", async () => {
    mockSession.mockResolvedValue(null as never);
    const res = await DELETE();
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
    expect(mockEmpty).not.toHaveBeenCalled();
  });

  it("empties the trash and reports the count", async () => {
    mockEmpty.mockResolvedValue(3);
    const res = await DELETE();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ purged: 3 });
  });

  it("500s with detail when emptyTrash throws", async () => {
    mockEmpty.mockRejectedValue(new Error("boom"));
    const res = await DELETE();
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("Empty trash failed");
    expect(body.detail).toContain("boom");
  });
});
