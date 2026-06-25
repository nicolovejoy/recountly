// One-off importer for the old AudioJournal markdown transcripts (Phase 4).
// Walks <JOURNAL_DIR>/transcripts/<year>/*.md, parses each (journal-parse.mjs),
// uploads the matching audio/<year>/*.m4a to private Vercel Blob, runs LLM
// enrichment (claude-haiku-4-5), and inserts a row — keyed on a deterministic
// id so re-runs skip what's already imported.
//
// DRY RUN BY DEFAULT — prints what it would do without touching the DB, Blob, or
// the Anthropic API. Pass --commit to actually write.
//
//   node --env-file=.env.local scripts/import-journal.mjs            # dry run
//   node --env-file=.env.local scripts/import-journal.mjs --commit   # for real
//
// JOURNAL_DIR overrides the source (default: ~/Documents/AudioJournal).

import { neon } from "@neondatabase/serverless";
import { put } from "@vercel/blob";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, basename } from "node:path";
import { homedir } from "node:os";
import {
  parseRecordedAt,
  importId,
  extractTranscript,
  parseAudioRef,
} from "./journal-parse.mjs";

const COMMIT = process.argv.includes("--commit");
const ROOT = process.env.JOURNAL_DIR || join(homedir(), "Documents", "AudioJournal");
const M4A_MIME = "audio/mp4"; // .m4a → audio/mp4; audioBlobPath stores it as .mp4

// Mirror src/lib/blob.ts so the stored path matches what GET /api/audio/[id]
// reconstructs via audioBlobPath(id, "audio/mp4") → "audio/<id>.mp4".
const blobPath = (id) => `audio/${id}.mp4`;
const proxyPath = (id) => `/api/audio/${id}`;

const EnrichmentSchema = z.object({
  title: z.string(),
  tags: z.array(z.string()),
  summary: z.string(),
});
const ENRICH_MODEL = "claude-haiku-4-5";

function buildPrompt(transcript) {
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

// Same normalization as src/lib/enrich.ts (kept in step with it).
function normalizeTags(v) {
  if (!Array.isArray(v)) return [];
  const out = [];
  const seen = new Set();
  for (const item of v) {
    if (typeof item !== "string") continue;
    const tag = item.trim().toLowerCase().slice(0, 30).trim();
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    out.push(tag);
    if (out.length >= 5) break;
  }
  return out;
}
function cap(v, max) {
  if (typeof v !== "string") return null;
  const t = v.trim();
  if (!t) return null;
  return t.length > max ? t.slice(0, max).trimEnd() : t;
}

async function enrich(anthropic, transcript) {
  try {
    const res = await anthropic.messages.parse({
      model: ENRICH_MODEL,
      max_tokens: 1024,
      output_config: { format: zodOutputFormat(EnrichmentSchema) },
      messages: [{ role: "user", content: buildPrompt(transcript) }],
    });
    const o = res.parsed_output;
    if (!o) return null;
    return { title: cap(o.title, 80), tags: normalizeTags(o.tags), summary: cap(o.summary, 300) };
  } catch (err) {
    console.warn("  enrichment failed (best-effort):", String(err).split("\n")[0]);
    return null;
  }
}

const INSERT = `INSERT INTO entries
  (id, recorded_at, created_at, updated_at, duration_seconds, transcript, title, tags,
   audio_url, audio_mime, audio_bytes, audio_complete, summary, enriched_at, enrichment_model)
  VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
  ON CONFLICT (id) DO NOTHING`;

function gatherFiles() {
  const tDir = join(ROOT, "transcripts");
  if (!existsSync(tDir)) {
    console.error(`No transcripts dir at ${tDir} (set JOURNAL_DIR?)`);
    process.exit(1);
  }
  const files = [];
  for (const year of readdirSync(tDir)) {
    const yDir = join(tDir, year);
    for (const name of readdirSync(yDir)) {
      if (name.endsWith(".md")) files.push({ year, name, path: join(yDir, name) });
    }
  }
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

async function main() {
  console.log(`Source: ${ROOT}`);
  console.log(COMMIT ? "Mode: COMMIT (writing to DB + Blob + Anthropic)\n" : "Mode: DRY RUN (no writes)\n");

  const sql = COMMIT ? neon(process.env.DATABASE_URL) : null;
  const anthropic = COMMIT ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }) : null;

  let imported = 0;
  let skipped = 0;
  let withAudio = 0;
  let enriched = 0;

  for (const f of gatherFiles()) {
    const baseNoExt = basename(f.name, ".md");
    const id = importId(f.year, baseNoExt);
    const md = readFileSync(f.path, "utf8");
    const transcript = extractTranscript(md);
    if (!transcript) {
      console.log(`SKIP ${id} — no transcript`);
      skipped++;
      continue;
    }
    const recordedAt = parseRecordedAt(baseNoExt, f.year).toISOString();
    const { fileName, durationSeconds } = parseAudioRef(md);
    const audioPath = fileName ? join(ROOT, "audio", f.year, fileName) : null;
    const hasAudio = Boolean(audioPath && existsSync(audioPath));

    if (!COMMIT) {
      console.log(
        `WOULD IMPORT ${id} @ ${recordedAt} | ${durationSeconds ?? "?"}s | audio:${hasAudio ? "yes" : "no"} | "${transcript.slice(0, 60).replace(/\n/g, " ")}…"`,
      );
      imported++;
      if (hasAudio) withAudio++;
      continue;
    }

    const existing = await sql.query("SELECT 1 FROM entries WHERE id = $1", [id]);
    if (existing.length) {
      console.log(`SKIP ${id} — already imported`);
      skipped++;
      continue;
    }

    let audioUrl = null;
    let audioMime = null;
    let audioBytes = null;
    let audioComplete = null;
    if (hasAudio) {
      try {
        const buf = readFileSync(audioPath);
        await put(blobPath(id), buf, { access: "private", contentType: M4A_MIME });
        audioUrl = proxyPath(id);
        audioMime = M4A_MIME;
        audioBytes = buf.length;
        audioComplete = true; // single continuous recording
        withAudio++;
      } catch (err) {
        console.warn(`  audio upload failed for ${id} (saving without):`, String(err).split("\n")[0]);
      }
    }

    const e = await enrich(anthropic, transcript);
    const now = new Date().toISOString();
    if (e) enriched++;

    await sql.query(INSERT, [
      id,
      recordedAt,
      now,
      now,
      durationSeconds ?? 0,
      transcript,
      e?.title ?? null,
      e?.tags ?? [],
      audioUrl,
      audioMime,
      audioBytes,
      audioComplete,
      e?.summary ?? null,
      e ? now : null,
      e ? ENRICH_MODEL : null,
    ]);
    console.log(`IMPORTED ${id} @ ${recordedAt} | audio:${audioUrl ? "yes" : "no"} | enriched:${e ? "yes" : "no"}`);
    imported++;
  }

  console.log(
    `\n${COMMIT ? "Imported" : "Would import"} ${imported}, skipped ${skipped}, with audio ${withAudio}${COMMIT ? `, enriched ${enriched}` : ""}.`,
  );
  if (!COMMIT) console.log("Re-run with --commit to write.");
}

await main();
