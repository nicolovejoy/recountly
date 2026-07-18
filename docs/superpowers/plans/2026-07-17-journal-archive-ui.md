# Physical Journal Archive — UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The frontend for the physical-journal archive (GitHub issue #17 + the UI half of #18): client-side photo downscaling, a journal picker with the active-journal lock, photo attach in the capture flow, journal/written-date/photo display in the entry list, and a journal filter in search. The backend (PR #20, merged) already exposes everything needed.

**Architecture:** Follows the established split exactly: pure tested logic in `src/lib/` (downscale planning, written-date conversion), imperative session state in hooks (`useJournals` alongside the existing `useRecorder`), thin presentational components (`JournalBar`, `PhotoTray` alongside `RecordButton`/`SearchBar`), with `RecorderClient` as the composition root. Components carry no unit tests (house convention — only `src/lib/` is unit-tested); component tasks verify via `pnpm test && pnpm lint && pnpm build`.

**Tech Stack:** Next.js 16 App Router client components, React 19, Tailwind CSS 4, Vitest (node env) for lib tests.

## Global Constraints

- **Client-side downscaling is load-bearing, not polish.** Vercel rejects request bodies over ~4.5 MB before the route runs, and raw phone photos exceed that. Every attached photo MUST pass through `downscalePhoto` before entering the save payload. Downscaled output is JPEG (`image/jpeg`), max dimension 2048px, quality 0.85.
- **Photos are NOT best-effort.** A photo that fails to decode/downscale at attach time must show a visible error and NOT silently join or silently drop from the pending set. The save error path (already loud in `RecorderClient`) must keep pending photos on failure so the user can retry — never clear photos on a failed save.
- **The active-journal lock lives in the DB** (`PUT /api/journals/active`), not localStorage — it must survive reloads and device switches. Exactly one journal active at most; the backend's single-statement toggle guarantees it.
- Backend contracts (already merged, do not change them): `GET/POST /api/journals` → `{ journals }` / 201 `{ journal }`; `PUT /api/journals/active` body `{ id: string | null }`; `GET /api/entries/[id]/photos` → `{ photos: PhotoRecord[] }`; photo images served from `/api/photo/<id>`; `buildEntryFormData` payload fields `journalId?`, `writtenAt?` (ISO), `photos?: { blob, mime }[]`; `EntryRecord.journalId/writtenAt: string | null`; search query param `journal` via `SearchFilters.journalId`.
- New pure logic in `src/lib/` is test-first (TDD). Components/hooks are NOT unit-tested (house convention) — do not add a DOM test environment or component tests.
- Suite is currently 199 tests and must stay fully green; lint clean; build passing after every task.
- Still single-user; no `user_id`.
- pnpm 9 on Node 20 — never upgrade pnpm. Next.js 16 — consult `node_modules/next/dist/docs/` rather than memory for anything non-trivial.
- Match the existing visual idiom: Tailwind utility classes in the same tonal palette used by the components being modified (`border-foreground/10`, `text-foreground/50`, `rounded-xl`, etc.). No new UI libraries.

---

### Task 1: Pure image lib — downscale planning + browser glue

**Files:**
- Create: `src/lib/image.ts`
- Test: `src/lib/image.test.ts` (create)

**Interfaces:**
- Consumes: nothing.
- Produces: `PHOTO_MAX_DIM = 2048`, `PHOTO_JPEG_QUALITY = 0.85`, `planDownscale(srcWidth: number, srcHeight: number, maxDim?: number): { width: number; height: number }` (pure, tested), `downscalePhoto(source: Blob): Promise<{ blob: Blob; mime: "image/jpeg" }>` (browser glue — Task 3 calls it per attached file; throws on undecodable input).

- [ ] **Step 1: Write the failing tests**

