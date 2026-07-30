// Open-format export of the whole recountly Neon DB + private Vercel blobs into
// the self-describing, checksummed package the native app (Raconte) imports.
// Spec of record: ~/src/raconte/docs/plans/2026-07-29-data-model-and-migration.md
// §3 (package layout) + §4 (column mapping / migration). This is the ONE
// explicitly-planned exception to the web-repo feature freeze.
//
// READ-ONLY against the database and blob store — it only SELECTs and get()s.
// Never mutates either (load-bearing: the web app stays live).
//
// DRY RUN BY DEFAULT — enumerates entries (incl. trashed), journals, photos and
// prints the planned package tree + counts + total bytes, writing NOTHING.
//
//   node --env-file=.env.local scripts/export-open-package.mjs                     # dry run
//   node --env-file=.env.local scripts/export-open-package.mjs --commit            # write package
//   node --env-file=.env.local scripts/export-open-package.mjs --commit --out DIR  # custom dir
//   node --env-file=.env.local scripts/export-open-package.mjs --verify DIR        # re-verify a package
//
// Default output dir: ~/Documents/recountly-export/<YYYY-MM-DD>/ (overridable via --out).
// --commit runs an inline verification pass after writing; --verify re-checks an
// existing package on disk against its manifest AND a fresh DB row count, exiting
// non-zero on any mismatch. Idempotent: re-running overwrites files in place.

import { neon } from "@neondatabase/serverless";
import { get } from "@vercel/blob";
import {
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  rmSync,
} from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import {
  sha256Prefixed,
  audioStoragePath,
  audioExportExt,
  photoStoragePath,
  imageExt,
  mapEntry,
  mapJournal,
  mapEntryMove,
  buildManifest,
  TRANSCRIPT_FILE,
} from "./export-package-lib.mjs";

const argv = process.argv.slice(2);
const COMMIT = argv.includes("--commit");
function flagValue(name) {
  const i = argv.indexOf(name);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : null;
}
const OUT_FLAG = flagValue("--out");
const VERIFY_DIR = flagValue("--verify");

const APP_VERSION = readAppVersion();
const EXPORT_DATE = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
const EXPORT_SOURCE = `neon-export-${EXPORT_DATE}`;
const DEFAULT_OUT = join(homedir(), "Documents", "recountly-export", EXPORT_DATE);

function readAppVersion() {
  try {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    return `${pkg.name}@${pkg.version}`;
  } catch {
    return "recountly";
  }
}

function requireDbUrl() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not set (run with `node --env-file=.env.local`)");
    process.exit(1);
  }
  return url;
}

const ENTRY_COLUMNS =
  "id, recorded_at, created_at, updated_at, duration_seconds, transcript, title, tags, " +
  "summary, enriched_at, enrichment_model, audio_url, audio_mime, audio_bytes, audio_complete, " +
  "journal_id, written_at, page_label, deleted_at, notes, location";

async function loadAll(sql) {
  const entries = await sql.query(`SELECT ${ENTRY_COLUMNS} FROM entries ORDER BY id`, []);
  const journals = await sql.query(
    "SELECT id, label, notes, active, created_at, started_on, ended_on, kind FROM journals ORDER BY created_at",
    [],
  );
  const photos = await sql.query(
    "SELECT id, entry_id, mime, bytes, created_at FROM photos ORDER BY id",
    [],
  );
  const moves = await sql.query(
    "SELECT id, entry_id, from_journal_id, to_journal_id, moved_at FROM entry_moves ORDER BY id",
    [],
  );
  const photosByEntry = new Map();
  for (const p of photos) {
    const list = photosByEntry.get(p.entry_id) ?? [];
    list.push(p);
    photosByEntry.set(p.entry_id, list);
  }
  return { entries, journals, photos, moves, photosByEntry };
}

// Fetch one private blob's full bytes (mirrors src/app/api/audio/[id]'s get()+
// stream approach). Returns a Buffer, or throws with a clear message.
async function fetchBlob(path) {
  const result = await get(path, { access: "private" });
  if (!result || result.statusCode !== 200) {
    throw new Error(`blob not found or non-200 at ${path}`);
  }
  return Buffer.from(await new Response(result.stream).arrayBuffer());
}

function hasAudio(row) {
  return row.audio_url != null && row.audio_mime != null;
}

// ---- dry run ---------------------------------------------------------------

