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

  it("picks webm when it's both recordable and playable (desktop Chrome)", () => {
    expect(pickAudioMimeType(() => true, undefined, () => "probably")).toBe(
      AUDIO_MIME_CANDIDATES[0],
    );
  });

  it("falls through to mp4 when webm is recordable but not playable (iOS PWA bug)", () => {
    // Mirrors the real iOS home-screen PWA bug: isTypeSupported lies and says
    // webm is recordable, but canPlayType reports it can't actually be played.
    const canRecord = new Set(["audio/webm;codecs=opus", "audio/webm", "audio/mp4"]);
    const playable: Record<string, string> = { "audio/mp4": "maybe" };
    expect(
      pickAudioMimeType((t) => canRecord.has(t), undefined, (t) => playable[t] ?? ""),
    ).toBe("audio/mp4");
  });

  it("returns empty string when nothing is both recordable and playable", () => {
    expect(pickAudioMimeType(() => true, undefined, () => "")).toBe("");
  });

  it("treats a 'maybe' canPlayType result as playable, same as 'probably'", () => {
    expect(pickAudioMimeType(() => true, undefined, () => "maybe")).toBe(
      AUDIO_MIME_CANDIDATES[0],
    );
  });
});
