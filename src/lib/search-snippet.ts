// Search-result snippet building (owner ask, 2026-07-28): a result card's
// transcript preview should, when a search query is active, be windowed
// around the FIRST occurrence of a query term (not always the top of the
// transcript), highlight every occurrence visible in that window, and expose
// a match count so the UI can show "(1 of 3)". Pure + tested, no DOM: this
// returns structured segments, never an HTML string — the component renders
// them itself (no dangerouslySetInnerHTML).

export interface SnippetSegment {
  text: string;
  match: boolean;
}

export interface SearchSnippetOptions {
  // Characters of context kept on each side of the first match. Large enough
  // to swallow a whole short string (e.g. a title) so nothing gets windowed.
  contextChars?: number;
}

export interface SearchSnippetResult {
  segments: SnippetSegment[];
  // Occurrences found across the WHOLE text, not just the visible window —
  // that's what "(1 of 3)" counts. 0 means no match at all (see fallback below).
  matchCount: number;
  // 1-based index of the occurrence the snippet is centered on. Always 1 (or
  // 0 when there's no match) — we only ever center on the first hit — kept as
  // a field because the shape is inherently "which one of N is shown".
  shownIndex: number;
}

const DEFAULT_CONTEXT_CHARS = 90;
// Stem/prefix fallback terms shorter than this are skipped — a 1-char term
// would prefix-match nearly every word and highlight the whole transcript.
const MIN_STEM_TERM_LEN = 2;

// websearch_to_tsquery syntax the query box accepts: "quoted phrases",
// -negated terms, and OR. Negated terms are dropped entirely (never matched,
// never highlighted); OR/AND are operators, not terms; a quoted phrase is
// kept as one multi-word unit so phrase matching can try it as a whole first.
export function parseQueryTerms(query: string): string[][] {
  const terms: string[][] = [];
  const re = /"([^"]*)"|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(query))) {
    if (m[1] !== undefined) {
      const negated = query[m.index - 1] === "-";
      if (negated) continue;
      const words = m[1].trim().split(/\s+/).filter(Boolean);
      if (words.length > 0) terms.push(words);
      continue;
    }
    const token = m[2];
    if (!token || token.startsWith("-")) continue;
    if (/^(OR|AND)$/i.test(token)) continue;
    // Strip stray quote chars an unbalanced phrase can leave on a bare token.
    const cleaned = token.replace(/^["']+|["']+$/g, "");
    if (cleaned) terms.push([cleaned]);
  }
  return terms;
}

interface WordToken {
  word: string;
  start: number;
  end: number;
}

function tokenizeWords(text: string): WordToken[] {
  const tokens: WordToken[] = [];
  const re = /[A-Za-z0-9']+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    tokens.push({ word: m[0], start: m.index, end: m.index + m[0].length });
  }
  return tokens;
}

interface MatchSpan {
  start: number;
  end: number;
}

// Exact (case-insensitive) matching. A multi-word term first tries to match
// as a contiguous phrase ("treat phrase content as a unit if simple"); if the
// phrase never occurs as a unit anywhere, it falls back to matching each of
// its words independently ("otherwise per-word").
function findExactMatches(tokens: WordToken[], terms: string[][]): MatchSpan[] {
  const spans: MatchSpan[] = [];
  for (const words of terms) {
    if (words.length > 1) {
      let foundPhrase = false;
      for (let i = 0; i + words.length <= tokens.length; i++) {
        let ok = true;
        for (let j = 0; j < words.length; j++) {
          if (tokens[i + j].word.toLowerCase() !== words[j].toLowerCase()) {
            ok = false;
            break;
          }
        }
        if (ok) {
          spans.push({ start: tokens[i].start, end: tokens[i + words.length - 1].end });
          foundPhrase = true;
        }
      }
      if (foundPhrase) continue;
    }
    for (const w of words) {
      const wl = w.toLowerCase();
      for (const t of tokens) {
        if (t.word.toLowerCase() === wl) spans.push({ start: t.start, end: t.end });
      }
    }
  }
  return spans;
}

