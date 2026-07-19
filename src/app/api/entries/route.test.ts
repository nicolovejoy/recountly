// Route tests for GET /api/entries (issue #29 — first coverage for this
// route, GET only; POST's orchestration is covered by lib tests + the smoke
// checklist). House pattern: vi.mock auth + db, constructed Requests. The
// real parseSearchFilters runs — the point is asserting what the query
// string turns into by the time it reaches searchEntries.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth-server", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/db", () => ({
  insertEntry: vi.fn(),
  insertPhoto: vi.fn(),
  searchEntries: vi.fn(),
  getJournal: vi.fn(),
}));

import { GET } from "./route";
import { getServerSession } from "@/lib/auth-server";
import { searchEntries } from "@/lib/db";

const mockSession = vi.mocked(getServerSession);
const mockSearch = vi.mocked(searchEntries);

beforeEach(() => {
  vi.clearAllMocks();
  mockSession.mockResolvedValue({} as never); // authed unless a test says otherwise
  mockSearch.mockResolvedValue([] as never);
});

describe("GET /api/entries", () => {
  it("401s without a session and never queries", async () => {
    mockSession.mockResolvedValue(null as never);
    const res = await GET(new Request("http://localhost/api/entries"));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
    expect(mockSearch).not.toHaveBeenCalled();
  });

  it("passes journal + sort + limit through to searchEntries", async () => {
    const entries = [{ id: "e1" }];
    mockSearch.mockResolvedValue(entries as never);
    const res = await GET(
      new Request("http://localhost/api/entries?journal=X&sort=reading&limit=200"),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ entries });
    expect(mockSearch).toHaveBeenCalledWith({
      journalId: "X",
      sort: "reading",
      limit: 200,
    });
  });

  it("bare GET passes empty filters (newest-first list)", async () => {
    const res = await GET(new Request("http://localhost/api/entries"));
    expect(res.status).toBe(200);
    expect(mockSearch).toHaveBeenCalledWith({});
  });

  it("500s with detail when the query throws", async () => {
    mockSearch.mockRejectedValue(new Error("boom"));
    const res = await GET(new Request("http://localhost/api/entries"));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("Failed to list entries");
    expect(body.detail).toContain("boom");
  });
});
