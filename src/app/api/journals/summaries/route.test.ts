// Route tests for GET /api/journals/summaries (issue #29). House pattern
// (src/app/api/entries/trash/route.test.ts): vi.mock auth + db, call the
// handler, assert status + JSON. No server, no DB.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth-server", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/db", () => ({
  listJournalSummaries: vi.fn(),
  countUnfiledEntries: vi.fn(),
}));

import { GET } from "./route";
import { getServerSession } from "@/lib/auth-server";
import { listJournalSummaries, countUnfiledEntries } from "@/lib/db";

const mockSession = vi.mocked(getServerSession);
const mockSummaries = vi.mocked(listJournalSummaries);
const mockUnfiled = vi.mocked(countUnfiledEntries);

beforeEach(() => {
  vi.clearAllMocks();
  mockSession.mockResolvedValue({} as never); // authed unless a test says otherwise
});

describe("GET /api/journals/summaries", () => {
  it("401s without a session and never touches the db", async () => {
    mockSession.mockResolvedValue(null as never);
    const res = await GET();
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
    expect(mockSummaries).not.toHaveBeenCalled();
    expect(mockUnfiled).not.toHaveBeenCalled();
  });

  it("returns journals + unfiledCount", async () => {
    const journals = [
      {
        id: "j1",
        label: "Red notebook",
        active: true,
        createdAt: "2026-01-01T00:00:00.000Z",
        entryCount: 2,
        firstEntryAt: "1994-03-01T00:00:00.000Z",
        lastEntryAt: "1995-06-01T00:00:00.000Z",
      },
    ];
    mockSummaries.mockResolvedValue(journals as never);
    mockUnfiled.mockResolvedValue(23);
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ journals, unfiledCount: 23 });
  });

  it("500s with detail when the summaries query throws", async () => {
    mockSummaries.mockRejectedValue(new Error("summaries boom"));
    mockUnfiled.mockResolvedValue(0);
    const res = await GET();
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("Failed to list journal summaries");
    expect(body.detail).toContain("summaries boom");
  });

  it("500s with detail when the unfiled count throws", async () => {
    mockSummaries.mockResolvedValue([] as never);
    mockUnfiled.mockRejectedValue(new Error("count boom"));
    const res = await GET();
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("Failed to list journal summaries");
    expect(body.detail).toContain("count boom");
  });
});
