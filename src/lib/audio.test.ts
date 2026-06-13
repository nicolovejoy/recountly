import { describe, it, expect } from "vitest";
import { pickAudioMimeType, AUDIO_MIME_CANDIDATES } from "./audio";

describe("pickAudioMimeType", () => {
  it("returns the first candidate the platform supports", () => {
    const supported = new Set(["audio/webm", "audio/mp4"]);
    // opus-webm isn't supported here, so it should fall through to audio/webm.
    expect(pickAudioMimeType((t) => supported.has(t))).toBe("audio/webm");
  });

  it("prefers the highest-priority candidate when several are supported", () => {
    const best = AUDIO_MIME_CANDIDATES[0];
    expect(pickAudioMimeType(() => true)).toBe(best);
  });

  it("returns empty string when nothing is supported (let MediaRecorder default)", () => {
    expect(pickAudioMimeType(() => false)).toBe("");
  });

  it("honors a custom candidate list", () => {
    expect(pickAudioMimeType((t) => t === "audio/ogg", ["audio/mp4", "audio/ogg"])).toBe(
      "audio/ogg",
    );
  });
});
