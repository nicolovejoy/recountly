// Aggregate save-payload budget (physical-journal archive). Vercel rejects
// request bodies over ~4.5 MB before the route runs, so an oversized save
// would 413 with an opaque platform error — and retrying the same payload can
// never succeed. Check the sum client-side before POSTing and tell the user
// what to remove. 4 MB leaves headroom for multipart framing + text fields.

export const SAVE_BYTES_BUDGET = 4_000_000;

// Total content bytes for a save: best-effort audio plus every pending photo.
export function savePayloadBytes(audioBytes: number, photoBytes: number[]): number {
  return audioBytes + photoBytes.reduce((sum, b) => sum + b, 0);
}