function dryRun(data) {
  const { entries, journals, moves, photosByEntry } = data;
  let impCount = 0;
  let withAudio = 0;
  let totalPhotos = 0;
  let totalBytes = 0;

  console.log(`Planned package: recountly-export / ${EXPORT_DATE} (source: ${EXPORT_SOURCE})`);
  console.log(`Output dir (on --commit): ${OUT_FLAG ?? DEFAULT_OUT}\n`);
  console.log("entries/");
  for (const row of entries) {
    const id = String(row.id);
    if (id.startsWith("imp_")) impCount++;
    const photos = photosByEntry.get(id) ?? [];
    totalPhotos += photos.length;
    const transcriptBytes = Buffer.byteLength(String(row.transcript ?? ""), "utf8");
    totalBytes += transcriptBytes;
    let audioNote = "no-audio";
    if (hasAudio(row)) {
      withAudio++;
      const abytes = Number(row.audio_bytes ?? 0);
      totalBytes += abytes;
      audioNote = `audio.${audioExportExt(row.audio_mime)} (${abytes} B)`;
    }
    for (const p of photos) totalBytes += Number(p.bytes ?? 0);
    const status = row.deleted_at != null ? " [TRASHED]" : "";
    console.log(
      `  ${id}/${status}  ${audioNote}  photos:${photos.length}  transcript:${transcriptBytes} B`,
    );
  }

  console.log("\njournals.json —", journals.length, "journal(s)");
  console.log("legacy/entry_moves.json —", moves.length, "move(s)");
  console.log("manifest.json — sha256 of every package file\n");

  console.log("Counts:");
  console.log(`  entries:     ${entries.length} (${impCount} imp_, ${withAudio} with audio)`);
  console.log(`  journals:    ${journals.length}`);
  console.log(`  photos:      ${totalPhotos}`);
  console.log(`  audio files: ${withAudio}`);
  console.log(`  entry_moves: ${moves.length}`);
  console.log(`\nApprox media+transcript bytes to download/write: ${totalBytes} B (${(totalBytes / 1e6).toFixed(2)} MB)`);
  console.log("\nDRY RUN — nothing written. Re-run with --commit to write the package.");
}

// ---- commit ----------------------------------------------------------------

