// Pure statement-splitter for db/schema.sql (PR B). The neon HTTP driver used
// by migrate.mjs runs one statement per call, so the runner has always split
// the file on `;`. That naive split breaks a `DO $$ ... $$` block (the PR B
// FTS rebuild needs one) because the block's own internal statements end in
// `;` too. This treats any `$tag$ ... $tag$` dollar-quoted span (`$$...$$` or
// `$foo$...$foo$`) as opaque — semicolons inside it never split a statement.
// No I/O; unit-tested in sql-split.test.mjs.

// Strips `--` line comments first (an inline comment can itself contain a
// `;`, which would otherwise split a statement mid-way). Comments are never
// expected inside a dollar-quoted block in this file, so stripping ahead of
// the dollar-quote scan (rather than during it) is safe and simpler.
function stripLineComments(sql) {
  return sql
    .split("\n")
    .map((line) => {
      const i = line.indexOf("--");
      return i >= 0 ? line.slice(0, i) : line;
    })
    .join("\n");
}

const DOLLAR_TAG_START = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/;

export function splitSqlStatements(sql) {
  const s = stripLineComments(sql);
  const statements = [];
  let current = "";
  let dollarTag = null; // the exact opening tag (e.g. "$$" or "$body$") while inside one; else null

  let i = 0;
  while (i < s.length) {
    if (dollarTag) {
      if (s.startsWith(dollarTag, i)) {
        current += dollarTag;
        i += dollarTag.length;
        dollarTag = null;
      } else {
        current += s[i];
        i += 1;
      }
      continue;
    }

    const m = DOLLAR_TAG_START.exec(s.slice(i));
    if (m) {
      dollarTag = m[0];
      current += m[0];
      i += m[0].length;
      continue;
    }

    if (s[i] === ";") {
      const trimmed = current.trim();
      if (trimmed) statements.push(trimmed);
      current = "";
      i += 1;
      continue;
    }

    current += s[i];
    i += 1;
  }

  const trimmed = current.trim();
  if (trimmed) statements.push(trimmed);
  return statements;
}
