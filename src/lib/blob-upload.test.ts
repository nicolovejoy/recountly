import { describe, it, expect } from "vitest";
import {
  uploadEntryBlobs,
  type ClientUploadFn,
  type EntryUploadInput,
} from "./blob-upload";

// Record every upload() call so the tests can assert the exact args the
// orchestration passes (pathname + options are a contract with the token route).
type UploadCall = { pathname: string; body: Blob; opts: Record<string, unknown> };

function recordingUpload(): { fn: ClientUploadFn; calls: UploadCall[] } {
  const calls: UploadCall[] = [];
  const fn: ClientUploadFn = async (pathname, body, opts) => {
    calls.push({ pathname, body, opts });
    return { url: `https://blob.example/${pathname}` };
  };
  return { fn, calls };
}

describe("uploadEntryBlobs", () => {
  it("uploads audio + photos and returns the right refs (audio multipart+private, photos private)", async () => {
    const audioBlob = new Blob([new Uint8Array(16)], { type: "audio/webm" });
    const photoBlob = new Blob([new Uint8Array(32)], { type: "image/jpeg" });
    const input: EntryUploadInput = {
      entryId: "01ENTRY",
      audio: { blob: audioBlob, mime: "audio/webm;codecs=opus", complete: true },
      photos: [{ id: "01PHOTO", blob: photoBlob, mime: "image/jpeg" }],
    };
    const { fn, calls } = recordingUpload();

    const result = await uploadEntryBlobs(input, fn);

    // Audio call: id-derived pathname, private, multipart, handleUploadUrl, contentType.
    expect(calls[0].pathname).toBe("audio/01ENTRY.webm");
    expect(calls[0].body).toBe(audioBlob);
    expect(calls[0].opts).toEqual({
      access: "private",
      handleUploadUrl: "/api/blob/upload",
      contentType: "audio/webm;codecs=opus",
      multipart: true,
    });
    // Photo call: id-derived pathname, private, NO multipart.
    expect(calls[1].pathname).toBe("photos/01PHOTO.jpg");
    expect(calls[1].body).toBe(photoBlob);
    expect(calls[1].opts).toEqual({
      access: "private",
      handleUploadUrl: "/api/blob/upload",
      contentType: "image/jpeg",
    });
    expect(calls[1].opts).not.toHaveProperty("multipart");

    expect(result).toEqual({
      audio: {
        pathname: "audio/01ENTRY.webm",
        mime: "audio/webm;codecs=opus",
        bytes: audioBlob.size,
        complete: true,
      },
      photos: [
        {
          id: "01PHOTO",
          pathname: "photos/01PHOTO.jpg",
          mime: "image/jpeg",
          bytes: photoBlob.size,
        },
      ],
    });
  });

  it("returns audio: null when there is no audio, and photos: [] when there are none", async () => {
    const { fn, calls } = recordingUpload();
    const result = await uploadEntryBlobs(
      { entryId: "01ENTRY", audio: null, photos: [] },
      fn,
    );
    expect(calls).toEqual([]);
    expect(result).toEqual({ audio: null, photos: [] });
  });

  it("swallows an audio-upload failure (best-effort): audio null, photos still uploaded", async () => {
    const photoBlob = new Blob([new Uint8Array(8)], { type: "image/png" });
    const calls: string[] = [];
    const fn: ClientUploadFn = async (pathname) => {
      calls.push(pathname);
      if (pathname.startsWith("audio/")) throw new Error("audio blob rejected");
      return { url: `https://blob.example/${pathname}` };
    };

    const result = await uploadEntryBlobs(
      {
        entryId: "01ENTRY",
        audio: { blob: new Blob([new Uint8Array(4)], { type: "audio/webm" }), mime: "audio/webm", complete: false },
        photos: [{ id: "01PHOTO", blob: photoBlob, mime: "image/png" }],
      },
      fn,
    );

    expect(calls).toContain("audio/01ENTRY.webm");
    expect(result.audio).toBeNull();
    expect(result.photos).toEqual([
      { id: "01PHOTO", pathname: "photos/01PHOTO.png", mime: "image/png", bytes: photoBlob.size },
    ]);
  });

  it("rethrows a photo-upload failure (NOT best-effort): the whole call rejects", async () => {
    const fn: ClientUploadFn = async (pathname) => {
      if (pathname.startsWith("photos/")) throw new Error("photo blob rejected");
      return { url: `https://blob.example/${pathname}` };
    };

    await expect(
      uploadEntryBlobs(
        {
          entryId: "01ENTRY",
          audio: null,
          photos: [{ id: "01PHOTO", blob: new Blob([new Uint8Array(4)], { type: "image/jpeg" }), mime: "image/jpeg" }],
        },
        fn,
      ),
    ).rejects.toThrow("photo blob rejected");
  });
});
