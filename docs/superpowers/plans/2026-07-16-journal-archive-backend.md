# Physical Journal Archive — Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the backend for ingesting physical paper journals: a `journals` table with an active-journal flag, `entries.journal_id` + `entries.written_at`, a `photos` child table with verified (NOT best-effort) private-blob upload, an auth-gated photo proxy, and journal-aware search — GitHub issues #15, #16, and the backend half of #18.

**Architecture:** Mirrors the existing layering exactly: pure unit-tested SQL builders + row mappers in `src/lib/` (driver-free), a thin `db.ts` glue with an injectable `QueryRunner`, private Vercel Blob storage keyed by ULID, and thin Next.js route handlers that lean entirely on the tested lib. No UI in this plan.

**Tech Stack:** Next.js 16 (App Router) route handlers, TypeScript, `@neondatabase/serverless`, `@vercel/blob` (private access), Vitest (node env), pnpm 9.

## Global Constraints

- **Photos are NOT best-effort.** A failed photo upload must fail the whole save with a visible error and no entry insert. Never wrap `uploadPhoto` in a swallow-and-continue catch the way audio does. (Issue #10 — silent private-audio upload failures — is the reason.)
- **Photo blobs are PRIVATE** (`access: "private"`), served only through the auth-gated proxy `GET /api/photo/[id]`. `photos` rows never store a blob URL — the path is derived from the id.
- **The written-at column is named `written_at`** — never `occurred_at` (decided in docs/physical-journal-archive.md).
- **No photo-only entries.** `transcript`, `duration_seconds`, `recorded_at` keep their NOT NULLs. Drawings get a spoken description as their transcript (owner decision 2026-07-16).
- **Still single-user.** No `user_id` anywhere (Garm decision, CLAUDE.md).
- Every API route checks `getServerSession()` from `@/lib/auth-server` and returns 401 when absent — copy the exact pattern from `src/app/api/entries/route.ts`.
- **Next.js 16:** dynamic route params arrive as a Promise — `{ params }: { params: Promise<{ id: string }> }` then `await params` (see `src/app/api/audio/[id]/route.ts`). Consult `node_modules/next/dist/docs/` before writing anything non-trivial in a route handler.
- All new pure logic is test-first (TDD) in Vitest, node env, no DOM/DB/network. The suite currently has 161 tests; `pnpm test` must stay fully green after every task.
- `db/schema.sql` stays idempotent (CREATE TABLE IF NOT EXISTS / ADD COLUMN IF NOT EXISTS); it is applied with `pnpm db:migrate` against the shared `recountly-db` (local + prod share it).
- Package manager is pnpm 9 on Node 20 — never upgrade pnpm.
- Date/sort semantics: an entry's *effective* date is `coalesce(written_at, recorded_at)` — list ordering and search date filters use it; the FTS mechanism itself is untouched.

---

### Task 1: Schema — journals, photos, journal_id, written_at

**Files:**
- Modify: `db/schema.sql` (append at end)

**Interfaces:**
- Consumes: nothing.
- Produces: tables/columns later tasks insert into: `journals(id, label, notes, active, created_at)`, `photos(id, entry_id, mime, bytes, created_at)`, `entries.journal_id`, `entries.written_at`.

- [ ] **Step 1: Append the journal-archive DDL to `db/schema.sql`**

Append this block at the end of the file:

```sql
-- Physical journal archive (2026-07-16, issues #15/#16). A journal groups
-- readings by the paper notebook they came from; `active` marks the notebook
-- currently being read so captures default to it (exactly one active row is
-- maintained app-side by setActiveJournalSql's single UPDATE).
CREATE TABLE IF NOT EXISTS journals (
  id         text        PRIMARY KEY,           -- ULID (src/lib/ulid.ts)
  label      text        NOT NULL,
  notes      text,                              -- optional free text
  active     boolean     NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Which notebook an entry belongs to (null = a normal spoken entry) and when
-- the page was originally *written* — as distinct from recorded_at, which for
-- a legacy page is when it was read aloud. NOT named occurred_at (see
-- docs/physical-journal-archive.md).
ALTER TABLE entries ADD COLUMN IF NOT EXISTS journal_id text REFERENCES journals(id);
ALTER TABLE entries ADD COLUMN IF NOT EXISTS written_at timestamptz;

-- Page photos, 1 entry — * photos. Blobs are PRIVATE, named photos/<id>.<ext>
-- (path derived from id — no URL column), served via the auth-gated
-- GET /api/photo/[id] proxy. Photos are NOT best-effort: a failed upload
-- fails the save (issue #10 is why).
CREATE TABLE IF NOT EXISTS photos (
  id         text        PRIMARY KEY,           -- ULID; capture-ordered
  entry_id   text        NOT NULL REFERENCES entries(id),
  mime       text        NOT NULL,
  bytes      integer     NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS photos_entry_id ON photos (entry_id);

-- The entry's *effective* date: when written if known, else when spoken.
-- List ordering and search date filters use this expression.
CREATE INDEX IF NOT EXISTS entries_effective_at_desc
  ON entries ((coalesce(written_at, recorded_at)) DESC);
```

- [ ] **Step 2: Apply the migration**

Run: `pnpm db:migrate`
Expected: exits 0 (idempotent — safe even if re-run).

- [ ] **Step 3: Verify with introspection**

Run: `pnpm db:introspect`
Expected: output lists tables `journals` (0 rows) and `photos` (0 rows), and `entries` now shows columns `journal_id` and `written_at`.

- [ ] **Step 4: Confirm existing suite untouched**

Run: `pnpm test`
Expected: all 161 tests pass.

- [ ] **Step 5: Commit**

```bash
git add db/schema.sql
git commit -m "feat(db): journals + photos tables, entries.journal_id/written_at (#15)"
```

---

### Task 2: Thread journalId/writtenAt through entry domain, SQL, and search

**Files:**
- Modify: `src/lib/entry.ts`
- Modify: `src/lib/entry-sql.ts`
- Modify: `src/lib/search.ts`
- Test: `src/lib/entry.test.ts`, `src/lib/entry-sql.test.ts`, `src/lib/search.test.ts` (extend existing files)

**Interfaces:**
- Consumes: Task 1's columns.
- Produces: `EntryInput.journalId?/writtenAt?` (ISO strings), `EntryRecord.journalId/writtenAt` (`string | null`), `SearchFilters.journalId?: string`, `parseSearchFilters` reading `?journal=`, `buildSearchQueryString` writing `journal=`. Exports `toIso(v: unknown): string` from `entry-sql.ts` (currently private — Tasks 3/5 reuse it).

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/entry.test.ts` (inside the file, new describes at the end):

```ts
describe("journal archive fields (Phase: physical journals)", () => {
  it("accepts journalId + writtenAt and carries them onto the record", () => {
    const input = {
      transcript: "read from the red notebook",
      durationSeconds: 30,
      journalId: "01JRNL",
      writtenAt: "1994-03-02T00:00:00.000Z",
    };
    expect(validateEntryInput(input)).toEqual([]);
    const rec = buildEntryRecord(input, {
      id: "01HX",
      audioUrl: null,
      now: new Date("2026-07-16T10:00:00Z"),
    });
    expect(rec.journalId).toBe("01JRNL");
    expect(rec.writtenAt).toBe("1994-03-02T00:00:00.000Z");
  });

  it("defaults journalId and writtenAt to null for a normal spoken entry", () => {
    const rec = buildEntryRecord(
      { transcript: "hi", durationSeconds: 1 },
      { id: "01HX", audioUrl: null, now: new Date("2026-07-16T10:00:00Z") },
    );
    expect(rec.journalId).toBeNull();
    expect(rec.writtenAt).toBeNull();
  });

  it("rejects a blank journalId and an unparseable writtenAt", () => {
    const errors = validateEntryInput({
      transcript: "hi",
      durationSeconds: 1,
      journalId: "  ",
      writtenAt: "not-a-date",
    });
    expect(errors).toContain("journalId must be a non-empty string");
    expect(errors).toContain("writtenAt must be a valid date");
  });
});
```

Append to `src/lib/entry-sql.test.ts`:

```ts
describe("journal archive columns", () => {
  it("insertEntrySql carries journal_id and written_at as $16/$17", () => {
    const rec: EntryRecord = {
      ...baseRecordFromExistingTests, // reuse the file's existing sample EntryRecord constant, adding:
      journalId: "01JRNL",
      writtenAt: "1994-03-02T00:00:00.000Z",
    };
    const q = insertEntrySql(rec);
    expect(q.text).toContain("journal_id, written_at");
    expect(q.values).toHaveLength(17);
    expect(q.values[15]).toBe("01JRNL");
    expect(q.values[16]).toBe("1994-03-02T00:00:00.000Z");
  });

  it("rowToEntry maps journal_id/written_at, defaulting to null", () => {
    const withNulls = rowToEntry({ ...sampleRowFromExistingTests });
    expect(withNulls.journalId).toBeNull();
    expect(withNulls.writtenAt).toBeNull();
    const withValues = rowToEntry({
      ...sampleRowFromExistingTests,
      journal_id: "01JRNL",
      written_at: new Date("1994-03-02T00:00:00.000Z"),
    });
    expect(withValues.journalId).toBe("01JRNL");
    expect(withValues.writtenAt).toBe("1994-03-02T00:00:00.000Z");
  });
});

describe("searchEntriesSql effective-date + journal filter", () => {
  it("orders by coalesce(written_at, recorded_at) DESC when unranked", () => {
    const q = searchEntriesSql({});
    expect(q.text).toContain("ORDER BY coalesce(written_at, recorded_at) DESC");
  });

  it("applies date bounds to the effective date", () => {
    const q = searchEntriesSql({ from: "1994-01-01", to: "1994-12-31" });
    expect(q.text).toContain("coalesce(written_at, recorded_at) >= $1::date");
    expect(q.text).toContain("coalesce(written_at, recorded_at) < ($2::date + 1)");
  });

  it("filters by journalId", () => {
    const q = searchEntriesSql({ journalId: "01JRNL" });
    expect(q.text).toContain("journal_id = $1");
    expect(q.values[0]).toBe("01JRNL");
  });

  it("combines query + journal + dates with sequential placeholders", () => {
    const q = searchEntriesSql({ query: "cabin", journalId: "01JRNL", from: "1994-01-01" });
    expect(q.values).toEqual(["cabin", "01JRNL", "1994-01-01", 50]);
  });
});
```

(The two `...FromExistingTests` spreads refer to the sample `EntryRecord` / `EntryRow` constants already defined at the top of each test file — extend the existing `EntryRecord` constant with `journalId: null, writtenAt: null` so it still typechecks.)

Append to `src/lib/search.test.ts`:

```ts
describe("journal filter param", () => {
  it("parses ?journal= into journalId, dropping blanks", () => {
    expect(parseSearchFilters(new URLSearchParams("journal=01JRNL"))).toEqual({
      journalId: "01JRNL",
    });
    expect(parseSearchFilters(new URLSearchParams("journal=%20%20"))).toEqual({});
  });

  it("round-trips journalId through buildSearchQueryString", () => {
    expect(buildSearchQueryString({ journalId: "01JRNL", query: "cabin" })).toBe(
      "?q=cabin&journal=01JRNL",
    );
  });
});
```

- [ ] **Step 2: Run the new tests to verify they fail**

Run: `pnpm test`
Expected: FAIL — type errors / missing fields (`journalId` not on `EntryInput`, etc.).

- [ ] **Step 3: Implement**

`src/lib/entry.ts` — add to `EntryInput` (after `recordedAt`):

```ts
  // Physical-journal archive: the notebook this reading belongs to (absent for
  // a normal spoken entry), and when the page was originally *written* — as
  // distinct from recordedAt, which for a legacy page is when it was read aloud.
  journalId?: string;
  writtenAt?: string;
```

Add to `EntryRecord` (after `recordedAt`):

```ts
  // Null for a normal spoken entry; set when the entry is a journal reading.
  journalId: string | null;
  // When the page was written (vs recordedAt = when read aloud). Sorting and
  // date search use coalesce(written_at, recorded_at).
  writtenAt: string | null;
```

Add to `validateEntryInput` (before the `return`):

```ts
  if (input.journalId != null && (typeof input.journalId !== "string" || input.journalId.trim().length === 0)) {
    errors.push("journalId must be a non-empty string");
  }
  if (input.writtenAt != null && Number.isNaN(Date.parse(input.writtenAt))) {
    errors.push("writtenAt must be a valid date");
  }
```

Add to the object literal in `buildEntryRecord` (after `recordedAt`):

```ts
    journalId: input.journalId ?? null,
    writtenAt: input.writtenAt ?? null,
```

`src/lib/entry-sql.ts`:

1. `COLUMNS` gains two trailing columns:

```ts
const COLUMNS =
  "id, recorded_at, created_at, updated_at, duration_seconds, transcript, title, tags, audio_url, audio_mime, audio_bytes, audio_complete, summary, enriched_at, enrichment_model, journal_id, written_at";
```

2. `insertEntrySql` — placeholders extend to `$17`; append to `values`:

```ts
      rec.journalId,
      rec.writtenAt,
```

3. Export `toIso` (change `function toIso` to `export function toIso`) — Tasks 3 and 5 reuse it.

4. `rowToEntry` — add:

```ts
    journalId: row.journal_id == null ? null : String(row.journal_id),
    writtenAt: row.written_at == null ? null : toIso(row.written_at),
```

5. `SearchFilters` gains:

```ts
  journalId?: string; // exact match on entries.journal_id
```

6. In `searchEntriesSql`, define the effective-date expression and use it for dates and ordering, and add the journal filter after the query block:

```ts
  const EFFECTIVE_AT = "coalesce(written_at, recorded_at)";
  // ...
  if (f.journalId) where.push(`journal_id = ${next(f.journalId)}`);
  if (f.from) where.push(`${EFFECTIVE_AT} >= ${next(f.from)}::date`);
  if (f.to) where.push(`${EFFECTIVE_AT} < (${next(f.to)}::date + 1)`);
  // ...
  const orderSql = rankExpr
    ? ` ORDER BY ${rankExpr} DESC, ${EFFECTIVE_AT} DESC`
    : ` ORDER BY ${EFFECTIVE_AT} DESC`;
```

7. `listEntriesSql` — same effective-date ordering:

```ts
    text: `SELECT ${COLUMNS} FROM entries ORDER BY coalesce(written_at, recorded_at) DESC LIMIT $1`,
```

`src/lib/search.ts`:

```ts
// in parseSearchFilters, after the `to` block:
  const journal = params.get("journal")?.trim();
  if (journal) out.journalId = journal;

// in buildSearchQueryString, after the `to` line:
  if (f.journalId) params.set("journal", f.journalId);
```

Also update the existing sample `EntryRecord` constants in `src/lib/db.test.ts` and `src/lib/entry-sql.test.ts` (and any other test file that constructs a full `EntryRecord`) with `journalId: null, writtenAt: null` so they typecheck. If an existing test asserts `insertEntrySql` has 15 values or `listEntriesSql` orders by `recorded_at DESC`, update it to the new truth (17 values; effective-date ordering).

- [ ] **Step 4: Run the full suite**

Run: `pnpm test`
Expected: PASS (161 existing + the new tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/entry.ts src/lib/entry-sql.ts src/lib/search.ts src/lib/entry.test.ts src/lib/entry-sql.test.ts src/lib/search.test.ts src/lib/db.test.ts
git commit -m "feat(entries): journalId + writtenAt threaded through domain/SQL; effective-date search + journal filter (#15, #18)"
```

---

### Task 3: Journals lib — types, SQL builders, data access

**Files:**
- Create: `src/lib/journal.ts`
- Modify: `src/lib/db.ts`
- Test: `src/lib/journal.test.ts` (create), `src/lib/db.test.ts` (extend)

**Interfaces:**
- Consumes: `SqlQuery` + `toIso` from `./entry-sql` (Task 2), `QueryRunner` from `./db`.
- Produces: `JournalRecord { id, label, notes, active, createdAt }`, `validateJournalInput(input: { label?: unknown; notes?: unknown }): string[]`, `insertJournalSql`, `listJournalsSql`, `setActiveJournalSql(id: string | null)`, `rowToJournal`; db functions `insertJournal(j, runner?)`, `listJournals(runner?)`, `setActiveJournal(id, runner?)`.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/journal.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  validateJournalInput,
  insertJournalSql,
  listJournalsSql,
  setActiveJournalSql,
  rowToJournal,
  type JournalRecord,
} from "./journal";

