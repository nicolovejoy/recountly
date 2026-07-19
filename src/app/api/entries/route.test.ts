// Route tests for /api/entries. House pattern: vi.mock auth + db, constructed
// Requests. GET (issue #29) asserts the query string → searchEntries mapping.
// POST (issue #23) now consumes the JSON save contract (blobs already uploaded
// client-direct) and runs enrichment in after() off the response path — these
// tests assert the synchronous 201 path; after() scheduling is captured so the
// enrichment wiring can be exercised without asserting scheduling semantics.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth-server", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/db", () => ({
  insertEntry: vi.fn(),
  insertPhoto: vi.fn(),
  searchEntries: vi.fn(),
  getJournal: vi.fn(),
  updateEntryEnrichment: vi.fn(),
}));
vi.mock("@/lib/enrich", () => ({ enrichTranscript: vi.fn() }));
vi.mock("@/lib/anthropic", () => ({ getAnthropic: vi.fn(() => ({})) }));

// Capture after() callbacks instead of running them — the 201 must not wait on
// enrichment. Tests that want the wiring drain afterCallbacks manually.
const afterCallbacks: Array<() => unknown | Promise<unknown>> = [];
vi.mock("next/server", () => ({
  after: (fn: () => unknown | Promise<unknown>) => {
    afterCallbacks.push(fn);
  },
}));

import { GET, POST } from "./route";
import { getServerSession } from "@/lib/auth-server";
import {
  searchEntries,
  insertEntry,
  insertPhoto,
  getJournal,
  updateEntryEnrichment,
} from "@/lib/db";
import { enrichTranscript } from "@/lib/enrich";

const mockSession = vi.mocked(getServerSession);
const mockSearch = vi.mocked(searchEntries);
const mockInsertEntry = vi.mocked(insertEntry);
const mockInsertPhoto = vi.mocked(insertPhoto);
const mockGetJournal = vi.mocked(getJournal);
const mockUpdateEnrichment = vi.mocked(updateEntryEnrichment);
const mockEnrich = vi.mocked(enrichTranscript);