// Postgres FTS matches stems ("running" → "run"), so a result entry can have
// zero literal occurrences of the typed word. Fallback: a term matches a text
// word that starts with it, or vice versa (typed "running" highlights "run";
// typed "run" highlights "running"). Only tried when the exact pass found
// nothing at all, across the whole query.
function findStemMatches(tokens: WordToken[], terms: string[][]): MatchSpan[] {
  const spans: MatchSpan[] = [];
  for (const words of terms) {
    for (const w of words) {
      const wl = w.toLowerCase();
      if (wl.length < MIN_STEM_TERM_LEN) continue;
      for (const t of tokens) {
        const tl = t.word.toLowerCase();
        if (tl.startsWith(wl) || wl.startsWith(tl)) spans.push({ start: t.start, end: t.end });
      }
    }
  }
  return spans;
}

function mergeSpans(spans: MatchSpan[]): MatchSpan[] {
  if (spans.length === 0) return [];
  const sorted = [...spans].sort((a, b) => a.start - b.start || a.end - b.end);
  const merged: MatchSpan[] = [{ ...sorted[0] }];
  for (const s of sorted.slice(1)) {
    const last = merged[merged.length - 1];
    if (s.start <= last.end) last.end = Math.max(last.end, s.end);
    else merged.push({ ...s });
  }
  return merged;
}

export function buildSearchSnippet(
  text: string,
  query: string,
  opts: SearchSnippetOptions = {},
): SearchSnippetResult {
  const contextChars = opts.contextChars ?? DEFAULT_CONTEXT_CHARS;
  const noMatch = (): SearchSnippetResult => ({
    segments: [{ text, match: false }],
    matchCount: 0,
    shownIndex: 0,
  });

  const terms = parseQueryTerms(query);
  if (!text || terms.length === 0) return noMatch();

  const tokens = tokenizeWords(text);
  let spans = mergeSpans(findExactMatches(tokens, terms));
  // Falls back to the plain from-the-top preview with NO count indicator when
  // even the stem/prefix pass finds nothing — a genuinely unrelated FTS hit
  // (e.g. matched on title, or a stem too different to prefix-match).
  if (spans.length === 0) spans = mergeSpans(findStemMatches(tokens, terms));
  if (spans.length === 0) return noMatch();

  const first = spans[0];
  let windowStart = Math.max(0, first.start - contextChars);
  let windowEnd = Math.min(text.length, first.end + contextChars);

  // Snap the window edges out to whitespace so a trimmed edge doesn't slice a
  // word in half.
  if (windowStart > 0) {
    const nextSpace = text.indexOf(" ", windowStart);
    if (nextSpace !== -1 && nextSpace < first.start) windowStart = nextSpace + 1;
  }
  if (windowEnd < text.length) {
    const prevSpace = text.lastIndexOf(" ", windowEnd);
    if (prevSpace !== -1 && prevSpace > first.end) windowEnd = prevSpace;
  }

  const segments: SnippetSegment[] = [];
  if (windowStart > 0) segments.push({ text: "…", match: false });

  const visible = spans.filter((s) => s.start < windowEnd && s.end > windowStart);
  let cursor = windowStart;
  for (const s of visible) {
    const start = Math.max(s.start, windowStart);
    const end = Math.min(s.end, windowEnd);
    if (start > cursor) segments.push({ text: text.slice(cursor, start), match: false });
    segments.push({ text: text.slice(start, end), match: true });
    cursor = end;
  }
  if (cursor < windowEnd) segments.push({ text: text.slice(cursor, windowEnd), match: false });
  if (windowEnd < text.length) segments.push({ text: "…", match: false });

  return { segments, matchCount: spans.length, shownIndex: 1 };
}
