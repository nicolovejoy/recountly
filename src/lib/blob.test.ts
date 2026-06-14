import { describe, it, expect } from "vitest";
import { audioExtension, audioBlobPath, uploadAudio, type PutFn } from "./blob";

describe("audioExtension", () => {
  it("maps known mimes, stripping any codecs suffix", () => {
    expect(audioExtension("audio/webm;codecs=opus")).toBe("webm");
    expect(audioExtension("audio/webm")).toBe("webm");
    expect(audioExtension("audio/mp4")).toBe("mp4");
    expect(audioExtension("audio/ogg;codecs=opus")).toBe("ogg");
    expect(audioExtension("audio/mpeg")).toBe("mp3");
  });

  it("falls back to .bin for unknown types", () => {
    expect(audioExtension("application/octet-stream")).toBe("bin");
  });
});

describe("audioBlobPath", () => {
  it("keys the blob by entry id under audio/", () => {
    expect(audioBlobPath("01HX", "audio/webm;codecs=opus")).toBe("audio/01HX.webm");
  });
});

describe("uploadAudio", () => {
  it("puts to the id-derived path with the right content type and returns the ref", async () => {
    const calls: { path: string; opts: unknown }[] = [];
    const fakePut: PutFn = async (path, _body, opts) => {
      calls.push({ path, opts });
      return { url: `https://blob.example/${path}` };
    };
    const body = new ArrayBuffer(8);
    const out = await uploadAudio("01HX", body, "audio/webm;codecs=opus", 8, fakePut);
    expect(calls[0].path).toBe("audio/01HX.webm");
    expect(calls[0].opts).toMatchObject({ access: "public", contentType: "audio/webm;codecs=opus" });
    expect(out).toEqual({
      url: "https://blob.example/audio/01HX.webm",
      bytes: 8,
      mime: "audio/webm;codecs=opus",
    });
  });
});
