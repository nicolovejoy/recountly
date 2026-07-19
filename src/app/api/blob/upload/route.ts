// Client-upload token route (issue #23). The browser uploads audio + photos
// straight to Vercel Blob via upload() from @vercel/blob/client, which fetches a
// per-upload client token from here. This keeps big binaries off the ~4.5 MB
// serverless function body — the entry itself saves as a small JSON POST.
//
//   POST /api/blob/upload  → 200 (handleUpload's client-token JSON)
//                          | 401 { error: "Unauthorized" }
//                          | 400 { error, detail } on a bad body / handleUpload throw
//
// Auth is checked BEFORE handleUpload so an unauthed caller can never mint a
// token. There is deliberately NO onUploadCompleted: it never fires on localhost
// (handleUpload only sets a callback URL when VERCEL === "1"), and the DB write
// is the separate JSON POST to /api/entries — not a blob webhook.

import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { getServerSession } from "@/lib/auth-server";

// Audio can be long (100 MB); photos are downscaled client-side (10 MB is ample).
const AUDIO_MAX_BYTES = 100 * 1024 * 1024;
const PHOTO_MAX_BYTES = 10 * 1024 * 1024;

export async function POST(request: Request) {
  if (!(await getServerSession())) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = (await request.json()) as HandleUploadBody;
    const result = await handleUpload({
      request,
      body,
      onBeforeGenerateToken: async (pathname) => ({
        allowedContentTypes: ["audio/*", "image/*"],
        // audio/<id>.<ext> gets the big cap; everything else (photos/<id>.<ext>)
        // the photo cap. The client-minted, id-derived pathname is what the gated
        // proxies resolve, so no random suffix.
        maximumSizeInBytes: pathname.startsWith("audio/")
          ? AUDIO_MAX_BYTES
          : PHOTO_MAX_BYTES,
        addRandomSuffix: false,
      }),
    });
    return Response.json(result);
  } catch (err) {
    return Response.json(
      { error: "Upload token request failed", detail: String(err) },
      { status: 400 },
    );
  }
}
