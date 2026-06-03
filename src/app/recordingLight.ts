// Stoplight indicator for the recorder, using the ON-AIR studio convention:
//   green = ready/standby (cleared to record), amber = transitioning,
//   red = live recording. This pure mapping pins the status -> color/label
//   product decision (unit-tested in recordingLight.test.ts).

export type RecordingStatus = "idle" | "connecting" | "live" | "stopping" | "error";

export type Lamp = "red" | "amber" | "green";

export interface RecordingLight {
  lamp: Lamp;
  label: string;
}

export function recordingLight(status: RecordingStatus): RecordingLight {
  switch (status) {
    case "live":
      return { lamp: "red", label: "Recording" };
    case "connecting":
      return { lamp: "amber", label: "Connecting…" };
    case "stopping":
      return { lamp: "amber", label: "Stopping…" };
    // idle and error both sit at "ready to record" — on error the separate
    // error banner carries the detail, the light just says you can try again.
    default:
      return { lamp: "green", label: "Ready" };
  }
}
