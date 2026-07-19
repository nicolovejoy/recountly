import { savePayloadBytes } from "./payload-size";

// What onStop should do when Done fires, decided in one place so every branch
// (empty transcript / oversized payload / normal save) is loud and testable.
export type SavePlan =
  | { kind: "empty" }
  | { kind: "too-large"; totalBytes: number }
  | { kind: "save" };

export function planSave(
  transcript: string,
  audioBytes: number,
  photoBytes: number[],
  budget: number,
): SavePlan {
  if (transcript.trim().length === 0) return { kind: "empty" };
  const totalBytes = savePayloadBytes(audioBytes, photoBytes);
  if (totalBytes > budget) return { kind: "too-large", totalBytes };
  return { kind: "save" };
}
