"use client";

// The one circular control — the universal recorder affordance. Glyph + color
// follow status: idle/error = red dot (tap to record); connecting = neutral
// spinner (NOT red — "not ready, don't speak yet"); live = red pulsing ring with
// pause bars (tap to pause); paused = blinking red ring + play triangle (tap to
// resume). Red is reserved to mean "capturing" so it's the only "go" signal.
// Purely presentational; the action comes in via onPress (resolved from status
// by primaryAction upstream).

import type { RecorderStatus } from "@/lib/recorder-state";

const ARIA: Record<RecorderStatus, string> = {
  idle: "Start recording",
  error: "Start recording",
  connecting: "Cancel connecting",
  live: "Pause recording",
  paused: "Resume recording",
};

export default function RecordButton({
  status,
  onPress,
}: {
  status: RecorderStatus;
  onPress: () => void;
}) {
  return (
    <button
      onClick={onPress}
      aria-label={ARIA[status]}
      className={`relative flex h-20 w-20 cursor-pointer items-center justify-center rounded-full border-2 transition-colors ${
        status === "live"
          ? "border-red-600 bg-red-600"
          : status === "paused"
            ? "animate-pulse border-red-600 bg-red-600/10 hover:bg-red-600/20"
            : status === "connecting"
              ? "border-foreground/20 bg-foreground/[0.04]"
              : "border-foreground/20 bg-foreground/[0.04] hover:bg-foreground/[0.08]"
      }`}
    >
      {status === "live" && (
        <span className="absolute inset-0 animate-ping rounded-full bg-red-600/40" aria-hidden />
      )}
      {/* Paused gets a soft red halo too so the "blinking red" reads from across the room. */}
      {status === "paused" && (
        <span className="absolute inset-0 animate-ping rounded-full bg-red-600/25" aria-hidden />
      )}
      {status === "live" ? (
        // pause = two bars
        <span className="relative flex gap-1.5" aria-hidden>
          <span className="h-6 w-1.5 rounded-sm bg-white" />
          <span className="h-6 w-1.5 rounded-sm bg-white" />
        </span>
      ) : status === "paused" ? (
        // resume = red play triangle (CSS triangle, nudged right to look centered)
        <span
          className="relative ml-1 h-0 w-0 border-y-[11px] border-l-[18px] border-y-transparent border-l-red-600"
          aria-hidden
        />
      ) : status === "connecting" ? (
        // not ready — a neutral spinner, deliberately NOT red, so it never reads as "recording"
        <span
          className="relative h-7 w-7 animate-spin rounded-full border-2 border-foreground/20 border-t-foreground/70"
          aria-hidden
        />
      ) : (
        <span className="relative h-7 w-7 rounded-full bg-red-600" aria-hidden />
      )}
    </button>
  );
}
