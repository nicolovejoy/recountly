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
