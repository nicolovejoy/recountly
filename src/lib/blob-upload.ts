// Client-direct blob upload orchestration (issue #23). On Done the client
// uploads audio + photos STRAIGHT to Vercel Blob via @vercel/blob/client's
// upload() — which mints a per-upload token from the auth-gated
// POST /api/blob/upload — then POSTs a small JSON body of the resulting refs.
// This keeps binaries out of the save POST so it fits fetch keepalive and
// sidesteps the ~4.5 MB function-body cap.
//
// Pure + node-safe: the real upload() (which imports browser-only bits of
// @vercel/blob/client) is INJECTED by the caller, so these tests run offline
// and this module has no network/runtime dependency to mock.

import { audioBlobPath } from "./blob";
import { photoBlobPath } from "./photo";
import type { SaveAudioRef, SavePhotoRef } from "./save-payload";

// The slice of @vercel/blob/client's upload() we depend on — injectable for tests.
export type ClientUploadFn = (
  pathname: string,
  body: Blob,
  opts: { access: "private"; handleUploadUrl: string; contentType: string; multipart?: boolean },
) => Promise<{ url: string }>;

export interface EntryUploadInput {
  entryId: string;
  audio: { blob: Blob; mime: string; complete: boolean } | null;
  photos: { id: string; blob: Blob; mime: string }[];
}

export interface EntryUploadResult {
  audio: SaveAudioRef | null; // null when no audio OR the best-effort upload failed
  audioError: string | null; // why audio is null despite audio existing — surfaced in the UI, never silent
  photos: SavePhotoRef[]; // fully populated; the fn throws before returning if any photo fails
}

const HANDLE_UPLOAD_URL = "/api/blob/upload";

// Upload one entry's blobs, returning the refs the JSON save POST carries.
// Audio is best-effort (a throw → audio: null, transcript still saves); photos
// are NOT best-effort (issue #10) — any failure rethrows so the caller aborts
// the save and keeps the tray. Both are keyed on the deterministic id-derived
// pathnames so a retry re-uploads to the same store key (idempotent).
export async function uploadEntryBlobs(
  input: EntryUploadInput,
  upload: ClientUploadFn,
): Promise<EntryUploadResult> {
  const { ref: audio, error: audioError } = await uploadAudioRef(input.entryId, input.audio, upload);

  const photos: SavePhotoRef[] = [];
  for (const photo of input.photos) {
    const pathname = photoBlobPath(photo.id, photo.mime);
    // No multipart — photos are downscaled client-side to ≤ ~10 MB. A throw
    // here propagates (NOT best-effort) so the whole save aborts.
    await upload(pathname, photo.blob, {
      access: "private",
      handleUploadUrl: HANDLE_UPLOAD_URL,
      contentType: photo.mime,
    });
    photos.push({ id: photo.id, pathname, mime: photo.mime, bytes: photo.blob.size });
  }

  return { audio, audioError, photos };
}

async function uploadAudioRef(
  entryId: string,
  audio: EntryUploadInput["audio"],
  upload: ClientUploadFn,
): Promise<{ ref: SaveAudioRef | null; error: string | null }> {
  if (!audio) return { ref: null, error: null };
  const pathname = audioBlobPath(entryId, audio.mime);
  try {
    // multipart: audio can be long (100 MB cap in the token route).
    await upload(pathname, audio.blob, {
      access: "private",
      handleUploadUrl: HANDLE_UPLOAD_URL,
      contentType: audio.mime,
      multipart: true,
    });
    return {
      ref: { pathname, mime: audio.mime, bytes: audio.blob.size, complete: audio.complete },
      error: null,
    };
  } catch (err) {
    // Best-effort: drop the audio, the transcript still saves — but report WHY
    // so the UI can say so (silent loss hid a total prod upload outage, #45).
    return { ref: null, error: err instanceof Error ? `${err.name}: ${err.message}` : String(err) };
  }
}