async function commit(data, sql) {
  const outDir = OUT_FLAG ?? DEFAULT_OUT;
  const { entries, journals, moves, photosByEntry } = data;

  // Fresh dir contents for the entries we're exporting (idempotent overwrite);
  // clear a stale entries/ so a since-purged entry doesn't linger.
  mkdirSync(outDir, { recursive: true });
  const entriesRoot = join(outDir, "entries");
  if (existsSync(entriesRoot)) rmSync(entriesRoot, { recursive: true, force: true });
  mkdirSync(entriesRoot, { recursive: true });

  const files = {}; // relpath → "sha256:…"
  const addFile = (relpath, buf) => {
    files[relpath] = sha256Prefixed(buf);
  };

  let impCount = 0;
  let withAudio = 0;
  let totalPhotos = 0;

  console.log(`Writing package to ${outDir}\n`);

  for (const row of entries) {
    const id = String(row.id);
    if (id.startsWith("imp_")) impCount++;
    const entryDir = join(entriesRoot, id);
    mkdirSync(entryDir, { recursive: true });

    // transcript.md — raw canonical transcript, no frontmatter (entry.json
    // already carries title/spokenAt; a plain body is unambiguous for import).
    const transcriptBuf = Buffer.from(String(row.transcript ?? ""), "utf8");
    writeFileSync(join(entryDir, TRANSCRIPT_FILE), transcriptBuf);
    const transcriptRel = `entries/${id}/${TRANSCRIPT_FILE}`;
    addFile(transcriptRel, transcriptBuf);
    const transcript = { sha256: files[transcriptRel] };

    // audio (best-effort in the source data — some old rows have none).
    let audio = null;
    if (hasAudio(row)) {
      const storagePath = audioStoragePath(id, row.audio_mime);
      let buf;
      try {
        buf = await fetchBlob(storagePath);
      } catch (err) {
        console.error(`  AUDIO FETCH FAILED ${id} (${storagePath}): ${String(err).split("\n")[0]}`);
        process.exit(1);
      }
      const fileName = `audio.${audioExportExt(row.audio_mime)}`;
      writeFileSync(join(entryDir, fileName), buf);
      const rel = `entries/${id}/${fileName}`;
      addFile(rel, buf);
      audio = {
        file: fileName,
        mime: String(row.audio_mime),
        bytes: buf.length,
        sha256: files[rel],
        durationSeconds: Number(row.duration_seconds ?? 0),
        complete: row.audio_complete == null ? null : Boolean(row.audio_complete),
      };
      withAudio++;
    }

    // photos (NOT best-effort — a fetch failure aborts the whole export).
    const photoRows = photosByEntry.get(id) ?? [];
    const photoDescriptors = [];
    if (photoRows.length) {
      mkdirSync(join(entryDir, "photos"), { recursive: true });
      for (const p of photoRows) {
        const pid = String(p.id);
        const storagePath = photoStoragePath(pid, p.mime);
        let buf;
        try {
          buf = await fetchBlob(storagePath);
        } catch (err) {
          console.error(`  PHOTO FETCH FAILED ${pid} (${storagePath}): ${String(err).split("\n")[0]}`);
          process.exit(1);
        }
        const fileName = `photos/${pid}.${imageExt(p.mime)}`;
        writeFileSync(join(entryDir, fileName), buf);
        const rel = `entries/${id}/${fileName}`;
        addFile(rel, buf);
        photoDescriptors.push({
          file: fileName,
          id: pid,
          mime: String(p.mime),
          bytes: buf.length,
          sha256: files[rel],
        });
        totalPhotos++;
      }
    }

    const entryJson = mapEntry(row, {
      transcript,
      audio,
      photos: photoDescriptors,
      exportSource: EXPORT_SOURCE,
    });
    const entryJsonBuf = Buffer.from(JSON.stringify(entryJson, null, 2) + "\n", "utf8");
    writeFileSync(join(entryDir, "entry.json"), entryJsonBuf);
    addFile(`entries/${id}/entry.json`, entryJsonBuf);

    console.log(`  ${id}  audio:${audio ? "yes" : "no"}  photos:${photoDescriptors.length}`);
  }

  // journals.json
  const journalsJson = journals.map(mapJournal);
  const journalsBuf = Buffer.from(JSON.stringify(journalsJson, null, 2) + "\n", "utf8");
  writeFileSync(join(outDir, "journals.json"), journalsBuf);
  addFile("journals.json", journalsBuf);

  // legacy/entry_moves.json (archive-only provenance; §4)
  mkdirSync(join(outDir, "legacy"), { recursive: true });
  const movesJson = moves.map(mapEntryMove);
  const movesBuf = Buffer.from(JSON.stringify(movesJson, null, 2) + "\n", "utf8");
  writeFileSync(join(outDir, "legacy", "entry_moves.json"), movesBuf);
  addFile("legacy/entry_moves.json", movesBuf);

  // manifest.json — the verification anchor (hashes every OTHER file; can't hash itself).
  const counts = {
    entries: entries.length,
    journals: journals.length,
    photos: totalPhotos,
    audioFiles: withAudio,
  };
  const manifest = buildManifest({
    exportedAt: new Date().toISOString(),
    appVersion: APP_VERSION,
    counts,
    files,
  });
  writeFileSync(join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");

  console.log(
    `\nWrote ${entries.length} entries (${impCount} imp_, ${withAudio} with audio), ` +
      `${journals.length} journals, ${totalPhotos} photos, ${moves.length} moves.`,
  );

  // Inline export-side verification (§4): re-read + re-hash, cross-check DB.
  console.log("\nVerifying written package…");
  const ok = await verifyPackage(outDir, sql);
  if (!ok) {
    console.error("\nVERIFICATION FAILED — package is inconsistent.");
    process.exit(1);
  }
  console.log("\nVerification PASSED. Package is complete and self-consistent.");
  console.log(`\nPackage: ${outDir}`);
}

// ---- verify ----------------------------------------------------------------

// Re-reads a package, re-hashes every file against manifest.files, and (given a
// DB connection) cross-checks counts against fresh row counts. Returns true iff
// everything matches; logs each mismatch.
async function verifyPackage(dir, sql) {
  const manifestPath = join(dir, "manifest.json");
  if (!existsSync(manifestPath)) {
    console.error(`No manifest.json in ${dir}`);
    return false;
  }
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  let ok = true;

  const fileEntries = Object.entries(manifest.files ?? {});
  for (const [rel, expected] of fileEntries) {
    const p = join(dir, rel);
    if (!existsSync(p)) {
      console.error(`  MISSING FILE  ${rel}`);
      ok = false;
      continue;
    }
    const actual = sha256Prefixed(readFileSync(p));
    if (actual !== expected) {
      console.error(`  HASH MISMATCH ${rel}\n    expected ${expected}\n    actual   ${actual}`);
      ok = false;
    }
  }
  console.log(`  re-hashed ${fileEntries.length} file(s)`);

  if (sql) {
    const dbCounts = await freshCounts(sql);
    for (const key of ["entries", "journals", "photos", "audioFiles"]) {
      const want = manifest.counts?.[key];
      const got = dbCounts[key];
      if (want !== got) {
        console.error(`  COUNT MISMATCH ${key}: manifest ${want} vs DB ${got}`);
        ok = false;
      }
    }
    console.log(
      `  DB counts: entries ${dbCounts.entries}, journals ${dbCounts.journals}, ` +
        `photos ${dbCounts.photos}, audioFiles ${dbCounts.audioFiles}`,
    );
  }

  return ok;
}

async function freshCounts(sql) {
  const one = async (text) => Number((await sql.query(text, []))[0]?.c ?? 0);
  return {
    entries: await one("SELECT count(*)::int AS c FROM entries"),
    journals: await one("SELECT count(*)::int AS c FROM journals"),
    photos: await one("SELECT count(*)::int AS c FROM photos"),
    audioFiles: await one("SELECT count(*)::int AS c FROM entries WHERE audio_url IS NOT NULL"),
  };
}

// ---- main ------------------------------------------------------------------

async function main() {
  if (VERIFY_DIR) {
    const sql = neon(requireDbUrl());
    console.log(`Verifying package at ${VERIFY_DIR}\n`);
    const ok = await verifyPackage(VERIFY_DIR, sql);
    if (!ok) {
      console.error("\nVERIFICATION FAILED.");
      process.exit(1);
    }
    console.log("\nVerification PASSED.");
    return;
  }

  const sql = neon(requireDbUrl());
  const data = await loadAll(sql);

  if (!COMMIT) {
    dryRun(data);
    return;
  }
  await commit(data, sql);
}

await main();
