// Typed OpenAI Realtime data-channel events (unit-tested in
// realtime-events.test.ts) — no React, no DOM.
//
// The realtime API's event shapes are the shifty part of this stack (see the
// model-name gotcha in api/realtime-token/route.ts), so all knowledge of them
// lives here, behind a parse function. parseRealtimeEvent is what makes the
// union honestly discriminated: TS can't express "any string except these
// literals", so unparseable payloads, unrecognized types, and recognized types
// missing their payload field all map to the explicit "unknown" arm — callers
// can switch exhaustively and log unknowns without re-inspecting raw JSON.

export type RealtimeError = { message?: string; code?: string; type?: string };

export type RealtimeEvent =
  | { type: "conversation.item.input_audio_transcription.delta"; delta: string }
  | { type: "conversation.item.input_audio_transcription.completed"; transcript: string }
  | { type: "conversation.item.input_audio_transcription.failed"; error?: RealtimeError }
  | { type: "error"; error?: RealtimeError }
  | { type: "unknown"; rawType: string; text?: string };

export function parseRealtimeEvent(data: string): RealtimeEvent {
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(data) as Record<string, unknown>;
  } catch {
    return { type: "unknown", rawType: "(unparseable)", text: data.slice(0, 80) };
  }

  const type = typeof raw.type === "string" ? raw.type : "(no type)";

  switch (type) {
    case "conversation.item.input_audio_transcription.delta":
      if (typeof raw.delta === "string") return { type, delta: raw.delta };
      break;
    case "conversation.item.input_audio_transcription.completed":
      if (typeof raw.transcript === "string") return { type, transcript: raw.transcript };
      break;
    case "conversation.item.input_audio_transcription.failed":
    case "error":
      return { type, error: asError(raw.error) };
  }

  // Unrecognized type (or a recognized one missing its payload): keep whatever
  // human-readable snippet is available for the raw event log.
  const text = [raw.delta, raw.transcript].find((v) => typeof v === "string") as
    | string
    | undefined;
  return { type: "unknown", rawType: type, text };
}

function asError(v: unknown): RealtimeError | undefined {
  if (typeof v !== "object" || v === null) return undefined;
  const o = v as Record<string, unknown>;
  return {
    message: typeof o.message === "string" ? o.message : undefined,
    code: typeof o.code === "string" ? o.code : undefined,
    type: typeof o.type === "string" ? o.type : undefined,
  };
}
