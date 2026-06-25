// Pure parsers for the old AudioJournal markdown transcripts (Phase 4 import).
// No I/O — given a filename + file text, produce the fields recountly stores.
// Unit-tested in journal-parse.test.mjs; the importer (import-journal.mjs) wires
// these to the DB/Blob/enrichment side effects.

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

// Filename "JUL_28_08.46" (no extension) + a year → a Date in LOCAL time. The
// importer runs on the owner's Mac, so local construction yields the right
// wall-clock instant (the title line's time is informal; the filename is the
// canonical structured source). Throws on a malformed name.
export function parseRecordedAt(filenameNoExt, year) {
  const m = /^([A-Z]{3})_(\d{2})_(\d{2})\.(\d{2})$/.exec(filenameNoExt);
  if (!m) throw new Error(`unparseable journal filename: ${filenameNoExt}`);
  const monthIdx = MONTHS.indexOf(m[1]);
  if (monthIdx < 0) throw new Error(`unknown month in filename: ${filenameNoExt}`);
  return new Date(Number(year), monthIdx, Number(m[2]), Number(m[3]), Number(m[4]));
}

// Deterministic, human-readable id so re-running the import is idempotent
// (insert ... ON CONFLICT DO NOTHING / skip-if-present keys on this).
export function importId(year, filenameNoExt) {
  return `imp_${year}_${filenameNoExt}`;
}

// Pull the prose out of the `## Transcript` section: everything up to the next
// `---` rule or `##` heading. Strips `[MM:SS]` segment markers (the 2026 files
// carry them; per the v1 non-goals we don't keep per-segment timestamps) and
// collapses runs of blank lines. Returns "" when there's no transcript section.
export function extractTranscript(markdown) {
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex((l) => /^##\s+Transcript\s*$/i.test(l));
  if (start < 0) return "";
  const body = [];
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];
    if (/^---\s*$/.test(line) || /^##\s/.test(line)) break;
    body.push(line);
  }
  return body
    .join("\n")
    .replace(/\[\d{1,2}:\d{2}\]\s*/g, "") // drop [MM:SS] markers
    .replace(/\n{3,}/g, "\n\n") // collapse blank-line runs
    .trim();
}

// Parse the `**Audio:** `name.m4a` | **Duration:** 62s | ...` header line.
// Duration is either `62s` or `MM:SS`. Returns nulls when a field is absent.
export function parseAudioRef(markdown) {
  const file = /\*\*Audio:\*\*\s*`([^`]+)`/.exec(markdown);
  let durationSeconds = null;
  const secs = /\*\*Duration:\*\*\s*(\d+)s\b/.exec(markdown);
  const clock = /\*\*Duration:\*\*\s*(\d+):(\d{2})\b/.exec(markdown);
  if (secs) durationSeconds = Number(secs[1]);
  else if (clock) durationSeconds = Number(clock[1]) * 60 + Number(clock[2]);
  return { fileName: file ? file[1] : null, durationSeconds };
}
