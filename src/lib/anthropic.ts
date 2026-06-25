// Anthropic client — lazy + cached singleton, mirroring db.ts's lazy-neon
// pattern. The constructor reads ANTHROPIC_API_KEY; building it at import would
// crash `next build` before the env is provisioned, so we build on first use.
// Callers that want testability inject a fake client instead (see enrich.ts).

import Anthropic from "@anthropic-ai/sdk";

let cached: Anthropic | null = null;

export function getAnthropic(): Anthropic {
  if (!cached) {
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) throw new Error("ANTHROPIC_API_KEY is not set");
    cached = new Anthropic({ apiKey: key });
  }
  return cached;
}
