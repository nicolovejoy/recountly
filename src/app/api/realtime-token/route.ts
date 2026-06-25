// Mints a short-lived ephemeral token for the browser to open a direct OpenAI
// Realtime transcription session. The secret OPENAI_API_KEY lives only here on the
// server; the browser only ever receives the throwaway token.
//
// Verified shape (2026-06-01): a successful response is
//   { value: "ek_…", expires_at: <unix>, session: { … } }
// The browser only needs `value`; we return it as `token`.

const OPENAI_CLIENT_SECRETS_URL = "https://api.openai.com/v1/realtime/client_secrets";

// Transcription model. Set server-side so we can tune latency vs. accuracy without
// shipping client changes. Alternatives: gpt-4o-mini-transcribe (faster, cheaper),
// whisper-1 (legacy).
//
// IMPORTANT: this MUST be a real model. The mint endpoint does NOT validate the model
// name — it returns a token for any string — but the WebRTC call setup at
// /v1/realtime/calls then hangs ~15s and Cloudflare returns a 504 (with no CORS
// headers, so the browser misreports it as a CORS error). A bogus name here was the
// Phase 1 "CORS bug". Verified working models (2026-06-03): gpt-4o-transcribe,
// gpt-4o-mini-transcribe, whisper-1.
const TRANSCRIPTION_MODEL = "gpt-4o-transcribe";

import { getServerSession } from "@/lib/auth-server";

export async function GET() {
  if (!(await getServerSession())) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return Response.json(
      { error: "OPENAI_API_KEY is not set on the server" },
      { status: 500 },
    );
  }

  const res = await fetch(OPENAI_CLIENT_SECRETS_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      session: {
        type: "transcription",
        audio: {
          input: {
            transcription: { model: TRANSCRIPTION_MODEL, language: "en" },
            // NOTE: gpt-4o-transcribe relies on turn detection to decide when to commit
            // a segment and emit a completed transcript. If the live demo shows interim
            // deltas but no committed segments, add turn_detection: { type: "server_vad" }
            // here. Left off until the demo proves whether it's needed.
          },
        },
      },
    }),
  });

  if (!res.ok) {
    const detail = await res.text();
    return Response.json(
      { error: "Failed to mint ephemeral token", upstreamStatus: res.status, detail },
      { status: 502 },
    );
  }

  const data = (await res.json()) as { value: string; expires_at: number };
  return Response.json({ token: data.value, expiresAt: data.expires_at });
}