Create `src/lib/image.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { planDownscale, PHOTO_MAX_DIM, PHOTO_JPEG_QUALITY } from "./image";

describe("planDownscale", () => {
  it("scales the long edge down to maxDim, preserving aspect ratio", () => {
    expect(planDownscale(4032, 3024, 2048)).toEqual({ width: 2048, height: 1536 });
    expect(planDownscale(3024, 4032, 2048)).toEqual({ width: 1536, height: 2048 });
  });

  it("never upscales — small images keep their dimensions", () => {
    expect(planDownscale(1200, 900, 2048)).toEqual({ width: 1200, height: 900 });
    expect(planDownscale(2048, 2048, 2048)).toEqual({ width: 2048, height: 2048 });
  });

  it("rounds to whole pixels", () => {
    const { width, height } = planDownscale(4000, 3001, 2048);
    expect(Number.isInteger(width)).toBe(true);
    expect(Number.isInteger(height)).toBe(true);
    expect(width).toBe(2048);
    expect(height).toBe(1536); // 3001 * (2048/4000) = 1536.5 → round
  });

  it("defaults maxDim to PHOTO_MAX_DIM", () => {
    expect(planDownscale(5000, 5000)).toEqual({
      width: PHOTO_MAX_DIM,
      height: PHOTO_MAX_DIM,
    });
  });

  it("exports the agreed JPEG quality", () => {
    expect(PHOTO_JPEG_QUALITY).toBe(0.85);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm test image`
Expected: FAIL — `./image` module not found.

- [ ] **Step 3: Implement `src/lib/image.ts`**

```ts
// Client-side photo downscaling (physical-journal archive, issue #17). This is
// load-bearing, not polish: Vercel rejects request bodies over ~4.5 MB before
// the save route ever runs, and raw phone photos exceed that. Every attached
// photo goes through downscalePhoto before entering the save payload.
//
// planDownscale is the pure, tested core; downscalePhoto is thin browser glue
// (createImageBitmap + canvas) kept separate the same way useRecorder wraps
// the tested connection logic. Output is always JPEG — predictable size, and
// it transcodes HEIC (which Chrome can't display) into something every
// browser renders. A source the browser can't decode (e.g. HEIC on Chrome)
// makes downscalePhoto throw — the caller must surface that, not swallow it.

export const PHOTO_MAX_DIM = 2048;
export const PHOTO_JPEG_QUALITY = 0.85;

// Target dimensions: scale the long edge down to maxDim (never up), keep
// aspect ratio, whole pixels.
export function planDownscale(
  srcWidth: number,
  srcHeight: number,
  maxDim: number = PHOTO_MAX_DIM,
): { width: number; height: number } {
  const longEdge = Math.max(srcWidth, srcHeight);
  if (longEdge <= maxDim) return { width: srcWidth, height: srcHeight };
  const scale = maxDim / longEdge;
  return {
    width: Math.round(srcWidth * scale),
    height: Math.round(srcHeight * scale),
  };
}

// Decode → scale → re-encode as JPEG. Throws if the browser can't decode the
// source or produce a JPEG; callers surface that as an attach error.
export async function downscalePhoto(
  source: Blob,
): Promise<{ blob: Blob; mime: "image/jpeg" }> {
  const bitmap = await createImageBitmap(source);
  try {
    const { width, height } = planDownscale(bitmap.width, bitmap.height);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("canvas 2d context unavailable");
    ctx.drawImage(bitmap, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", PHOTO_JPEG_QUALITY),
    );
    if (!blob) throw new Error("could not encode JPEG");
    return { blob, mime: "image/jpeg" };
  } finally {
    bitmap.close();
  }
}
```

- [ ] **Step 4: Run the full suite**

Run: `pnpm test`
Expected: PASS (199 + new).

- [ ] **Step 5: Commit**

```bash
git add src/lib/image.ts src/lib/image.test.ts
git commit -m "feat(photos): client-side downscale lib — tested planning + canvas JPEG glue (#17)"
```

---

