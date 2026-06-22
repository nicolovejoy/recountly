// Audio blob storage — entry audio lives in Vercel Blob, keyed by the entry's
// stable id (the DB is the index; blobs are named by id). The path-building is
// pure and unit-tested; uploadAudio is a thin wrapper over @vercel/blob's put()
// with the put fn injectable so the wrapper is testable without network.

import { put } from "@vercel/blob";

// Map a MediaRecorder mime (possibly with a `;codecs=...` suffix) to a file
// extension for the blob name. Unknown types fall back to .bin.
export function audioExtension(mime: string): string {
  const base = mime.split(";")[0].trim().toLowerCase();
  switch (base) {
    case "audio/webm":
      return "webm";
    case "audio/mp4":
      return "mp4";
    case "audio/ogg":
      return "ogg";
    case "audio/mpeg":
      return "mp3";
    default:
      return "bin";
  }
}

// Stable, id-derived path. Single user, so a flat `audio/<id>.<ext>` namespace
// is plenty; the id is time-sortable (ULID) so listings stay ordered.
export function audioBlobPath(id: string, mime: string): string {
  return `audio/${id}.${audioExtension(mime)}`;
}

export interface UploadedAudio {
  url: string;
  bytes: number;
  mime: string;
}

// The slice of @vercel/blob's put() we depend on — injectable for tests.
export type PutFn = (
  path: string,
  body: Blob | ArrayBuffer | Buffer,
  opts: { access: "public"; contentType: string },
) => Promise<{ url: string }>;

// Upload one entry's audio and return the reference to store on the row.
// `bytes` is passed in (the caller already knows the size) so we don't re-read
// the body. v1 uses public access — the URL suffix is unguessable and the app
// is owner-gated; a later pass can switch to private + signed reads.
export async function uploadAudio(
  id: string,
  body: Blob | ArrayBuffer | Buffer,
  mime: string,
  bytes: number,
  putFn: PutFn = put as unknown as PutFn,
): Promise<UploadedAudio> {
  const { url } = await putFn(audioBlobPath(id, mime), body, {
    access: "public",
    contentType: mime,
  });
  return { url, bytes, mime };
}
