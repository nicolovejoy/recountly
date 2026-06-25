// LLM enrichment (Phase 4 thread 1) — turn a raw transcript into a title, a
// handful of tags, and a short summary via one structured-output call to Claude
// Haiku. Best-effort: any failure returns null and the caller saves the entry
// without enrichment (the raw transcript is never touched). The prompt-building
// and normalization are pure + unit-tested; the API client is injectable so the
// logic is testable with a fake (no live API), mirroring db.ts's QueryRunner.

import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { EntryEnrichment } from "./entry";
import { getAnthropic } from "./anthropic";

// Haiku is the deliberate cost/latency call for this simple structured task
// (one-line swap to "claude-opus-4-8" if title/summary quality disappoints).
export const ENRICHMENT_MODEL = "claude-haiku-4-5";

// Caps so a runaway model response can't bloat the row or the UI.
const MAX_TITLE = 80;
const MAX_SUMMARY = 300;
const MAX_TAG = 30;
const MAX_TAGS = 5;

// Structured-output schema. Kept constraint-free (no min/max) — we do our own
// trimming/capping in normalizeEnrichment so the model is never rejected for a
// length the schema could have enforced.
const EnrichmentSchema = z.object({
  title: z.string(),
  tags: z.array(z.string()),
  summary: z.string(),
});

// What the model returns (loosely typed — normalize is defensive).
export interface RawEnrichment {
  title?: unknown;
  tags?: unknown;
  summary?: unknown;
}

// The slice of the Anthropic client we depend on — injectable for tests.
// Typed loosely on purpose: the real client's .parse() is heavily overloaded,
// so callers pass it via an `as unknown as` cast (see the default below), the
// same trick blob.ts uses for put().
export interface EnrichClient {
  messages: {
    parse(body: unknown): Promise<{ parsed_output: RawEnrichment | null }>;
  };
}

export function buildEnrichmentPrompt(transcript: string): string {
  return [
    "You are labeling an entry in a personal spoken-word journal.",
    "Given the raw transcript below, produce:",
    "- title: a short, specific title (about 8 words max), no surrounding quotes.",
    "- tags: up to 5 lowercase topical tags (single words or short phrases).",
    "- summary: a 1–2 sentence summary written in the third person.",
    "Base everything strictly on what the transcript says — do not invent facts.",
    "",
    "Transcript:",
    transcript,
  ].join("\n");
}

function cleanString(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const trimmed = v.trim();
  if (!trimmed) return null;
  return trimmed.length > max ? trimmed.slice(0, max).trimEnd() : trimmed;
}

// Trim, lowercase, dedupe, drop empties, cap each tag's length, and keep at
// most MAX_TAGS. Non-array / non-string entries are ignored.
function cleanTags(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of v) {
    if (typeof item !== "string") continue;
    const tag = item.trim().toLowerCase().slice(0, MAX_TAG).trim();
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    out.push(tag);
    if (out.length >= MAX_TAGS) break;
  }
  return out;
}

export function normalizeEnrichment(raw: RawEnrichment, model: string): EntryEnrichment {
  return {
    title: cleanString(raw.title, MAX_TITLE),
    tags: cleanTags(raw.tags),
    summary: cleanString(raw.summary, MAX_SUMMARY),
    model,
  };
}

// Run one structured-output call and normalize the result. Returns null on any
// failure (no parsed output, network error, etc.) — enrichment is best-effort.
export async function enrichTranscript(
  transcript: string,
  client: EnrichClient = getAnthropic() as unknown as EnrichClient,
  model: string = ENRICHMENT_MODEL,
): Promise<EntryEnrichment | null> {
  try {
    const res = await client.messages.parse({
      model,
      max_tokens: 1024,
      output_config: { format: zodOutputFormat(EnrichmentSchema) },
      messages: [{ role: "user", content: buildEnrichmentPrompt(transcript) }],
    });
    if (!res.parsed_output) return null;
    return normalizeEnrichment(res.parsed_output, model);
  } catch {
    // Best-effort — a failed call must not fail the save.
    return null;
  }
}
