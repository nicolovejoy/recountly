import { describe, it, expect } from "vitest";
import {
  audioExtension,
  audioBlobPath,
  audioProxyPath,
  uploadAudio,
  deleteBlobPaths,
  type PutFn,
  type DelFn,
} from "./blob";

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

describe("audioProxyPath", () => {
  it("routes playback through the gated same-origin proxy, keyed by id", () => {
    expect(audioProxyPath("01HX")).toBe("/api/audio/01HX");
  });
});

describe("uploadAudio", () => {
  it("puts to the id-derived path as a PRIVATE blob and returns the pathname ref", async () => {
    const calls: { path: string; opts: unknown }[] = [];
    const fakePut: PutFn = async (path, _body, opts) => {
      calls.push({ path, opts });
      return { url: `https://blob.example/${path}` };
    };
    const body = new ArrayBuffer(8);
    const out = await uploadAudio("01HX", body, "audio/webm;codecs=opus", 8, fakePut);
    expect(calls[0].path).toBe("audio/01HX.webm");
    expect(calls[0].opts).toMatchObject({
      access: "private",
      contentType: "audio/webm;codecs=opus",
    });
    expect(out).toEqual({
      pathname: "audio/01HX.webm",
      bytes: 8,
      mime: "audio/webm;codecs=opus",
    });
  });
});

describe("deleteBlobPaths", () => {
  it("calls delFn once with the array of paths", async () => {
    const calls: (string[] | string)[] = [];
    const fakeDel: DelFn = async (paths) => {
      calls.push(paths);
    };
    await deleteBlobPaths(["audio/01HX.webm", "photos/01PHOTO.jpg"], fakeDel);
    expect(calls).toEqual([["audio/01HX.webm", "photos/01PHOTO.jpg"]]);
  });

  it("is a no-op when paths is empty (delFn not called)", async () => {
    let called = false;
    const fakeDel: DelFn = async () => {
      called = true;
    };
    await deleteBlobPaths([], fakeDel);
    expect(called).toBe(false);
  });

  it("propagates a delFn rejection", async () => {
    const failingDel: DelFn = async () => {
      throw new Error("blob store unreachable");
    };
    await expect(deleteBlobPaths(["audio/01HX.webm"], failingDel)).rejects.toThrow(
      "blob store unreachable",
    );
  });
});
