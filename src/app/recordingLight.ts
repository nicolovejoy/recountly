// Stoplight indicator for the recorder, using the ON-AIR studio convention:
//   green = ready/standby (cleared to record), orange = transitioning,
//   red = live recording. This pure mapping pins the status -> lamp/label
//   product decision (unit-tested in recordingLight.test.ts).

export type RecordingStatus = "idle" | "connecting" | "live" | "stopping" | "error";

export type Lamp = "red" | "orange" | "green";

export interface RecordingLight {
  lamp: Lamp;
  label: string;
}

export function recordingLight(status: RecordingStatus): RecordingLight {
  switch (status) {
    case "live":
      return { lamp: "red", label: "Live" };
    case "connecting":
      return { lamp: "orange", label: "Connecting…" };
    case "stopping":
      return { lamp: "orange", label: "Stopping…" };
    // idle and error both sit at "ready to record" — on error the separate
    // error banner carries the detail, the light just says you can try again.
    default:
      return { lamp: "green", label: "Ready" };
  }
}
