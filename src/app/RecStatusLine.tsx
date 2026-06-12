"use client";

// The line under the record button: "● REC m:ss" + live mic-level bar while
// recording, "Connecting…" while the session comes up, hint text otherwise.
// The meter span is driven per-frame through meterRef by the hook's analyser
// loop (no re-renders); the hook null-guards against the span not being
// mounted yet during "connecting".

import type { RefObject } from "react";
import { formatElapsed } from "@/lib/elapsed";
import type { RecorderStatus } from "@/lib/recorder-state";

export default function RecStatusLine({
  status,
  elapsedSec,
  meterRef,
}: {
  status: RecorderStatus;
  elapsedSec: number;
  meterRef: RefObject<HTMLSpanElement | null>;
}) {
  return (
    <div className="flex h-5 items-center gap-3 text-sm">
      {status === "live" ? (
        <>
          <span className="font-medium text-red-500">● REC</span>
          <span className="tabular-nums text-foreground/70">{formatElapsed(elapsedSec)}</span>
          <span className="h-1 w-20 overflow-hidden rounded-full bg-foreground/10" aria-hidden>
            <span
              ref={meterRef}
              className="block h-full w-full origin-left rounded-full bg-green-500 transition-transform duration-75 ease-out"
              style={{ transform: "scaleX(0)" }}
            />
          </span>
        </>
      ) : status === "connecting" ? (
        <span className="text-foreground/50">Connecting…</span>
      ) : (
        <span className="text-foreground/40">Tap to record</span>
      )}
    </div>
  );
}
