import { describe, it, expect } from "vitest";
import { splitSqlStatements } from "./sql-split.mjs";

describe("splitSqlStatements", () => {
  it("splits plain statements on ';'", () => {
    const out = splitSqlStatements("SELECT 1; SELECT 2;");
    expect(out).toEqual(["SELECT 1", "SELECT 2"]);
  });

  it("trims whitespace and drops empty statements", () => {
    const out = splitSqlStatements("  SELECT 1;  \n\n ; \n SELECT 2  ");
    expect(out).toEqual(["SELECT 1", "SELECT 2"]);
  });

  it("strips '--' line comments before splitting", () => {
    const out = splitSqlStatements("SELECT 1; -- a comment with a ; inside\nSELECT 2;");
    expect(out).toEqual(["SELECT 1", "SELECT 2"]);
  });

  it("keeps a statement with no trailing semicolon", () => {
    const out = splitSqlStatements("SELECT 1;\nSELECT 2");
    expect(out).toEqual(["SELECT 1", "SELECT 2"]);
  });

  it("does not split on semicolons inside a $$ ... $$ dollar-quoted block", () => {
    const sql = [
      "DO $$",
      "BEGIN",
      "  IF EXISTS (SELECT 1) THEN",
      "    EXECUTE 'ALTER TABLE entries DROP COLUMN transcript_tsv';",
      "  END IF;",
      "END $$;",
    ].join("\n");
    const out = splitSqlStatements(sql);
    expect(out).toHaveLength(1);
    expect(out[0]).toContain("EXECUTE 'ALTER TABLE entries DROP COLUMN transcript_tsv';");
    expect(out[0]).toContain("END IF;");
    expect(out[0].trim().endsWith("END $$")).toBe(true);
  });

  it("resumes normal splitting after a dollar-quoted block closes", () => {
    const sql = "DO $$ BEGIN NULL; END $$; ALTER TABLE entries ADD COLUMN IF NOT EXISTS foo text;";
    const out = splitSqlStatements(sql);
    expect(out).toEqual([
      "DO $$ BEGIN NULL; END $$",
      "ALTER TABLE entries ADD COLUMN IF NOT EXISTS foo text",
    ]);
  });

  it("handles a tagged dollar-quote ($tag$ ... $tag$), not just bare $$", () => {
    const sql = "DO $body$ BEGIN NULL; END $body$; SELECT 1;";
    const out = splitSqlStatements(sql);
    expect(out).toEqual(["DO $body$ BEGIN NULL; END $body$", "SELECT 1"]);
  });

  it("the exact PR B FTS-rebuild DO block round-trips as one statement", () => {
    const sql = `DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'entries' AND column_name = 'transcript_tsv'
      AND (generation_expression IS NULL OR generation_expression NOT LIKE '%notes%')
  ) THEN
    EXECUTE 'ALTER TABLE entries DROP COLUMN transcript_tsv';
  END IF;
END $$;
ALTER TABLE entries ADD COLUMN IF NOT EXISTS transcript_tsv tsvector
  GENERATED ALWAYS AS (
    to_tsvector('english',
      coalesce(title, '') || ' ' || coalesce(notes, '') || ' ' ||
      coalesce(location, '') || ' ' || transcript)
  ) STORED;
CREATE INDEX IF NOT EXISTS entries_transcript_tsv_gin ON entries USING gin (transcript_tsv);`;
    const out = splitSqlStatements(sql);
    expect(out).toHaveLength(3);
    expect(out[0]).toMatch(/^DO \$\$/);
    expect(out[0]).toContain("NOT LIKE '%notes%'");
    expect(out[1]).toMatch(/^ALTER TABLE entries ADD COLUMN IF NOT EXISTS transcript_tsv/);
    expect(out[2]).toBe(
      "CREATE INDEX IF NOT EXISTS entries_transcript_tsv_gin ON entries USING gin (transcript_tsv)",
    );
  });

  it("returns an empty array for blank input", () => {
    expect(splitSqlStatements("   \n  ")).toEqual([]);
  });
});