const journal: JournalRecord = {
  id: "01JRNL",
  label: "Red notebook 1994",
  notes: null,
  active: false,
  createdAt: "2026-07-16T10:00:00.000Z",
};

describe("validateJournalInput", () => {
  it("accepts a non-empty label with optional notes", () => {
    expect(validateJournalInput({ label: "Red notebook" })).toEqual([]);
    expect(validateJournalInput({ label: "Red", notes: "college years" })).toEqual([]);
  });
  it("rejects a missing or blank label", () => {
    expect(validateJournalInput({})).toContain("label is required");
    expect(validateJournalInput({ label: "   " })).toContain("label is required");
  });
  it("rejects non-string notes", () => {
    expect(validateJournalInput({ label: "ok", notes: 42 })).toContain(
      "notes must be a string",
    );
  });
});

describe("insertJournalSql", () => {
  it("inserts all five columns parameterized", () => {
    const q = insertJournalSql(journal);
    expect(q.text).toBe(
      "INSERT INTO journals (id, label, notes, active, created_at) VALUES ($1, $2, $3, $4, $5)",
    );
    expect(q.values).toEqual(["01JRNL", "Red notebook 1994", null, false, "2026-07-16T10:00:00.000Z"]);
  });
});

describe("listJournalsSql", () => {
  it("lists active-first, then newest-first", () => {
    const q = listJournalsSql();
    expect(q.text).toContain("ORDER BY active DESC, created_at DESC");
    expect(q.values).toEqual([]);
  });
});

