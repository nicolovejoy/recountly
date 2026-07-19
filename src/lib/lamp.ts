// Maps the recorder status machine (recorder-state.ts) onto the header
// wordmark's "REC lamp" background — reuses RecorderStatus rather than a
// parallel union. Mirrors the affordance rule from RecordButton/RecStatusLine:
// red == capturing only; connecting is neutral gray, not red.

import type { RecorderStatus } from "./recorder-state";

export interface LampStyle {
  bg: string; // Tailwind background classes
  text: string; // Tailwind text-color classes (contrast against bg)
  pulse: boolean; // blinking (paused's "classic blinking REC light")
}

export function lampStyle(status: RecorderStatus): LampStyle {
  switch (status) {
    case "live":
      return { bg: "bg-red-600", text: "text-white", pulse: false };
    case "paused":
      return { bg: "bg-red-600", text: "text-white", pulse: true };
    case "connecting":
      return { bg: "bg-foreground/10", text: "text-foreground", pulse: false };
    case "idle":
    case "error":
      return { bg: "bg-green-600/15", text: "text-foreground", pulse: false };
  }
}
