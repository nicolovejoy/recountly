import { describe, it, expect } from "vitest";
import { buildSaveBody, parseSaveBody, withinKeepaliveCap } from "./save-payload";

const audio = { pathname: "audio/e1.webm", mime: "audio/webm", bytes: 2_000, complete: true };
const photo = { id: "p1", pathname: "photos/p1.jpg", mime: "image/jpeg", bytes: 5_000 };

describe("buildSaveBody", () => {
  it("assembles a body with audio + photos", () => {
    const body = buildSaveBody({
      id: "e1",
      transcript: "hello",
      durationSeconds: 12,
      audio,
      photos: [photo],
    });
    expect(body).toEqual({
      id: "e1",
      transcript: "hello",
      durationSeconds: 12,
      audio,
      photos: [photo],
    });
  });

  it("carries the optional recordedAt/journalId/writtenAt only when set", () => {
    const body = buildSaveBody({
      id: "e2",
      transcript: "hi",
      durationSeconds: 1,
      recordedAt: "2026-07-19T00:00:00.000Z",
      journalId: "j1",
      writtenAt: "2026-07-18T00:00:00.000Z",
      audio: null,
      photos: [],
    });
    expect(body.recordedAt).toBe("2026-07-19T00:00:00.000Z");
    expect(body.journalId).toBe("j1");
    expect(body.writtenAt).toBe("2026-07-18T00:00:00.000Z");
    expect(body.audio).toBeNull();
    expect(body.photos).toEqual([]);
  });

  it("omits the optional fields when absent", () => {
    const body = buildSaveBody({ id: "e3", transcript: "hi", durationSeconds: 1, audio: null, photos: [] });
    expect("recordedAt" in body).toBe(false);
    expect("journalId" in body).toBe(false);
    expect("writtenAt" in body).toBe(false);
  });
});

describe("parseSaveBody", () => {
  it("round-trips a full body through JSON", () => {
    const body = buildSaveBody({
      id: "e1",
      transcript: "hello world",
      durationSeconds: 12,
      recordedAt: "2026-07-19T00:00:00.000Z",
      journalId: "j1",
      writtenAt: "2026-07-18T00:00:00.000Z",
      audio,
      photos: [photo],
    });
    const parsed = parseSaveBody(JSON.parse(JSON.stringify(body)));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.input).toEqual({
      transcript: "hello world",
      durationSeconds: 12,
      recordedAt: "2026-07-19T00:00:00.000Z",
      journalId: "j1",
      writtenAt: "2026-07-18T00:00:00.000Z",
      audioMime: "audio/webm",
      audioBytes: 2_000,
      audioComplete: true,
    });
    expect(parsed.audio).toEqual(audio);
    expect(parsed.photos).toEqual([photo]);
  });

  it("round-trips a transcript-only body (no audio, no photos)", () => {
    const body = buildSaveBody({ id: "e9", transcript: "just text", durationSeconds: 3, audio: null, photos: [] });
    const parsed = parseSaveBody(JSON.parse(JSON.stringify(body)));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.audio).toBeNull();
    expect(parsed.photos).toEqual([]);
    expect(parsed.input.audioBytes).toBeUndefined();
  });

  it("rejects a non-object body", () => {
    const parsed = parseSaveBody(null);
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.problems.length).toBeGreaterThan(0);
  });

  it("rejects a missing/blank id", () => {
    const parsed = parseSaveBody({ id: "   ", transcript: "hi", durationSeconds: 1, photos: [] });
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.problems).toContain("id is required");
  });

  it("rejects a photo missing its id", () => {
    const parsed = parseSaveBody({
      id: "e1",
      transcript: "hi",
      durationSeconds: 1,
      photos: [{ pathname: "photos/p1.jpg", mime: "image/jpeg", bytes: 100 }],
    });
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.problems.some((p) => p.includes("id"))).toBe(true);
  });

  it("rejects a non-image photo mime", () => {
    const parsed = parseSaveBody({
      id: "e1",
      transcript: "hi",
      durationSeconds: 1,
      photos: [{ id: "p1", pathname: "photos/p1.pdf", mime: "application/pdf", bytes: 100 }],
    });
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.problems.some((p) => p.includes("image/"))).toBe(true);
  });

  it("rejects a non-audio audio mime", () => {
    const parsed = parseSaveBody({
      id: "e1",
      transcript: "hi",
      durationSeconds: 1,
      audio: { pathname: "audio/e1.bin", mime: "application/octet-stream", bytes: 100 },
      photos: [],
    });
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.problems.some((p) => p.includes("audio/"))).toBe(true);
  });

  it("rejects negative audio bytes", () => {
    const parsed = parseSaveBody({
      id: "e1",
      transcript: "hi",
      durationSeconds: 1,
      audio: { pathname: "audio/e1.webm", mime: "audio/webm", bytes: -5 },
      photos: [],
    });
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.problems.some((p) => p.includes("bytes"))).toBe(true);
  });

  it("rejects negative photo bytes", () => {
    const parsed = parseSaveBody({
      id: "e1",
      transcript: "hi",
      durationSeconds: 1,
      photos: [{ id: "p1", pathname: "photos/p1.jpg", mime: "image/jpeg", bytes: -5 }],
    });
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.problems.some((p) => p.includes("bytes"))).toBe(true);
  });

  it("reports every problem at once (problems list, not throw-on-first)", () => {
    const parsed = parseSaveBody({ id: "", transcript: "", durationSeconds: -1, photos: [] });
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.problems.length).toBeGreaterThanOrEqual(3);
  });
});

describe("withinKeepaliveCap", () => {
  it("is true for a small body", () => {
    expect(withinKeepaliveCap(JSON.stringify({ transcript: "hi" }))).toBe(true);
  });

  it("is false once the byte length reaches the cap", () => {
    expect(withinKeepaliveCap("x".repeat(60_000))).toBe(false);
  });

  it("counts bytes, not chars (multibyte runs longer)", () => {
    // 20_000 emoji × 4 bytes each = 80_000 bytes > cap, though only 20_000 code units.
    expect(withinKeepaliveCap("😀".repeat(20_000))).toBe(false);
  });
});
