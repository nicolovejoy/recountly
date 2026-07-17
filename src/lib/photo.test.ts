import { describe, it, expect } from "vitest";
import {
  imageExtension,
  photoBlobPath,
  photoProxyPath,
  insertPhotoSql,
  listPhotosByEntrySql,
  getPhotoSql,
  rowToPhoto,
  uploadPhoto,
  type PhotoRecord,
} from "./photo";
import type { PutFn } from "./blob";

describe("imageExtension", () => {
  it("maps common image mimes", () => {
    expect(imageExtension("image/jpeg")).toBe("jpg");
    expect(imageExtension("image/png")).toBe("png");
    expect(imageExtension("image/webp")).toBe("webp");
    expect(imageExtension("image/heic")).toBe("heic");
    expect(imageExtension("image/gif")).toBe("gif");
  });
  it("falls back to .bin for unknown types", () => {
    expect(imageExtension("application/pdf")).toBe("bin");
  });
});

describe("photoBlobPath / photoProxyPath", () => {
  it("keys the private blob by photo id under photos/", () => {
    expect(photoBlobPath("01PHOTO", "image/jpeg")).toBe("photos/01PHOTO.jpg");
  });
  it("serves playback through the gated same-origin proxy", () => {
    expect(photoProxyPath("01PHOTO")).toBe("/api/photo/01PHOTO");
  });
});

const photo: PhotoRecord = {
  id: "01PHOTO",
  entryId: "01ENTRY",
  mime: "image/jpeg",
  bytes: 123_456,
  createdAt: "2026-07-16T10:00:00.000Z",
};

describe("photo SQL builders", () => {
  it("insertPhotoSql inserts all five columns parameterized", () => {
    const q = insertPhotoSql(photo);
    expect(q.text).toBe(
      "INSERT INTO photos (id, entry_id, mime, bytes, created_at) VALUES ($1, $2, $3, $4, $5)",
    );
    expect(q.values).toEqual(["01PHOTO", "01ENTRY", "image/jpeg", 123_456, "2026-07-16T10:00:00.000Z"]);
  });
  it("listPhotosByEntrySql orders by id (ULIDs = capture order)", () => {
    const q = listPhotosByEntrySql("01ENTRY");
    expect(q.text).toContain("WHERE entry_id = $1 ORDER BY id");
    expect(q.values).toEqual(["01ENTRY"]);
  });
  it("getPhotoSql fetches one by id", () => {
    const q = getPhotoSql("01PHOTO");
    expect(q.text).toContain("WHERE id = $1");
    expect(q.values).toEqual(["01PHOTO"]);
  });
});

describe("rowToPhoto", () => {
  it("maps snake_case and coerces the timestamp", () => {
    expect(
      rowToPhoto({
        id: "01PHOTO",
        entry_id: "01ENTRY",
        mime: "image/jpeg",
        bytes: 5,
        created_at: new Date("2026-07-16T10:00:00.000Z"),
      }),
    ).toEqual({
      id: "01PHOTO",
      entryId: "01ENTRY",
      mime: "image/jpeg",
      bytes: 5,
      createdAt: "2026-07-16T10:00:00.000Z",
    });
  });
});

describe("uploadPhoto", () => {
  it("puts to the id-derived path as a PRIVATE blob", async () => {
    const calls: { path: string; opts: unknown }[] = [];
    const fakePut: PutFn = async (path, _body, opts) => {
      calls.push({ path, opts });
      return { url: `https://blob.example/${path}` };
    };
    const out = await uploadPhoto("01PHOTO", new ArrayBuffer(4), "image/jpeg", 4, fakePut);
    expect(calls[0].path).toBe("photos/01PHOTO.jpg");
    expect(calls[0].opts).toMatchObject({ access: "private", contentType: "image/jpeg" });
    expect(out).toEqual({ pathname: "photos/01PHOTO.jpg", bytes: 4, mime: "image/jpeg" });
  });

  it("propagates upload failures — photos are NOT best-effort", async () => {
    const failingPut: PutFn = async () => {
      throw new Error("store rejected");
    };
    await expect(
      uploadPhoto("01PHOTO", new ArrayBuffer(4), "image/jpeg", 4, failingPut),
    ).rejects.toThrow("store rejected");
  });
});
