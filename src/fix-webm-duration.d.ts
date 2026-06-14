// fix-webm-duration ships no types. We only use the promise form:
// fixWebmDuration(blob, durationMs) -> Blob with the duration written into the
// WebM header (MediaRecorder omits it, breaking seek/playback).
declare module "fix-webm-duration" {
  export default function fixWebmDuration(
    blob: Blob,
    durationMs: number,
    options?: { logger?: false | ((message: string) => void) },
  ): Promise<Blob>;
}
