import { describe, it, expect } from "vitest";
import { pickAudioMimeType, AUDIO_MIME_CANDIDATES } from "./audio";

describe("pickAudioMimeType", () => {
  it("returns the first candidate the platform supports", () => {
    const supported = new Set(["audio/webm", "audio/mp4"]);
    // Neither mp4 candidate with the codecs string is supported here, and the
    // bare "audio/mp4" is, so it should win over webm despite webm being
    // listed too.
    expect(pickAudioMimeType((t) => supported.has(t))).toBe("audio/mp4");
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

  it("picks mp4a.40.2 when everything passes (new Chrome/Safari norm)", () => {
    expect(pickAudioMimeType(() => true, undefined, () => "probably")).toBe(
      "audio/mp4;codecs=mp4a.40.2",
    );
  });

  it("falls through to bare mp4 when the codecs-string probe fails (Safari-style)", () => {
    const canRecord = new Set(["audio/mp4", "audio/webm;codecs=opus", "audio/webm"]);
    expect(
      pickAudioMimeType((t) => canRecord.has(t), undefined, () => "probably"),
    ).toBe("audio/mp4");
  });

  it("falls through to webm only when both mp4 variants are unrecordable (old-Chrome fallback)", () => {
    const canRecord = new Set(["audio/webm;codecs=opus", "audio/webm"]);
    expect(
      pickAudioMimeType((t) => canRecord.has(t), undefined, () => "probably"),
    ).toBe("audio/webm;codecs=opus");
  });

  it("falls through past an unplayable candidate to the next recordable+playable one", () => {
    // Mirrors the dual-gate mechanism #49 added: recordable alone isn't
    // enough, playback must also pass.
    const canRecord = new Set(["audio/mp4;codecs=mp4a.40.2", "audio/mp4"]);
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
