// Audio blob storage — entry audio lives in Vercel Blob, keyed by the entry's
// stable id (the DB is the index; blobs are named by id). The path-building is
// pure and unit-tested; uploadAudio is a thin wrapper over @vercel/blob's put()
// with the put fn injectable so the wrapper is testable without network.

import { put, del } from "@vercel/blob";

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
// is plenty; the id is time-sortable (ULID) so listings stay ordered. This is
// the PRIVATE blob's pathname; playback never hits it directly (see below).
export function audioBlobPath(id: string, mime: string): string {
  return `audio/${id}.${audioExtension(mime)}`;
}

// What we store in `audio_url` and what the <audio> element points at: a
// same-origin path served by GET /api/audio/[id], which Vercel Authentication
// gates. The route fetches the private blob server-side and streams it back, so
// the blob is never world-readable — only an authenticated owner can play it.
export function audioProxyPath(id: string): string {
  return `/api/audio/${id}`;
}

export interface UploadedAudio {
  pathname: string;
  bytes: number;
  mime: string;
}

// The slice of @vercel/blob's put() we depend on — injectable for tests.
export type PutFn = (
  path: string,
  body: Blob | ArrayBuffer | Buffer,
  opts: { access: "private"; contentType: string },
) => Promise<{ url: string }>;

// Upload one entry's audio as a PRIVATE blob. `bytes` is passed in (the caller
// already knows the size) so we don't re-read the body. Private access means the
// returned url requires auth, so we don't use it — we return the deterministic
// pathname and the caller serves it via audioProxyPath()/the gated proxy route.
export async function uploadAudio(
  id: string,
  body: Blob | ArrayBuffer | Buffer,
  mime: string,
  bytes: number,
  putFn: PutFn = put as unknown as PutFn,
): Promise<UploadedAudio> {
  const pathname = audioBlobPath(id, mime);
  await putFn(pathname, body, { access: "private", contentType: mime });
  return { pathname, bytes, mime };
}

// The slice of @vercel/blob's del() we depend on — injectable for tests.
export type DelFn = (paths: string[] | string) => Promise<void>;

// Issue #9 delete: batch-remove blob paths (audio + photos) for one entry.
// A no-op when there's nothing to delete (an entry with no audio/photos)
// rather than calling delFn with an empty array. Failures propagate — the
// caller (the DELETE route) decides whether that's best-effort or fatal.
export async function deleteBlobPaths(
  paths: string[],
  delFn: DelFn = del,
): Promise<void> {
  if (paths.length === 0) return;
  await delFn(paths);
}