describe("setActiveJournalSql", () => {
  it("activates one journal and deactivates the rest in a single statement", () => {
    const q = setActiveJournalSql("01JRNL");
    expect(q.text).toBe("UPDATE journals SET active = (id = $1)");
    expect(q.values).toEqual(["01JRNL"]);
  });
  it("null deactivates all", () => {
    const q = setActiveJournalSql(null);
    expect(q.text).toBe("UPDATE journals SET active = false WHERE active");
    expect(q.values).toEqual([]);
  });
});

describe("rowToJournal", () => {
  it("maps snake_case and coerces the timestamp to ISO", () => {
    expect(
      rowToJournal({
        id: "01JRNL",
        label: "Red notebook 1994",
        notes: null,
        active: true,
        created_at: new Date("2026-07-16T10:00:00.000Z"),
      }),
    ).toEqual({
      id: "01JRNL",
      label: "Red notebook 1994",
      notes: null,
      active: true,
      createdAt: "2026-07-16T10:00:00.000Z",
    });
  });
});
```

Append to `src/lib/db.test.ts`:

```ts
import { insertJournal, listJournals, setActiveJournal } from "./db";
import type { JournalRecord } from "./journal";

describe("journal data access", () => {
  const j: JournalRecord = {
    id: "01JRNL",
    label: "Red notebook 1994",
    notes: null,
    active: false,
    createdAt: "2026-07-16T10:00:00.000Z",
  };

  it("insertJournal runs the parameterized INSERT", async () => {
    const { runner, calls } = fakeRunner();
    await insertJournal(j, runner);
    expect(calls[0].text).toContain("INSERT INTO journals");
    expect(calls[0].values[0]).toBe("01JRNL");
  });

  it("listJournals maps rows to JournalRecords", async () => {
    const { runner } = fakeRunner([
      { id: "01JRNL", label: "Red", notes: null, active: true, created_at: "2026-07-16T10:00:00.000Z" },
    ]);
    const out = await listJournals(runner);
    expect(out).toEqual([
      { id: "01JRNL", label: "Red", notes: null, active: true, createdAt: "2026-07-16T10:00:00.000Z" },
    ]);
  });

  it("setActiveJournal runs the single-statement toggle", async () => {
    const { runner, calls } = fakeRunner();
    await setActiveJournal("01JRNL", runner);
    expect(calls[0].text).toBe("UPDATE journals SET active = (id = $1)");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm test`
Expected: FAIL — `./journal` module not found.

- [ ] **Step 3: Implement `src/lib/journal.ts`**

```ts
// Physical-journal archive (issue #15): the journals table groups readings by
// the paper notebook they came from. Same layering as entries — pure SQL
// builders + row mapping here (unit-tested, no driver), executed by db.ts.
// `active` marks the notebook currently being read so captures default to it;
// setActiveJournalSql keeps "at most one active" atomic in a single UPDATE.

import { toIso, type SqlQuery } from "./entry-sql";

export interface JournalRecord {
  id: string;
  label: string;
  notes: string | null;
  active: boolean;
  createdAt: string;
}

// Human-readable problems; empty means valid (same contract as validateEntryInput).
export function validateJournalInput(input: { label?: unknown; notes?: unknown }): string[] {
  const errors: string[] = [];
  if (typeof input.label !== "string" || input.label.trim().length === 0) {
    errors.push("label is required");
  }
  if (input.notes != null && typeof input.notes !== "string") {
    errors.push("notes must be a string");
  }
  return errors;
}

const COLUMNS = "id, label, notes, active, created_at";

export function insertJournalSql(j: JournalRecord): SqlQuery {
  return {
    text: `INSERT INTO journals (${COLUMNS}) VALUES ($1, $2, $3, $4, $5)`,
    values: [j.id, j.label, j.notes, j.active, j.createdAt],
  };
}

// Active journal first (the picker's default), then newest-first.
export function listJournalsSql(): SqlQuery {
  return {
    text: `SELECT ${COLUMNS} FROM journals ORDER BY active DESC, created_at DESC`,
    values: [],
  };
}

// Activating one journal deactivates every other row in the same statement;
// null means "no active journal".
export function setActiveJournalSql(id: string | null): SqlQuery {
  if (id == null) {
    return { text: "UPDATE journals SET active = false WHERE active", values: [] };
  }
  return { text: "UPDATE journals SET active = (id = $1)", values: [id] };
}

export function rowToJournal(row: Record<string, unknown>): JournalRecord {
  return {
    id: String(row.id),
    label: String(row.label),
    notes: row.notes == null ? null : String(row.notes),
    active: Boolean(row.active),
    createdAt: toIso(row.created_at),
  };
}
```

Append to `src/lib/db.ts` (imports at top, functions at bottom):

```ts
import {
  insertJournalSql,
  listJournalsSql,
  setActiveJournalSql,
  rowToJournal,
  type JournalRecord,
} from "./journal";

// Journals (physical-journal archive).
export async function insertJournal(
  j: JournalRecord,
  runner: QueryRunner = defaultRunner(),
): Promise<JournalRecord> {
  const { text, values } = insertJournalSql(j);
  await runner.query(text, values);
  return j;
}

export async function listJournals(
  runner: QueryRunner = defaultRunner(),
): Promise<JournalRecord[]> {
  const { text, values } = listJournalsSql();
  const rows = await runner.query(text, values);
  return rows.map(rowToJournal);
}

export async function setActiveJournal(
  id: string | null,
  runner: QueryRunner = defaultRunner(),
): Promise<void> {
  const { text, values } = setActiveJournalSql(id);
  await runner.query(text, values);
}
```

- [ ] **Step 4: Run the full suite**

Run: `pnpm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/journal.ts src/lib/journal.test.ts src/lib/db.ts src/lib/db.test.ts
git commit -m "feat(journals): journal domain — SQL builders, row mapping, data access (#15)"
```

---

### Task 4: Journals API routes

**Files:**
- Create: `src/app/api/journals/route.ts`
- Create: `src/app/api/journals/active/route.ts`

**Interfaces:**
- Consumes: `validateJournalInput`, `JournalRecord` from `@/lib/journal`; `insertJournal`, `listJournals`, `setActiveJournal` from `@/lib/db`; `ulid` from `@/lib/ulid`; `getServerSession` from `@/lib/auth-server`.
- Produces: `GET /api/journals` → `{ journals: JournalRecord[] }`; `POST /api/journals` body `{ label, notes? }` → 201 `{ journal }`; `PUT /api/journals/active` body `{ id: string | null }` → `{ ok: true }`.

(Route handlers are thin glue over the tested lib — the existing routes carry no unit tests and these follow suit; verification is typecheck/build.)

- [ ] **Step 1: Create `src/app/api/journals/route.ts`**

```ts
// Journals API (physical-journal archive, issue #15).
//   GET  /api/journals — list, active-first then newest-first
//   POST /api/journals — create ({ label, notes? }), never active on creation
// All logic (validation, SQL, mapping) is unit-tested in src/lib/journal.ts.

import { ulid } from "@/lib/ulid";
import { validateJournalInput, type JournalRecord } from "@/lib/journal";
import { insertJournal, listJournals } from "@/lib/db";
import { getServerSession } from "@/lib/auth-server";

export async function GET() {
  if (!(await getServerSession())) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const journals = await listJournals();
    return Response.json({ journals });
  } catch (err) {
    return Response.json(
      { error: "Failed to list journals", detail: String(err) },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  if (!(await getServerSession())) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  let body: { label?: unknown; notes?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Expected JSON body" }, { status: 400 });
  }
  const errors = validateJournalInput(body);
  if (errors.length) {
    return Response.json({ error: "Invalid journal", problems: errors }, { status: 400 });
  }
  const journal: JournalRecord = {
    id: ulid(),
    label: (body.label as string).trim(),
    notes: typeof body.notes === "string" && body.notes.trim() ? body.notes.trim() : null,
    active: false,
    createdAt: new Date().toISOString(),
  };
  try {
    await insertJournal(journal);
  } catch (err) {
    return Response.json(
      { error: "Failed to create journal", detail: String(err) },
      { status: 500 },
    );
  }
  return Response.json({ journal }, { status: 201 });
}
```

- [ ] **Step 2: Create `src/app/api/journals/active/route.ts`**

```ts
// Active-journal lock (physical-journal archive, issue #15). Exactly one
// journal may be active; captures default to it. PUT { id } activates that
// journal (deactivating the rest atomically); PUT { id: null } clears the lock.

import { setActiveJournal } from "@/lib/db";
import { getServerSession } from "@/lib/auth-server";

export async function PUT(request: Request) {
  if (!(await getServerSession())) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  let body: { id?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Expected JSON body" }, { status: 400 });
  }
  if (body.id !== null && (typeof body.id !== "string" || body.id.length === 0)) {
    return Response.json(
      { error: "id must be a journal id string or null" },
      { status: 400 },
    );
  }
  try {
    await setActiveJournal(body.id as string | null);
  } catch (err) {
    return Response.json(
      { error: "Failed to set active journal", detail: String(err) },
      { status: 500 },
    );
  }
  return Response.json({ ok: true });
}
```

- [ ] **Step 3: Verify it compiles and the suite is green**

Run: `pnpm test && pnpm lint && pnpm build`
Expected: tests PASS, lint clean, build succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/journals
git commit -m "feat(journals): GET/POST /api/journals + PUT /api/journals/active (#15)"
```

---

### Task 5: Photos lib — paths, upload, SQL builders, data access

**Files:**
- Create: `src/lib/photo.ts`
- Modify: `src/lib/db.ts`
- Test: `src/lib/photo.test.ts` (create), `src/lib/db.test.ts` (extend)

**Interfaces:**
- Consumes: `SqlQuery`/`toIso` from `./entry-sql`, `PutFn` from `./blob`, `QueryRunner` from `./db`, `put` from `@vercel/blob`.
- Produces: `imageExtension(mime): string`, `photoBlobPath(id, mime): string` (`photos/<id>.<ext>`), `photoProxyPath(id): string` (`/api/photo/<id>`), `PhotoRecord { id, entryId, mime, bytes, createdAt }`, `insertPhotoSql`, `listPhotosByEntrySql(entryId)`, `getPhotoSql(id)`, `rowToPhoto`, `uploadPhoto(id, body, mime, bytes, putFn?)`; db functions `insertPhoto(p, runner?)`, `listPhotosByEntry(entryId, runner?)`, `getPhoto(id, runner?)`.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/photo.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  imageExtension,
  photoBlobPath,
  photoProxyPath,
  insertPhotoSql,
  listPhotosByEntrySql,
  getPhotoSql,
  rowToPhoto,
  uploadPhoto,
  type PhotoRecord,
} from "./photo";
import type { PutFn } from "./blob";

describe("imageExtension", () => {
  it("maps common image mimes", () => {
    expect(imageExtension("image/jpeg")).toBe("jpg");
    expect(imageExtension("image/png")).toBe("png");
    expect(imageExtension("image/webp")).toBe("webp");
    expect(imageExtension("image/heic")).toBe("heic");
    expect(imageExtension("image/gif")).toBe("gif");
  });
  it("falls back to .bin for unknown types", () => {
    expect(imageExtension("application/pdf")).toBe("bin");
  });
});

describe("photoBlobPath / photoProxyPath", () => {
  it("keys the private blob by photo id under photos/", () => {
    expect(photoBlobPath("01PHOTO", "image/jpeg")).toBe("photos/01PHOTO.jpg");
  });
  it("serves playback through the gated same-origin proxy", () => {
    expect(photoProxyPath("01PHOTO")).toBe("/api/photo/01PHOTO");
  });
});

const photo: PhotoRecord = {
  id: "01PHOTO",
  entryId: "01ENTRY",
  mime: "image/jpeg",
  bytes: 123_456,
  createdAt: "2026-07-16T10:00:00.000Z",
};

describe("photo SQL builders", () => {
  it("insertPhotoSql inserts all five columns parameterized", () => {
    const q = insertPhotoSql(photo);
    expect(q.text).toBe(
      "INSERT INTO photos (id, entry_id, mime, bytes, created_at) VALUES ($1, $2, $3, $4, $5)",
    );
    expect(q.values).toEqual(["01PHOTO", "01ENTRY", "image/jpeg", 123_456, "2026-07-16T10:00:00.000Z"]);
  });
  it("listPhotosByEntrySql orders by id (ULIDs = capture order)", () => {
    const q = listPhotosByEntrySql("01ENTRY");
    expect(q.text).toContain("WHERE entry_id = $1 ORDER BY id");
    expect(q.values).toEqual(["01ENTRY"]);
  });
  it("getPhotoSql fetches one by id", () => {
    const q = getPhotoSql("01PHOTO");
    expect(q.text).toContain("WHERE id = $1");
    expect(q.values).toEqual(["01PHOTO"]);
  });
});

describe("rowToPhoto", () => {
  it("maps snake_case and coerces the timestamp", () => {
    expect(
      rowToPhoto({
        id: "01PHOTO",
        entry_id: "01ENTRY",
        mime: "image/jpeg",
        bytes: 5,
        created_at: new Date("2026-07-16T10:00:00.000Z"),
      }),
    ).toEqual({
      id: "01PHOTO",
      entryId: "01ENTRY",
      mime: "image/jpeg",
      bytes: 5,
      createdAt: "2026-07-16T10:00:00.000Z",
    });
  });
});

describe("uploadPhoto", () => {
  it("puts to the id-derived path as a PRIVATE blob", async () => {
    const calls: { path: string; opts: unknown }[] = [];
    const fakePut: PutFn = async (path, _body, opts) => {
      calls.push({ path, opts });
      return { url: `https://blob.example/${path}` };
    };
    const out = await uploadPhoto("01PHOTO", new ArrayBuffer(4), "image/jpeg", 4, fakePut);
    expect(calls[0].path).toBe("photos/01PHOTO.jpg");
    expect(calls[0].opts).toMatchObject({ access: "private", contentType: "image/jpeg" });
    expect(out).toEqual({ pathname: "photos/01PHOTO.jpg", bytes: 4, mime: "image/jpeg" });
  });

  it("propagates upload failures — photos are NOT best-effort", async () => {
    const failingPut: PutFn = async () => {
      throw new Error("store rejected");
    };
    await expect(
      uploadPhoto("01PHOTO", new ArrayBuffer(4), "image/jpeg", 4, failingPut),
    ).rejects.toThrow("store rejected");
  });
});
```

Append to `src/lib/db.test.ts`:

```ts
import { insertPhoto, listPhotosByEntry, getPhoto } from "./db";
import type { PhotoRecord } from "./photo";

describe("photo data access", () => {
  const p: PhotoRecord = {
    id: "01PHOTO",
    entryId: "01ENTRY",
    mime: "image/jpeg",
    bytes: 5,
    createdAt: "2026-07-16T10:00:00.000Z",
  };
  const row = {
    id: "01PHOTO",
    entry_id: "01ENTRY",
    mime: "image/jpeg",
    bytes: 5,
    created_at: "2026-07-16T10:00:00.000Z",
  };

  it("insertPhoto runs the parameterized INSERT", async () => {
    const { runner, calls } = fakeRunner();
    await insertPhoto(p, runner);
    expect(calls[0].text).toContain("INSERT INTO photos");
    expect(calls[0].values[0]).toBe("01PHOTO");
  });

  it("listPhotosByEntry maps rows", async () => {
    const { runner } = fakeRunner([row]);
    expect(await listPhotosByEntry("01ENTRY", runner)).toEqual([p]);
  });

  it("getPhoto returns null when absent", async () => {
    const { runner } = fakeRunner([]);
    expect(await getPhoto("01PHOTO", runner)).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm test`
Expected: FAIL — `./photo` module not found.

- [ ] **Step 3: Implement `src/lib/photo.ts`**

```ts
// Page-photo storage (physical-journal archive, issue #16). Photos are PRIVATE
// blobs keyed by photo id, served only through the auth-gated GET /api/photo/[id]
// proxy — the photos table stores no URL; the path derives from the id.
//
// ⚠️ NOT best-effort, unlike audio: uploadPhoto never swallows errors, and
// callers must let a throw fail the whole save. Issue #10 (weeks of silently
// lost audio) is the reason — a lost page photo is unrecoverable.

import { put } from "@vercel/blob";
import { toIso, type SqlQuery } from "./entry-sql";
import type { PutFn } from "./blob";

export function imageExtension(mime: string): string {
  const base = mime.split(";")[0].trim().toLowerCase();
  switch (base) {
    case "image/jpeg":
      return "jpg";
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    case "image/heic":
      return "heic";
    case "image/gif":
      return "gif";
    default:
      return "bin";
  }
}

export function photoBlobPath(id: string, mime: string): string {
  return `photos/${id}.${imageExtension(mime)}`;
}

export function photoProxyPath(id: string): string {
  return `/api/photo/${id}`;
}

export interface PhotoRecord {
  id: string;
  entryId: string;
  mime: string;
  bytes: number;
  createdAt: string;
}

const COLUMNS = "id, entry_id, mime, bytes, created_at";

export function insertPhotoSql(p: PhotoRecord): SqlQuery {
  return {
    text: `INSERT INTO photos (${COLUMNS}) VALUES ($1, $2, $3, $4, $5)`,
    values: [p.id, p.entryId, p.mime, p.bytes, p.createdAt],
  };
}

// ULIDs sort by mint time, so ordering by id is capture order.
export function listPhotosByEntrySql(entryId: string): SqlQuery {
  return {
    text: `SELECT ${COLUMNS} FROM photos WHERE entry_id = $1 ORDER BY id`,
    values: [entryId],
  };
}

export function getPhotoSql(id: string): SqlQuery {
  return {
    text: `SELECT ${COLUMNS} FROM photos WHERE id = $1`,
    values: [id],
  };
}

export function rowToPhoto(row: Record<string, unknown>): PhotoRecord {
  return {
    id: String(row.id),
    entryId: String(row.entry_id),
    mime: String(row.mime),
    bytes: Number(row.bytes),
    createdAt: toIso(row.created_at),
  };
}

export interface UploadedPhoto {
  pathname: string;
  bytes: number;
  mime: string;
}

export async function uploadPhoto(
  id: string,
  body: Blob | ArrayBuffer | Buffer,
  mime: string,
  bytes: number,
  putFn: PutFn = put as unknown as PutFn,
): Promise<UploadedPhoto> {
  const pathname = photoBlobPath(id, mime);
  await putFn(pathname, body, { access: "private", contentType: mime });
  return { pathname, bytes, mime };
}
```

Append to `src/lib/db.ts`:

```ts
import {
  insertPhotoSql,
  listPhotosByEntrySql,
  getPhotoSql,
  rowToPhoto,
  type PhotoRecord,
} from "./photo";

// Photos (physical-journal archive). NOT best-effort — callers let errors throw.
export async function insertPhoto(
  p: PhotoRecord,
  runner: QueryRunner = defaultRunner(),
): Promise<PhotoRecord> {
  const { text, values } = insertPhotoSql(p);
  await runner.query(text, values);
  return p;
}

export async function listPhotosByEntry(
  entryId: string,
  runner: QueryRunner = defaultRunner(),
): Promise<PhotoRecord[]> {
  const { text, values } = listPhotosByEntrySql(entryId);
  const rows = await runner.query(text, values);
  return rows.map(rowToPhoto);
}

export async function getPhoto(
  id: string,
  runner: QueryRunner = defaultRunner(),
): Promise<PhotoRecord | null> {
  const { text, values } = getPhotoSql(id);
  const rows = await runner.query(text, values);
  return rows.length ? rowToPhoto(rows[0]) : null;
}
```

- [ ] **Step 4: Run the full suite**

Run: `pnpm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/photo.ts src/lib/photo.test.ts src/lib/db.ts src/lib/db.test.ts
git commit -m "feat(photos): photo domain — private blob paths, upload, SQL, data access (#16)"
```

---

### Task 6: Photo proxy + per-entry photo listing routes

**Files:**
- Create: `src/app/api/photo/[id]/route.ts`
- Create: `src/app/api/entries/[id]/photos/route.ts`

**Interfaces:**
- Consumes: `getPhoto`, `listPhotosByEntry` from `@/lib/db`; `photoBlobPath` from `@/lib/photo`; `get` from `@vercel/blob`; `getServerSession`.
- Produces: `GET /api/photo/[id]` → streams the private image blob (200, Content-Type from the record); `GET /api/entries/[id]/photos` → `{ photos: PhotoRecord[] }`.

- [ ] **Step 1: Create `src/app/api/photo/[id]/route.ts`** (mirror of the audio proxy)

```ts
// Photo proxy (physical-journal archive, issue #16).
//   GET /api/photo/[id] — stream one private page-photo blob.
// Photos are stored access:"private" so they are NOT world-readable by URL;
// this auth-gated route looks up the photo row for its mime, fetches the
// private blob server-side, and streams it back to the authenticated owner.
// Mirrors GET /api/audio/[id].

import { get } from "@vercel/blob";
import { getPhoto } from "@/lib/db";
import { photoBlobPath } from "@/lib/photo";
import { getServerSession } from "@/lib/auth-server";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!(await getServerSession())) {
    return new Response("Unauthorized", { status: 401 });
  }
  const { id } = await params;

  let photo;
  try {
    photo = await getPhoto(id);
  } catch (err) {
    return Response.json(
      { error: "Failed to look up photo", detail: String(err) },
      { status: 500 },
    );
  }
  if (!photo) {
    return new Response("Not found", { status: 404 });
  }

  let result;
  try {
    result = await get(photoBlobPath(id, photo.mime), { access: "private" });
  } catch (err) {
    return Response.json(
      { error: "Failed to fetch photo", detail: String(err) },
      { status: 502 },
    );
  }
  if (!result || result.statusCode !== 200) {
    return new Response("Not found", { status: 404 });
  }

  return new Response(result.stream, {
    headers: {
      "Content-Type": result.blob.contentType ?? photo.mime,
      "Content-Length": String(result.blob.size),
      "Cache-Control": "private, max-age=31536000, immutable",
    },
  });
}
```

- [ ] **Step 2: Create `src/app/api/entries/[id]/photos/route.ts`**

```ts
// Per-entry photo listing (physical-journal archive, issue #16).
//   GET /api/entries/[id]/photos — the photo records for one entry, capture
// order. The client renders each via the gated proxy (/api/photo/<id>).

import { listPhotosByEntry } from "@/lib/db";
import { getServerSession } from "@/lib/auth-server";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!(await getServerSession())) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  try {
    const photos = await listPhotosByEntry(id);
    return Response.json({ photos });
  } catch (err) {
    return Response.json(
      { error: "Failed to list photos", detail: String(err) },
      { status: 500 },
    );
  }
}
```

- [ ] **Step 3: Verify**

Run: `pnpm test && pnpm lint && pnpm build`
Expected: tests PASS, lint clean, build succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/photo src/app/api/entries/[id]
git commit -m "feat(photos): auth-gated GET /api/photo/[id] proxy + per-entry photo listing (#16)"
```

---

### Task 7: Save path — entry form contract + POST /api/entries with verified photos

**Files:**
- Modify: `src/lib/entry-form.ts`
- Modify: `src/app/api/entries/route.ts`
- Test: `src/lib/entry-form.test.ts` (extend)

**Interfaces:**
- Consumes: `imageExtension`, `uploadPhoto`, `photoProxyPath`, `PhotoRecord` from `@/lib/photo`; `insertPhoto` from `@/lib/db`; Task 2's `EntryInput.journalId/writtenAt`.
- Produces: `EntrySavePayload.journalId?/writtenAt?/photos?: { blob: Blob; mime: string }[]`; FormData fields `journalId`, `writtenAt`, repeated `photo`; POST response 201 gains `photos: { id: string; url: string }[]`.

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/entry-form.test.ts`:

```ts
describe("journal archive fields", () => {
  it("carries journalId and writtenAt when present", () => {
    const fd = buildEntryFormData({
      transcript: "read aloud",
      durationSeconds: 30,
      journalId: "01JRNL",
      writtenAt: "1994-03-02T00:00:00.000Z",
    });
    expect(fd.get("journalId")).toBe("01JRNL");
    expect(fd.get("writtenAt")).toBe("1994-03-02T00:00:00.000Z");
  });

  it("omits journal fields for a normal spoken entry", () => {
    const fd = buildEntryFormData({ transcript: "hi", durationSeconds: 1 });
    expect(fd.get("journalId")).toBeNull();
    expect(fd.get("writtenAt")).toBeNull();
  });

  it("appends each photo under the repeated 'photo' field, skipping empties", () => {
    const jpeg = new Blob([new Uint8Array([1, 2, 3])], { type: "image/jpeg" });
    const empty = new Blob([], { type: "image/png" });
    const fd = buildEntryFormData({
      transcript: "page one",
      durationSeconds: 10,
      photos: [
        { blob: jpeg, mime: "image/jpeg" },
        { blob: empty, mime: "image/png" },
      ],
    });
    const photos = fd.getAll("photo");
    expect(photos).toHaveLength(1);
    expect((photos[0] as File).name).toBe("photo.jpg");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm test`
Expected: FAIL — `journalId` not on `EntrySavePayload`.

- [ ] **Step 3: Implement `src/lib/entry-form.ts` changes**

Add to the import: `import { imageExtension } from "./photo";`

Add to `EntrySavePayload` (after `audio`):

```ts
  /** Physical-journal archive: the notebook this reading belongs to. */
  journalId?: string;
  /** When the page was originally written (ISO). */
  writtenAt?: string;
  /**
   * Page photos. NOT best-effort — the route fails the whole save if any
   * photo can't be stored, so the client must surface that error.
   */
  photos?: { blob: Blob; mime: string }[];
```

Add to `buildEntryFormData` (before the `return`):

```ts
  if (p.journalId) fd.set("journalId", p.journalId);
  if (p.writtenAt) fd.set("writtenAt", p.writtenAt);
  for (const photo of p.photos ?? []) {
    if (photo.blob.size > 0) {
      fd.append("photo", photo.blob, `photo.${imageExtension(photo.mime)}`);
    }
  }
```

- [ ] **Step 4: Extend `src/app/api/entries/route.ts` (POST)**

Add imports:

```ts
import { uploadPhoto, photoProxyPath, type PhotoRecord } from "@/lib/photo";
import { insertPhoto } from "@/lib/db";
```

After the `recordedAt` block, parse the new fields:

```ts
  const journalId = form.get("journalId");
  if (typeof journalId === "string" && journalId) input.journalId = journalId;
  const writtenAt = form.get("writtenAt");
  if (typeof writtenAt === "string" && writtenAt) input.writtenAt = writtenAt;
```

After the `hasAudio` block, collect + validate photos (photo problems join the 400 with validation errors — reject before any upload):

```ts
  // Page photos are NOT best-effort (unlike audio): any problem here fails the
  // save loudly so the owner can re-shoot the page now — issue #10 is why.
  const MAX_PHOTO_BYTES = 8 * 1024 * 1024;
  const photoFiles = form
    .getAll("photo")
    .filter((p): p is File => p instanceof File && p.size > 0);
  const photoProblems: string[] = [];
  for (const f of photoFiles) {
    if (!f.type.startsWith("image/")) {
      photoProblems.push(`photo ${f.name} is not an image (${f.type || "unknown type"})`);
    }
    if (f.size > MAX_PHOTO_BYTES) {
      photoProblems.push(`photo ${f.name} exceeds ${MAX_PHOTO_BYTES} bytes`);
    }
  }
```

Change the validation return to include photo problems:

```ts
  const errors = [...validateEntryInput(input), ...photoProblems];
  if (errors.length) {
    return Response.json({ error: "Invalid entry", problems: errors }, { status: 400 });
  }
```

After the audio-upload block and BEFORE enrichment, upload photos (verified — a failure returns without saving anything):

```ts
  const photoRecords: PhotoRecord[] = [];
  for (const f of photoFiles) {
    const photoId = ulid();
    try {
      await uploadPhoto(photoId, f, f.type, f.size);
    } catch (err) {
      // NOT best-effort: the entry is not saved, the client must retry.
      return Response.json(
        { error: "Photo upload failed — entry NOT saved. Keep the page handy and retry.", detail: String(err) },
        { status: 502 },
      );
    }
    photoRecords.push({
      id: photoId,
      entryId: id,
      mime: f.type,
      bytes: f.size,
      createdAt: new Date().toISOString(),
    });
  }
```

After the successful `insertEntry(record)`, insert the photo rows (entry row must exist first — FK) and include them in the response:

```ts
  try {
    for (const p of photoRecords) await insertPhoto(p);
  } catch (err) {
    // The entry row saved but a photo record didn't — surface it loudly rather
    // than pretend the save was clean; the blob exists, the row can be re-added.
    return Response.json(
      { error: "Entry saved but recording a photo failed", detail: String(err), entry: record },
      { status: 500 },
    );
  }

  return Response.json(
    {
      entry: record,
      photos: photoRecords.map((p) => ({ id: p.id, url: photoProxyPath(p.id) })),
    },
    { status: 201 },
  );
```

(The final `return Response.json({ entry: record }, { status: 201 })` is replaced by the block above.)

- [ ] **Step 5: Run the full suite + build**

Run: `pnpm test && pnpm lint && pnpm build`
Expected: tests PASS, lint clean, build succeeds.

- [ ] **Step 6: Commit**

```bash
git add src/lib/entry-form.ts src/lib/entry-form.test.ts src/app/api/entries/route.ts
git commit -m "feat(entries): save path carries journalId/writtenAt + verified page photos (#16)"
```

---

## Out of scope for this plan

- All UI (journal picker, active-journal lock control, photo attach, photo display, SearchBar journal dropdown) — issue #17 and the UI half of #18, planned separately after this backend lands.
- Client-side image downscaling before upload (needed on phones: Vercel's request-body limit is ~4.5 MB and phone photos can exceed it raw) — UI plan.
- DELETE for photos/journals (rides with issue #9's CRUD work).
