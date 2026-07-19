// Route-level tests: mock the lib layers, call the handler with a constructed
// Request + Next 16 promised params, assert status + JSON.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth-server", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/db", () => ({ restoreEntry: vi.fn() }));

import { POST } from "./route";
import { getServerSession } from "@/lib/auth-server";
import { restoreEntry } from "@/lib/db";

const mockSession = vi.mocked(getServerSession);
const mockRestore = vi.mocked(restoreEntry);

const call = (id: string) =>
  POST(new Request(`http://test/api/entries/${id}/restore`, { method: "POST" }), {
    params: Promise.resolve({ id }),
  });

beforeEach(() => {
  vi.clearAllMocks();
  mockSession.mockResolvedValue({} as never);
});

describe("POST /api/entries/[id]/restore", () => {
  it("401s without a session", async () => {
    mockSession.mockResolvedValue(null as never);
    const res = await call("e1");
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
    expect(mockRestore).not.toHaveBeenCalled();
  });

  it("restores a trashed entry", async () => {
    mockRestore.mockResolvedValue(true);
    const res = await call("e1");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ restored: "e1" });
    expect(mockRestore).toHaveBeenCalledWith("e1");
  });

  it("404s for an unknown or not-trashed id", async () => {
    mockRestore.mockResolvedValue(false);
    const res = await call("nope");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Not found" });
  });

  it("500s with detail when restore throws", async () => {
    mockRestore.mockRejectedValue(new Error("boom"));
    const res = await call("e1");
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("Restore failed");
    expect(body.detail).toContain("boom");
  });
});
