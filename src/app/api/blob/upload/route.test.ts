// Route-level integration tests for the client-upload token route.
// Pattern (house style): vi.mock the libs the route leans on, call the exported
// handler with constructed Requests, assert status + JSON. No network, no Blob.
// `@vercel/blob/client` is mocked so handleUpload is a spy — we exercise auth,
// that handleUpload is invoked, and the onBeforeGenerateToken caps we pass it.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth-server", () => ({ getServerSession: vi.fn() }));
vi.mock("@vercel/blob/client", () => ({ handleUpload: vi.fn() }));

import { POST } from "./route";
import { getServerSession } from "@/lib/auth-server";
import { handleUpload } from "@vercel/blob/client";

const mockSession = vi.mocked(getServerSession);
const mockHandleUpload = vi.mocked(handleUpload);

const AUDIO_MAX = 100 * 1024 * 1024;
const PHOTO_MAX = 10 * 1024 * 1024;

// A generate-client-token body shaped like what upload() POSTs to this route.
const tokenBody = {
  type: "blob.generate-client-token",
  payload: { pathname: "audio/x.webm", multipart: true, clientPayload: null },
};

function req(body: unknown) {
  return new Request("http://localhost/api/blob/upload", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockSession.mockResolvedValue({} as never); // authed unless a test says otherwise
});

describe("POST /api/blob/upload", () => {
  it("401s without a session and never calls handleUpload", async () => {
    mockSession.mockResolvedValue(null as never);
    const res = await POST(req(tokenBody));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
    expect(mockHandleUpload).not.toHaveBeenCalled();
  });

  it("passes the body through to handleUpload and returns its result (200)", async () => {
    const result = { type: "blob.generate-client-token", clientToken: "tok_123" };
    mockHandleUpload.mockResolvedValue(result as never);
    const res = await POST(req(tokenBody));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(result);
    expect(mockHandleUpload).toHaveBeenCalledTimes(1);
    const opts = mockHandleUpload.mock.calls[0][0];
    expect(opts.body).toEqual(tokenBody);
  });

  it("onBeforeGenerateToken sets the audio cap for an audio/ pathname", async () => {
    mockHandleUpload.mockResolvedValue({} as never);
    await POST(req(tokenBody));
    const { onBeforeGenerateToken } = mockHandleUpload.mock.calls[0][0];
    const cfg = await onBeforeGenerateToken("audio/01H.webm", null, true);
    expect(cfg.maximumSizeInBytes).toBe(AUDIO_MAX);
    expect(cfg.allowedContentTypes).toEqual(["audio/*", "image/*"]);
    expect(cfg.addRandomSuffix).toBe(false);
  });

  it("onBeforeGenerateToken sets the photo cap for a photos/ pathname", async () => {
    mockHandleUpload.mockResolvedValue({} as never);
    await POST(req(tokenBody));
    const { onBeforeGenerateToken } = mockHandleUpload.mock.calls[0][0];
    const cfg = await onBeforeGenerateToken("photos/01H.jpg", null, false);
    expect(cfg.maximumSizeInBytes).toBe(PHOTO_MAX);
    expect(cfg.allowedContentTypes).toEqual(["audio/*", "image/*"]);
    expect(cfg.addRandomSuffix).toBe(false);
  });

  it("400s with detail when handleUpload throws", async () => {
    mockHandleUpload.mockRejectedValue(new Error("boom"));
    const res = await POST(req(tokenBody));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBeTruthy();
    expect(json.detail).toContain("boom");
  });
});
