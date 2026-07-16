import { describe, it, expect } from "vitest";
import { buildEntryFormData } from "./entry-form";

describe("buildEntryFormData", () => {
  it("sets transcript + durationSeconds (as strings)", () => {
    const fd = buildEntryFormData({ transcript: "hello", durationSeconds: 42 });
    expect(fd.get("transcript")).toBe("hello");
    expect(fd.get("durationSeconds")).toBe("42");
    expect(fd.get("audio")).toBeNull();
  });

  it("includes recordedAt only when provided", () => {
    expect(buildEntryFormData({ transcript: "x", durationSeconds: 1 }).get("recordedAt")).toBeNull();
    const fd = buildEntryFormData({
      transcript: "x",
      durationSeconds: 1,
      recordedAt: "2026-06-13T01:00:00.000Z",
    });
    expect(fd.get("recordedAt")).toBe("2026-06-13T01:00:00.000Z");
  });

  it("attaches a non-empty audio blob with an extension matching its mime", () => {
    const blob = new Blob([new Uint8Array(16)], { type: "audio/webm" });
    const fd = buildEntryFormData({
      transcript: "x",
      durationSeconds: 1,
      audio: { blob, mime: "audio/webm;codecs=opus" },
    });
    const file = fd.get("audio");
    expect(file).toBeInstanceOf(File);
    expect((file as File).name).toBe("audio.webm");
    expect((file as File).size).toBe(16);
    // audioComplete defaults to "true" when not specified
    expect(fd.get("audioComplete")).toBe("true");
  });

  it("flags partial audio (paused entry) and omits the flag when no audio", () => {
    const blob = new Blob([new Uint8Array(16)], { type: "audio/webm" });
    const partial = buildEntryFormData({
      transcript: "x",
      durationSeconds: 1,
      audio: { blob, mime: "audio/webm", complete: false },
    });
    expect(partial.get("audioComplete")).toBe("false");
    const none = buildEntryFormData({ transcript: "x", durationSeconds: 1, audio: null });
    expect(none.get("audioComplete")).toBeNull();
  });

  it("omits empty or absent audio (best-effort)", () => {
    const empty = new Blob([], { type: "audio/webm" });
    expect(
      buildEntryFormData({ transcript: "x", durationSeconds: 1, audio: { blob: empty, mime: "audio/webm" } }).get("audio"),
    ).toBeNull();
    expect(
      buildEntryFormData({ transcript: "x", durationSeconds: 1, audio: null }).get("audio"),
    ).toBeNull();
  });
});

describe("journal archive fields", () => {
  it("carries journalId and writtenAt when present", () => {
    const fd = buildEntryFormData({
      transcript: "read aloud",
      durationSeconds: 30,
      journalId: "01JRNL",
      writtenAt: "1994-03-02T00:00:00.000Z",
    });
    expect(fd.get("journalId")).toBe("01JRNL");
    expect(fd.get("writtenAt")).toBe("1994-03-02T00:00:00.000Z");
  });

  it("omits journal fields for a normal spoken entry", () => {
    const fd = buildEntryFormData({ transcript: "hi", durationSeconds: 1 });
    expect(fd.get("journalId")).toBeNull();
    expect(fd.get("writtenAt")).toBeNull();
  });

  it("appends each photo under the repeated 'photo' field, skipping empties", () => {
    const jpeg = new Blob([new Uint8Array([1, 2, 3])], { type: "image/jpeg" });
    const empty = new Blob([], { type: "image/png" });
    const fd = buildEntryFormData({
      transcript: "page one",
      durationSeconds: 10,
      photos: [
        { blob: jpeg, mime: "image/jpeg" },
        { blob: empty, mime: "image/png" },
      ],
    });
    const photos = fd.getAll("photo");
    expect(photos).toHaveLength(1);
    expect((photos[0] as File).name).toBe("photo.jpg");
  });
});
