// What onStop should do when Done fires, decided in one place. With client-direct
// blob uploads (issue #23) the only pre-save gate left is an empty transcript —
// the 4 MB body budget is gone (uploads go straight to Blob, capped by the token
// route, not the POST body).
export type SavePlan = { kind: "empty" } | { kind: "save" };

export function planSave(transcript: string): SavePlan {
  if (transcript.trim().length === 0) return { kind: "empty" };
  return { kind: "save" };
}
