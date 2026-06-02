// Mints a short-lived ephemeral token for the browser to open a direct OpenAI
// Realtime transcription session. The secret OPENAI_API_KEY lives only here on the
// server; the browser only ever receives the throwaway token.
//
// Verified shape (2026-06-01): a successful response is
//   { value: "ek_…", expires_at: <unix>, session: { … } }
// The browser only needs `value`; we return it as `token`.

const OPENAI_CLIENT_SECRETS_URL = "https://api.openai.com/v1/realtime/client_secrets";

// Streaming-oriented transcription model. Set server-side so we can tune latency vs.
// accuracy without shipping client changes. Alternatives: gpt-4o-transcribe (more
// accurate, more latency), gpt-4o-mini-transcribe.
const TRANSCRIPTION_MODEL = "gpt-realtime-whisper";

export async function GET() {
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
            // NOTE: gpt-realtime-whisper segments natively and rejects turn_detection.
            // If we switch to a gpt-4o-transcribe model we can add server_vad here.
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
