"use client";

// One circular Record/Stop button — the universal recorder affordance.
// Idle/error: red dot = tap to record. Live: red, pulsing ring, stop square =
// tap to stop. Purely presentational; the action comes in via onPress.

import type { RecorderStatus } from "@/lib/recorder-state";

export default function RecordButton({
  status,
  onPress,
}: {
  status: RecorderStatus;
  onPress: () => void;
}) {
  const live = status === "live" || status === "connecting";
  return (
    <button
      onClick={onPress}
      aria-label={live ? "Stop recording" : "Start recording"}
      className={`relative flex h-20 w-20 cursor-pointer items-center justify-center rounded-full border-2 transition-colors ${
        status === "live"
          ? "border-red-600 bg-red-600"
          : status === "connecting"
            ? "animate-pulse border-foreground/30 bg-foreground/[0.04]"
            : "border-foreground/20 bg-foreground/[0.04] hover:bg-foreground/[0.08]"
      }`}
    >
      {status === "live" && (
        <span className="absolute inset-0 animate-ping rounded-full bg-red-600/40" aria-hidden />
      )}
      {status === "live" ? (
        <span className="relative h-6 w-6 rounded-sm bg-white" aria-hidden />
      ) : (
        <span className="relative h-7 w-7 rounded-full bg-red-600" aria-hidden />
      )}
    </button>
  );
}
