// Route-level integration tests (issue #41 — the entry-card audio player
// showed 0:00/0:00 until play; iOS Safari probes an <audio> element's
// duration via byte-range requests, which this proxy didn't answer).
// Pattern: vi.mock the libs the route leans on, call the exported handler
// with constructed Requests, assert status + headers + body.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth-server", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/db", () => ({ getEntry: vi.fn() }));
vi.mock("@vercel/blob", () => ({ get: vi.fn() }));

import { GET } from "./route";
import { getServerSession } from "@/lib/auth-server";
import { getEntry } from "@/lib/db";
import { get } from "@vercel/blob";

const mockSession = vi.mocked(getServerSession);
const mockGetEntry = vi.mocked(getEntry);
const mockGet = vi.mocked(get);

function streamOf(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

const AUDIO_BYTES = new Uint8Array([10, 11, 12, 13, 14, 15, 16, 17, 18, 19]); // size 10

function blobResult(bytes: Uint8Array = AUDIO_BYTES) {
  return {
    statusCode: 200 as const,
    stream: streamOf(bytes),
    headers: new Headers(),
    blob: {
      url: "https://example.blob.vercel-storage.com/audio/e1.webm",
      downloadUrl: "https://example.blob.vercel-storage.com/audio/e1.webm?download=1",
      pathname: "audio/e1.webm",
      contentDisposition: "",
      cacheControl: "",
      uploadedAt: new Date(),
      etag: "etag",
      contentType: "audio/webm",
      size: bytes.length,
    },
  };
}

function req(headers?: Record<string, string>) {
  return new Request("http://localhost/api/audio/e1", { headers });
}

function params(id = "e1") {
  return { params: Promise.resolve({ id }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockSession.mockResolvedValue({} as never); // authed unless a test says otherwise
  mockGetEntry.mockResolvedValue({ id: "e1", audioMime: "audio/webm" } as never);
  mockGet.mockResolvedValue(blobResult() as never);
});

describe("GET /api/audio/[id]", () => {
  it("401s without a session and never looks up the entry", async () => {
    mockSession.mockResolvedValue(null as never);
    const res = await GET(req(), params());
    expect(res.status).toBe(401);
    expect(mockGetEntry).not.toHaveBeenCalled();
  });

  it("404s when the entry doesn't exist", async () => {
    mockGetEntry.mockResolvedValue(null as never);
    const res = await GET(req(), params());
    expect(res.status).toBe(404);
  });

  it("404s when the entry has no audio", async () => {
    mockGetEntry.mockResolvedValue({ id: "e1", audioMime: null } as never);
    const res = await GET(req(), params());
    expect(res.status).toBe(404);
  });

  it("404s when the blob lookup returns null", async () => {
    mockGet.mockResolvedValue(null as never);
    const res = await GET(req(), params());
    expect(res.status).toBe(404);
  });

  it("500s with detail when the entry lookup throws", async () => {
    mockGetEntry.mockRejectedValue(new Error("boom"));
    const res = await GET(req(), params());
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.detail).toContain("boom");
  });

  it("502s with detail when the blob fetch throws", async () => {
    mockGet.mockRejectedValue(new Error("boom"));
    const res = await GET(req(), params());
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.detail).toContain("boom");
  });

  it("happy path: 200 with full bytes, Content-Type, Content-Length, Accept-Ranges", async () => {
    const res = await GET(req(), params());
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("audio/webm");
    expect(res.headers.get("Content-Length")).toBe("10");
    expect(res.headers.get("Accept-Ranges")).toBe("bytes");
    const buf = new Uint8Array(await res.arrayBuffer());
    expect(Array.from(buf)).toEqual(Array.from(AUDIO_BYTES));
  });

  it("a satisfiable Range request returns 206 with Content-Range and the sliced bytes", async () => {
    const res = await GET(req({ Range: "bytes=0-1" }), params());
    expect(res.status).toBe(206);
    expect(res.headers.get("Content-Range")).toBe("bytes 0-1/10");
    expect(res.headers.get("Content-Length")).toBe("2");
    expect(res.headers.get("Accept-Ranges")).toBe("bytes");
    const buf = new Uint8Array(await res.arrayBuffer());
    expect(Array.from(buf)).toEqual([10, 11]);
  });

  it("a suffix Range request returns the tail bytes", async () => {
    const res = await GET(req({ Range: "bytes=-2" }), params());
    expect(res.status).toBe(206);
    expect(res.headers.get("Content-Range")).toBe("bytes 8-9/10");
    const buf = new Uint8Array(await res.arrayBuffer());
    expect(Array.from(buf)).toEqual([18, 19]);
  });

  it("an unsatisfiable Range request returns 416 with Content-Range */size", async () => {
    const res = await GET(req({ Range: "bytes=100-200" }), params());
    expect(res.status).toBe(416);
    expect(res.headers.get("Content-Range")).toBe("bytes */10");
  });

  it("a malformed Range header is ignored and served as a full 200", async () => {
    const res = await GET(req({ Range: "nonsense" }), params());
    expect(res.status).toBe(200);
  });
});