beforeEach(() => {
  vi.clearAllMocks();
  afterCallbacks.length = 0;
  mockSession.mockResolvedValue({} as never); // authed unless a test says otherwise
  mockSearch.mockResolvedValue([] as never);
  mockInsertEntry.mockResolvedValue(undefined as never);
  mockInsertPhoto.mockResolvedValue(undefined as never);
  mockGetJournal.mockResolvedValue({ id: "J" } as never);
  mockUpdateEnrichment.mockResolvedValue(undefined as never);
  mockEnrich.mockResolvedValue(null as never);
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

// Helper: a POST Request carrying a JSON body.
function jsonPost(body: unknown): Request {
  return new Request("http://localhost/api/entries", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const validBody = {
  id: "entry_1",
  transcript: "hello world",
  durationSeconds: 12,
  audio: null,
  photos: [] as unknown[],
};

describe("POST /api/entries", () => {
  it("401s without a session and never inserts", async () => {
    mockSession.mockResolvedValue(null as never);
    const res = await POST(jsonPost(validBody));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
    expect(mockInsertEntry).not.toHaveBeenCalled();
  });

  it("400s when the body is not JSON", async () => {
    const req = new Request("http://localhost/api/entries", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "not json{",
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Expected application/json" });
    expect(mockInsertEntry).not.toHaveBeenCalled();
  });

  it("400s with problems on a bad body (missing id)", async () => {
    const { id: _omit, ...noId } = validBody;
    void _omit;
    const res = await POST(jsonPost(noId));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Invalid entry");
    expect(Array.isArray(body.problems)).toBe(true);
    expect(mockInsertEntry).not.toHaveBeenCalled();
  });

  it("400s with problems on a bad photo ref", async () => {
    const res = await POST(
      jsonPost({
        ...validBody,
        photos: [{ id: "p1", pathname: "photos/p1.jpg", mime: "text/plain", bytes: 10 }],
      }),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Invalid entry");
    expect(mockInsertEntry).not.toHaveBeenCalled();
  });

  it("400s Unknown journal when journalId misses (never inserts)", async () => {
    mockGetJournal.mockResolvedValue(null as never);
    const res = await POST(jsonPost({ ...validBody, journalId: "ghost" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Unknown journal" });
    expect(mockInsertEntry).not.toHaveBeenCalled();
  });

  it("201 happy path: inserts with the client id + null audioUrl, returns entry", async () => {
    const res = await POST(jsonPost(validBody));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.entry.id).toBe("entry_1");
    expect(body.entry.transcript).toBe("hello world");
    expect(body.entry.audioUrl).toBeNull();
    // Enrichment is deferred to after() — the inserted row has empty enrichment.
    expect(body.entry.title).toBeNull();
    expect(body.entry.enrichedAt).toBeNull();
    expect(body.photos).toEqual([]);
    expect(mockInsertEntry).toHaveBeenCalledTimes(1);
    expect(mockInsertEntry.mock.calls[0][0]).toMatchObject({
      id: "entry_1",
      audioUrl: null,
    });
    expect(mockInsertPhoto).not.toHaveBeenCalled();
  });

  it("201 with audio ref: audioUrl = /api/audio/<id>", async () => {
    const res = await POST(
      jsonPost({
        ...validBody,
        audio: { pathname: "audio/entry_1.webm", mime: "audio/webm", bytes: 4096, complete: true },
      }),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.entry.audioUrl).toBe("/api/audio/entry_1");
    expect(body.entry.audioMime).toBe("audio/webm");
    expect(body.entry.audioBytes).toBe(4096);
    expect(body.entry.audioComplete).toBe(true);
  });

  it("201 with photos: inserts one photo row each, returns proxy paths", async () => {
    const res = await POST(
      jsonPost({
        ...validBody,
        photos: [
          { id: "p1", pathname: "photos/p1.jpg", mime: "image/jpeg", bytes: 1000 },
          { id: "p2", pathname: "photos/p2.jpg", mime: "image/jpeg", bytes: 2000 },
        ],
      }),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.photos).toEqual([
      { id: "p1", url: "/api/photo/p1" },
      { id: "p2", url: "/api/photo/p2" },
    ]);
    expect(mockInsertPhoto).toHaveBeenCalledTimes(2);
    expect(mockInsertPhoto.mock.calls[0][0]).toMatchObject({
      id: "p1",
      entryId: "entry_1",
      mime: "image/jpeg",
      bytes: 1000,
    });
  });

  it("500s with detail when insertEntry throws", async () => {
    mockInsertEntry.mockRejectedValue(new Error("db down"));
    const res = await POST(jsonPost(validBody));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("Failed to save entry");
    expect(body.detail).toContain("db down");
  });

  it("does not run enrichment on the request path (deferred to after)", async () => {
    await POST(jsonPost(validBody));
    // enrichment scheduled, not awaited before the 201.
    expect(mockEnrich).not.toHaveBeenCalled();
    expect(afterCallbacks).toHaveLength(1);
  });

  it("the deferred after() callback enriches and updates the row (best-effort)", async () => {
    mockEnrich.mockResolvedValue({
      title: "T",
      tags: ["a"],
      summary: "S",
      model: "claude-haiku-4-5",
    } as never);
    await POST(jsonPost(validBody));
    expect(afterCallbacks).toHaveLength(1);
    await afterCallbacks[0]();
    expect(mockEnrich).toHaveBeenCalledWith("hello world", expect.anything());
    expect(mockUpdateEnrichment).toHaveBeenCalledTimes(1);
    expect(mockUpdateEnrichment.mock.calls[0][0]).toBe("entry_1");
  });

  it("a null enrichment result skips the row update (no throw)", async () => {
    mockEnrich.mockResolvedValue(null as never);
    await POST(jsonPost(validBody));
    await afterCallbacks[0]();
    expect(mockUpdateEnrichment).not.toHaveBeenCalled();
  });
});