### Task 2: Written-date helper + useJournals hook + JournalBar

**Files:**
- Create: `src/lib/written-at.ts`
- Test: `src/lib/written-at.test.ts` (create)
- Create: `src/app/useJournals.ts`
- Create: `src/app/JournalBar.tsx`

**Interfaces:**
- Consumes: `JournalRecord` from `@/lib/journal`; API routes `GET/POST /api/journals`, `PUT /api/journals/active`.
- Produces: `writtenAtIso(dateStr: string): string | undefined` (pure, tested); `useJournals(): { journals: JournalRecord[] | null; active: JournalRecord | null; error: string | null; create(label: string): Promise<JournalRecord | null>; setActive(id: string | null): Promise<void> }`; `<JournalBar journals active writtenDate onSelect onCreate onWrittenDateChange />` (presentational). Task 3 wires these into `RecorderClient`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/written-at.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { writtenAtIso } from "./written-at";

describe("writtenAtIso", () => {
  it("converts a YYYY-MM-DD date to an ISO timestamp on that local date", () => {
    const iso = writtenAtIso("1994-03-02");
    expect(iso).toBeDefined();
    // Local-noon anchoring: the round-trip must land on the same calendar day
    // in the local timezone, whatever that timezone is.
    const d = new Date(iso!);
    expect(d.getFullYear()).toBe(1994);
    expect(d.getMonth()).toBe(2); // March
    expect(d.getDate()).toBe(2);
  });

  it("returns undefined for blank or malformed input", () => {
    expect(writtenAtIso("")).toBeUndefined();
    expect(writtenAtIso("   ")).toBeUndefined();
    expect(writtenAtIso("not-a-date")).toBeUndefined();
    expect(writtenAtIso("1994-13-40")).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm test written-at`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/lib/written-at.ts`**

```ts
// The written-date input (physical-journal archive) is a plain <input
// type="date"> yielding "YYYY-MM-DD". Anchor it at LOCAL NOON before
// converting to ISO: parsing a bare date string as UTC midnight would shift
// the calendar day for any timezone west of UTC (a 1994-03-02 page saved from
// California would store 1994-03-01T…). Noon keeps the day stable in every
// real timezone. Blank/malformed input → undefined (field omitted from save).

export function writtenAtIso(dateStr: string): string | undefined {
  const trimmed = dateStr.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return undefined;
  const d = new Date(`${trimmed}T12:00:00`);
  if (Number.isNaN(d.getTime())) return undefined;
  // Reject rollovers like 1994-13-40 that Date "helpfully" normalizes.
  const [y, m, day] = trimmed.split("-").map(Number);
  if (d.getFullYear() !== y || d.getMonth() !== m - 1 || d.getDate() !== day) {
    return undefined;
  }
  return d.toISOString();
}
```

- [ ] **Step 4: Run the lib tests**

Run: `pnpm test`
Expected: PASS.

- [ ] **Step 5: Create `src/app/useJournals.ts`**

```ts
"use client";

// Imperative journal state (physical-journal archive): fetches the journal
// list, exposes the active journal (the capture lock), and wraps create +
// activate. The lock lives in the DB — PUT /api/journals/active — so it
// survives reloads and device switches. Same layering as useRecorder: this
// hook owns the fetches; components stay presentational.

import { useCallback, useEffect, useState } from "react";
import type { JournalRecord } from "@/lib/journal";

export function useJournals() {
  const [journals, setJournals] = useState<JournalRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => {
    fetch("/api/journals")
      .then(async (res) => {
        if (!res.ok) throw new Error(`journals route ${res.status}`);
        return (await res.json()) as { journals: JournalRecord[] };
      })
      .then((data) => {
        setJournals(data.journals);
        setError(null);
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const create = useCallback(
    async (label: string): Promise<JournalRecord | null> => {
      try {
        const res = await fetch("/api/journals", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ label }),
        });
        if (!res.ok) throw new Error(`create failed (${res.status})`);
        const { journal } = (await res.json()) as { journal: JournalRecord };
        reload();
        return journal;
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        return null;
      }
    },
    [reload],
  );

  const setActive = useCallback(
    async (id: string | null): Promise<void> => {
      try {
        const res = await fetch("/api/journals/active", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id }),
        });
        if (!res.ok) throw new Error(`activate failed (${res.status})`);
        reload();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [reload],
  );

  const active = journals?.find((j) => j.active) ?? null;
  return { journals, active, error, create, setActive };
}
```

- [ ] **Step 6: Create `src/app/JournalBar.tsx`**

```tsx
"use client";

// Journal capture context (physical-journal archive): shows which notebook is
// active (the lock — every save defaults to it), lets the owner switch/clear
// it, create a new journal inline, and set the optional written date for the
// page being read. Presentational: all state lives in RecorderClient (written
// date) and the DB via useJournals (list + active lock).

import { useState } from "react";
import type { JournalRecord } from "@/lib/journal";

const NEW_SENTINEL = "__new__";
const NONE_SENTINEL = "__none__";

export default function JournalBar({
  journals,
  active,
  writtenDate,
  onSelect,
  onCreate,
  onWrittenDateChange,
}: {
  journals: JournalRecord[] | null;
  active: JournalRecord | null;
  writtenDate: string;
  onSelect: (id: string | null) => void;
  onCreate: (label: string) => Promise<void>;
  onWrittenDateChange: (date: string) => void;
}) {
  const [creating, setCreating] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  const field =
    "rounded-lg border border-foreground/15 bg-transparent px-3 py-2 text-sm outline-none focus:border-foreground/40";

  if (journals === null) return null; // still loading — the bar appears when ready

  async function submitNew() {
    const label = newLabel.trim();
    if (!label) return;
    await onCreate(label);
    setNewLabel("");
    setCreating(false);
  }

  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-foreground/50">
      <label className="flex items-center gap-1">
        <span>Journal</span>
        <select
          value={active?.id ?? NONE_SENTINEL}
          onChange={(e) => {
            const v = e.target.value;
            if (v === NEW_SENTINEL) setCreating(true);
            else onSelect(v === NONE_SENTINEL ? null : v);
          }}
          aria-label="Active journal"
          className={field}
        >
          <option value={NONE_SENTINEL}>none</option>
          {journals.map((j) => (
            <option key={j.id} value={j.id}>
              {j.label}
            </option>
          ))}
          <option value={NEW_SENTINEL}>+ new journal…</option>
        </select>
      </label>

      {creating && (
        <span className="flex items-center gap-1">
          <input
            type="text"
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void submitNew();
            }}
            placeholder="Journal label"
            aria-label="New journal label"
            className={field}
          />
          <button
            type="button"
            onClick={() => void submitNew()}
            className="rounded-lg border border-foreground/20 px-2 py-1 hover:bg-foreground/[0.06]"
          >
            Add
          </button>
          <button
            type="button"
            onClick={() => {
              setCreating(false);
              setNewLabel("");
            }}
            className="px-1 py-1 hover:text-foreground/80"
          >
            Cancel
          </button>
        </span>
      )}

      {active && (
        <label className="flex items-center gap-1">
          <span>Written</span>
          <input
            type="date"
            value={writtenDate}
            onChange={(e) => onWrittenDateChange(e.target.value)}
            aria-label="Date the page was written"
            className={field}
          />
        </label>
      )}
    </div>
  );
}
```

- [ ] **Step 7: Verify**

Run: `pnpm test && pnpm lint && pnpm build`
Expected: tests PASS, lint clean, build succeeds. (The components aren't rendered anywhere yet — Task 3 wires them in — but they must compile.)

- [ ] **Step 8: Commit**

```bash
git add src/lib/written-at.ts src/lib/written-at.test.ts src/app/useJournals.ts src/app/JournalBar.tsx
git commit -m "feat(journals): writtenAtIso helper, useJournals hook, JournalBar picker + lock (#17)"
```

---

### Task 3: Photo attach — PhotoTray + RecorderClient wiring (journal, written date, photos, save)

**Files:**
- Create: `src/app/PhotoTray.tsx`
- Modify: `src/app/RecorderClient.tsx`

**Interfaces:**
- Consumes: `downscalePhoto` from `@/lib/image`; `writtenAtIso` from `@/lib/written-at`; `useJournals` + `JournalBar` (Task 2); the extended `buildEntryFormData` payload (`journalId?`, `writtenAt?`, `photos?`) already on `@/lib/entry-form`.
- Produces: `PendingPhoto { key: number; blob: Blob; mime: string; previewUrl: string }` (local to RecorderClient); `<PhotoTray photos onAdd onRemove busy />`. Task 4/5 depend on nothing from this task.

- [ ] **Step 1: Create `src/app/PhotoTray.tsx`**

```tsx
"use client";

// Page-photo attach (physical-journal archive): a camera/library input plus
// removable thumbnails for the photos that will save with the current entry.
// Presentational — RecorderClient owns the pending list, runs the (load-
// bearing) downscale on add, and clears the tray only after a SUCCESSFUL
// save: photos are not best-effort, so a failed save keeps them for retry.

import { useRef } from "react";

export interface TrayPhoto {
  key: number;
  previewUrl: string;
}

export default function PhotoTray({
  photos,
  busy,
  onAdd,
  onRemove,
}: {
  photos: TrayPhoto[];
  /** True while an added file is still downscaling. */
  busy: boolean;
  onAdd: (files: File[]) => void;
  onRemove: (key: number) => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          if (files.length) onAdd(files);
          e.target.value = ""; // allow re-picking the same file
        }}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={busy}
        className="rounded-lg border border-foreground/20 px-3 py-1.5 text-xs text-foreground/70 transition-colors hover:bg-foreground/[0.06] disabled:opacity-50"
      >
        {busy ? "Processing…" : "📷 Add page photo"}
      </button>
      <ul className="flex flex-wrap gap-2">
        {photos.map((p) => (
          <li key={p.key} className="relative">
            {/* eslint-disable-next-line @next/next/no-img-element -- local object URL preview; next/image can't optimize blob: URLs */}
            <img
              src={p.previewUrl}
              alt="Attached page"
              className="h-16 w-16 rounded-lg border border-foreground/10 object-cover"
            />
            <button
              type="button"
              onClick={() => onRemove(p.key)}
              aria-label="Remove photo"
              className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full border border-foreground/20 bg-background text-[10px] leading-none text-foreground/70 hover:bg-foreground/[0.08]"
            >
              ✕
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 2: Wire everything into `src/app/RecorderClient.tsx`**

Add imports:

```tsx
import { downscalePhoto } from "@/lib/image";
import { writtenAtIso } from "@/lib/written-at";
import { useJournals } from "./useJournals";
import JournalBar from "./JournalBar";
import PhotoTray from "./PhotoTray";
```

Add state + handlers inside the component (after the existing `saveError` state):

```tsx
  const { journals, active, error: journalsError, create, setActive } = useJournals();
  const [writtenDate, setWrittenDate] = useState("");
  // Photos pending for the entry being captured. Downscaled at attach time
  // (load-bearing: raw phone photos exceed Vercel's ~4.5MB body limit).
  // Cleared ONLY on successful save — photos are not best-effort.
  const [pendingPhotos, setPendingPhotos] = useState<
    { key: number; blob: Blob; mime: string; previewUrl: string }[]
  >([]);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const photoKeyRef = useRef(0);

  const addPhotos = useCallback(async (files: File[]) => {
    setPhotoBusy(true);
    setPhotoError(null);
    for (const file of files) {
      try {
        const { blob, mime } = await downscalePhoto(file);
        photoKeyRef.current += 1;
        setPendingPhotos((prev) => [
          ...prev,
          { key: photoKeyRef.current, blob, mime, previewUrl: URL.createObjectURL(blob) },
        ]);
      } catch {
        // NOT silent: a page photo that can't be read must be re-shot or
        // re-picked (e.g. HEIC on a browser that can't decode it).
        setPhotoError(`Couldn't read ${file.name || "a photo"} — try re-taking it as JPEG.`);
      }
    }
    setPhotoBusy(false);
  }, []);

  const removePhoto = useCallback((key: number) => {
    setPendingPhotos((prev) => {
      const gone = prev.find((p) => p.key === key);
      if (gone) URL.revokeObjectURL(gone.previewUrl);
      return prev.filter((p) => p.key !== key);
    });
  }, []);
```

Replace the existing `onStop` callback with (changes: journal/written/photo fields in the payload; success path clears photos + written date; deps updated):

```tsx
  // Done's save trigger: read the transcript the editor holds, attach the
  // best-effort audio plus the journal context and verified page photos, POST
  // it, then refresh the list. An empty transcript is a no-op. Audio failing
  // is fine; photos are NOT best-effort — the route fails the save if one
  // can't be stored, and we keep the tray so the user retries.
  const onStop = useCallback(
    (result: RecordingResult) => {
      const transcript = editorRef.current?.getValue().trim() ?? "";
      if (!transcript) {
        setSaveState("idle");
        return;
      }
      setSaveState("saving");
      setSaveError(null);
      const body = buildEntryFormData({
        transcript,
        durationSeconds: result.durationSeconds,
        audio: result.audioBlob
          ? {
              blob: result.audioBlob,
              mime: result.audioMime ?? "audio/webm",
              complete: result.audioComplete ?? true,
            }
          : null,
        journalId: active?.id,
        writtenAt: writtenAtIso(writtenDate),
        photos: pendingPhotos.map((p) => ({ blob: p.blob, mime: p.mime })),
      });
      fetch("/api/entries", { method: "POST", body })
        .then(async (res) => {
          if (!res.ok) throw new Error(`save failed (${res.status}): ${await res.text()}`);
        })
        .then(() => {
          editorRef.current?.clear();
          pendingPhotos.forEach((p) => URL.revokeObjectURL(p.previewUrl));
          setPendingPhotos([]);
          setWrittenDate("");
          setSaveState("saved");
          setReloadKey((k) => k + 1);
        })
        .catch((err) => {
          setSaveError(err instanceof Error ? err.message : String(err));
          setSaveState("error");
        });
    },
    [active?.id, writtenDate, pendingPhotos],
  );
```

(`useRecorder` reads `onStop` through a latest-ref, so the widened dependency list is safe — no reconnection churn.)

In the JSX, insert the journal bar + photo tray between the record-button block and the error banner (i.e. right after the `</div>` closing `flex flex-col items-center gap-3`):

```tsx
      <div className="flex flex-col gap-2">
        <JournalBar
          journals={journals}
          active={active}
          writtenDate={writtenDate}
          onSelect={(id) => void setActive(id)}
          onCreate={async (label) => {
            const j = await create(label);
            if (j) await setActive(j.id);
          }}
          onWrittenDateChange={setWrittenDate}
        />
        <PhotoTray
          photos={pendingPhotos.map(({ key, previewUrl }) => ({ key, previewUrl }))}
          busy={photoBusy}
          onAdd={(files) => void addPhotos(files)}
          onRemove={removePhoto}
        />
        {photoError && <p className="text-xs text-red-500">{photoError}</p>}
        {journalsError && (
          <p className="text-xs text-red-500">Journals unavailable: {journalsError}</p>
        )}
      </div>
```

Also add `useRef` usage note: `useRef` is already imported in RecorderClient — reuse the existing import line (add nothing if already there).

- [ ] **Step 3: Verify**

Run: `pnpm test && pnpm lint && pnpm build`
Expected: all clean.

- [ ] **Step 4: Commit**

```bash
git add src/app/PhotoTray.tsx src/app/RecorderClient.tsx
git commit -m "feat(capture): journal bar + written date + downscaled photo attach in the save flow (#17)"
```

---

### Task 4: EntryList — journal chip, written date, photos on expand

**Files:**
- Modify: `src/app/EntryList.tsx`

**Interfaces:**
- Consumes: `EntryRecord.journalId/writtenAt` (already on the type); `GET /api/entries/[id]/photos` → `{ photos: { id: string }[] }`; images at `/api/photo/<id>`; `JournalRecord` from `@/lib/journal`.
- Produces: `EntryList` gains a `journals: JournalRecord[] | null` prop (RecorderClient already holds the list via `useJournals` — pass it through: `<EntryList reloadKey={reloadKey} journals={journals} />`). Task 5 builds on this same prop for the search dropdown.

- [ ] **Step 1: Implement**

In `src/app/EntryList.tsx`:

1. Add imports:

```tsx
import type { JournalRecord } from "@/lib/journal";
import type { PhotoRecord } from "@/lib/photo";
```

2. Change the signature and add a label lookup + photo cache:

```tsx
export default function EntryList({
  reloadKey,
  journals,
}: {
  reloadKey: number;
  journals: JournalRecord[] | null;
}) {
```

```tsx
  const journalLabel = useMemo(() => {
    const m = new Map<string, string>();
    journals?.forEach((j) => m.set(j.id, j.label));
    return m;
  }, [journals]);

  // Photos are fetched lazily on first expand and cached per entry id.
  const [photosByEntry, setPhotosByEntry] = useState<Record<string, PhotoRecord[]>>({});
```

3. Extend `toggle` to fetch photos on first expand:

```tsx
  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    if (!(id in photosByEntry)) {
      // Mark as requested immediately so a double-tap doesn't double-fetch.
      setPhotosByEntry((prev) => ({ ...prev, [id]: [] }));
      fetch(`/api/entries/${id}/photos`)
        .then(async (res) => {
          if (!res.ok) throw new Error(`photos route ${res.status}`);
          return (await res.json()) as { photos: PhotoRecord[] };
        })
        .then((data) => setPhotosByEntry((prev) => ({ ...prev, [id]: data.photos })))
        .catch(() => {
          // Leave the cached empty list; the transcript is still readable.
        });
    }
  }
```

4. In the card JSX, under the existing `{e.title && (...)}` date line, add the journal chip + written-date line:

```tsx
              {(e.journalId || e.writtenAt) && (
                <div className="flex flex-wrap items-center gap-2 text-xs text-foreground/40">
                  {e.journalId && (
                    <span className="rounded-full border border-foreground/10 px-2 py-0.5">
                      📓 {journalLabel.get(e.journalId) ?? "journal"}
                    </span>
                  )}
                  {e.writtenAt && (
                    <span>written {new Date(e.writtenAt).toLocaleDateString()}</span>
                  )}
                </div>
              )}
```

5. Inside the expanded card, after the transcript button block (before the `{e.audioUrl && (...)}` audio player), render the photos when the card is open:

```tsx
              {isOpen && (photosByEntry[e.id]?.length ?? 0) > 0 && (
                <ul className="flex flex-wrap gap-2">
                  {photosByEntry[e.id].map((p) => (
                    <li key={p.id}>
                      {/* eslint-disable-next-line @next/next/no-img-element -- auth-gated same-origin proxy; next/image's optimizer can't fetch it */}
                      <img
                        src={`/api/photo/${p.id}`}
                        alt="Journal page"
                        loading="lazy"
                        className="max-h-96 rounded-lg border border-foreground/10"
                      />
                    </li>
                  ))}
                </ul>
              )}
```

6. In `src/app/RecorderClient.tsx`, update the render to pass the prop:

```tsx
      <EntryList reloadKey={reloadKey} journals={journals} />
```

- [ ] **Step 2: Verify**

Run: `pnpm test && pnpm lint && pnpm build`
Expected: all clean.

- [ ] **Step 3: Commit**

```bash
git add src/app/EntryList.tsx src/app/RecorderClient.tsx
git commit -m "feat(entries): journal chip, written date, page photos on expand (#17)"
```

---

### Task 5: Search — journal filter dropdown

**Files:**
- Modify: `src/app/SearchBar.tsx`
- Modify: `src/app/EntryList.tsx`

**Interfaces:**
- Consumes: `buildSearchQueryString`'s `journalId` filter (already merged); the `journals` prop from Task 4.
- Produces: `SearchBar` gains `journal: string` + `journals: JournalRecord[] | null` props; `Filters` type gains `journal`. Completes the UI half of #18.

- [ ] **Step 1: Implement `src/app/SearchBar.tsx`**

Extend the `Filters` type and props (journal is the selected journal id, `""` = all):

```tsx
import type { JournalRecord } from "@/lib/journal";

type Filters = { query: string; from: string; to: string; journal: string };

export default function SearchBar({
  query,
  from,
  to,
  journal,
  journals,
  onChange,
  onClear,
}: Filters & {
  journals: JournalRecord[] | null;
  onChange: (patch: Partial<Filters>) => void;
  onClear: () => void;
}) {
  const hasFilters = Boolean(query || from || to || journal);
```

Inside the date-row `<div>`, after the To label, add (only when journals exist to filter by):

```tsx
        {journals !== null && journals.length > 0 && (
          <label className="flex items-center gap-1">
            <span>Journal</span>
            <select
              value={journal}
              onChange={(e) => onChange({ journal: e.target.value })}
              aria-label="Filter by journal"
              className={field}
            >
              <option value="">all</option>
              {journals.map((j) => (
                <option key={j.id} value={j.id}>
                  {j.label}
                </option>
              ))}
            </select>
          </label>
        )}
```

- [ ] **Step 2: Wire the filter state in `src/app/EntryList.tsx`**

```tsx
  const [journalFilter, setJournalFilter] = useState("");
```

Update the query string memo:

```tsx
  const queryString = useMemo(
    () =>
      buildSearchQueryString({
        query: debouncedQuery,
        from,
        to,
        journalId: journalFilter || undefined,
      }),
    [debouncedQuery, from, to, journalFilter],
  );
  const isSearching = Boolean(debouncedQuery || from || to || journalFilter);
```

Update the SearchBar usage:

```tsx
      <SearchBar
        query={query}
        from={from}
        to={to}
        journal={journalFilter}
        journals={journals}
        onChange={(p) => {
          if (p.query !== undefined) setQuery(p.query);
          if (p.from !== undefined) setFrom(p.from);
          if (p.to !== undefined) setTo(p.to);
          if (p.journal !== undefined) setJournalFilter(p.journal);
        }}
        onClear={() => {
          setQuery("");
          setFrom("");
          setTo("");
          setJournalFilter("");
        }}
      />
```

- [ ] **Step 3: Verify**

Run: `pnpm test && pnpm lint && pnpm build`
Expected: all clean.

- [ ] **Step 4: Commit**

```bash
git add src/app/SearchBar.tsx src/app/EntryList.tsx
git commit -m "feat(search): journal filter dropdown (#18)"
```

---

## Out of scope for this plan

- PWA / passkeys (separate Next Steps thread in CLAUDE.md).
- DELETE for entries/photos/journals (issue #9).
- Journal rename/notes editing UI — create + activate is enough to start ingesting; add editing when a label actually needs fixing.
- Any offline queueing of photos or entries.
