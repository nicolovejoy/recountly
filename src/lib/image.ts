// Client-side photo downscaling (physical-journal archive, issue #17). This is
// load-bearing, not polish: Vercel rejects request bodies over ~4.5 MB before
// the save route ever runs, and raw phone photos exceed that. Every attached
// photo goes through downscalePhoto before entering the save payload.
//
// planDownscale is the pure, tested core; downscalePhoto is thin browser glue
// (createImageBitmap + canvas) kept separate the same way useRecorder wraps
// the tested connection logic. Output is always JPEG — predictable size, and
// it transcodes HEIC (which Chrome can't display) into something every
// browser renders. A source the browser can't decode (e.g. HEIC on Chrome)
// makes downscalePhoto throw — the caller must surface that, not swallow it.

export const PHOTO_MAX_DIM = 2048;
export const PHOTO_JPEG_QUALITY = 0.85;

// Target dimensions: scale the long edge down to maxDim (never up), keep
// aspect ratio, whole pixels.
export function planDownscale(
  srcWidth: number,
  srcHeight: number,
  maxDim: number = PHOTO_MAX_DIM,
): { width: number; height: number } {
  const longEdge = Math.max(srcWidth, srcHeight);
  if (longEdge <= maxDim) return { width: srcWidth, height: srcHeight };
  const scale = maxDim / longEdge;
  return {
    width: Math.round(srcWidth * scale),
    height: Math.round(srcHeight * scale),
  };
}

// Decode → scale → re-encode as JPEG. Throws if the browser can't decode the
// source or produce a JPEG; callers surface that as an attach error.
export async function downscalePhoto(
  source: Blob,
): Promise<{ blob: Blob; mime: "image/jpeg" }> {
  const bitmap = await createImageBitmap(source);
  try {
    const { width, height } = planDownscale(bitmap.width, bitmap.height);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("canvas 2d context unavailable");
    ctx.drawImage(bitmap, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", PHOTO_JPEG_QUALITY),
    );
    if (!blob) throw new Error("could not encode JPEG");
    return { blob, mime: "image/jpeg" };
  } finally {
    bitmap.close();
  }
}
