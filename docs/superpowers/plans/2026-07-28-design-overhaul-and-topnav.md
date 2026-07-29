# Design overhaul (#64) + mother-site alignment & desktop top-nav (#35)

Phase 1 "style session". Everything shipped in #56–#62 passed the 2026-07-28 desktop smoke
functionally; every complaint was readability/differentiation/style. This plan is almost
entirely UI: design tokens, a type/surface sweep, our own `<ConfirmDialog>`, journal-manage
copy fixes, and a desktop top-nav. No API/schema changes — so no route-level integration
tests are required; vitest unit tests only where logic is extractable (date prefill, the
confirm controller, focus-trap wrap). App is **dark-first**; the owner's complaints are all
dark-mode, so tokens lead with dark values.

---

## Owner decisions (answer by number before/at implementation)

1. **Library grouping/badging by journal `kind`** (the deferred question from PR A). Pick one:
   - **1a — badge only (recommended):** keep the single flat Library list; archive-kind
     journal cards get a small muted "paper" chip. Least work, nothing moves, still legible.
   - **1b — two sections:** LibraryView splits into "Journals" (live) + "Paper archive"
     (kind=archive) headed groups. Clearest separation; costs vertical space + empty-section
     handling.
   - **1c — segmented filter:** an All / Live / Paper toggle atop Library filtering the flat
     list. Scales best; most UI for a currently-small journal count.

2. **Top-nav breakpoint.** Roadmap (CLAUDE.md, owner-reviewed 2026-07-28) says **md+**; issue
   #35 text says **sm+**. Recommend **md+** so phones and small tablets keep the bottom tabs.
   Confirm md, or switch to sm.

3. **Accent scope.** Green (REC-lamp) used sparingly at exactly: (a) active-tab indicator +
   label, (b) primary buttons (Save / Create), (c) focus rings. Red stays destructive.
   OK, or trim/extend the list?

4. **Serif transcripts.** Mother-site vocabulary suggests Newsreader serif for long-form prose.
   Adopt it for the entry-detail transcript body only (yes), or keep everything Geist Sans (no)?
   Recommend yes — it's the one place long prose is read.

5. **Build stamp placement.** Mother-site puts the `font-mono` build stamp in a footer; recountly
   currently shows it top-right in the header, and `docs/smoke-checklist.md` step 1 reads it there.
   Keep it in the header (recommended, zero smoke-checklist churn), or move to a footer and update
   the smoke checklist?

Defaults if unanswered: 1a, md+, accent as listed, serif yes, build stamp stays in header.

**Decisions recorded (owner, 2026-07-28):** 1a badge-only ("for now"), md+, accent scope as
listed, serif yes, build stamp stays in the header. Task 6's footer/stamp move is therefore
dropped; Task 6 is serif-only.

---

## Confirmed constraints (from the issues + code survey)

- Keep it simple — personal tool, **no component-library adoption**. Hand-rolled dialog, hand-
  rolled tokens in `globals.css` (Tailwind CSS 4, config-in-CSS via `@theme inline`).
- vitest is **node env, no jsdom/RTL** (`vitest.config.ts`). Component behavior is verified in
  the desktop/phone smoke, not unit tests. Extract pure logic to `src/lib/*.ts` and test that.
- `window.confirm` call sites to replace (7 total, 5 files): `UnfiledView.tsx:83`,
  `TrashView.tsx:69` + `:88`, `JournalView.tsx:158` + `:211`, `EntryDetail.tsx:249`,
  `EntryCard.tsx:162`.
- Dim-text offenders are pervasive: `text-foreground/40` (labels/meta), `text-foreground/50`
  (body), `border-foreground/10–15` (hairlines) across ~12 components (see grep in the sweep
  task). Headings already use `/90` — those stay.
- The green already in the brand is Tailwind green-600/500 (`lamp.ts` idle = `bg-green-600/15`).
- `useEscUp` (`src/app/useEscUp.ts`) is a **window keydown listener** that bails when
  `e.defaultPrevented` OR `isEditableTarget(tag)` (INPUT/TEXTAREA/SELECT/contentEditable,
  `src/lib/keys.ts`). The dialog's Esc handling must interact with this cleanly — see Task 3.

---

## Design tokens (Task 1 defines these; hex + measured contrast)

CSS custom properties in `globals.css`, mapped to Tailwind utilities via `@theme inline`.
`--background`/`--foreground` already exist and keep their meaning (page bg / primary-heading
text). New tokens below. All contrast ratios computed with the WCAG 2.x formula; AA needs
≥4.5:1 for normal text.

### Dark mode (`@media (prefers-color-scheme: dark)`) — the design of record

| token | hex | role | contrast vs its bg |
|---|---|---|---|
| `--background` | `#0a0a0a` | page | — |
| `--surface` | `#161616` | cards, list rows | — (bg) |
| `--surface-raised` | `#1f1f1f` | manage panels, dialogs | — (bg) |
| `--foreground` | `#ededed` | headings, active/primary text | 16.9:1 on page |
| `--body` | `#b8b8b8` | body copy (replaces `/50`, `/70`) | 10.0:1 page · 9.1:1 surface · 8.3:1 raised |
| `--muted` | `#8a8a8a` | labels, meta, timestamps (replaces `/40`, `/60`) | 5.7:1 page · 5.2:1 surface · **4.8:1 raised** |
| `--hairline` | `#2a2a2a` | card borders (replaces `border-foreground/10`) | non-text |
| `--hairline-strong` | `#3a3a3a` | panel/dialog borders (visibly separates raised surfaces) | non-text |
| `--accent` | `#22c55e` (green-500) | active-tab text/indicator, links, focus ring | 8.7:1 on page |
| `--accent-strong` | `#15803d` (green-700) | filled primary-button bg | white text on it = 5.0:1 |
| `--danger` | `#ef4444` (red-500) | destructive text/actions (unchanged) | ~4.9:1 on page |

Tightest ratio in the system is `--muted` on `--surface-raised` at **4.8:1** — still AA. Every
body/label pairing clears AA on all three backgrounds. `--accent` as text is 8.7:1; the filled
primary button uses `--accent-strong` with **white** text (5.0:1) — do **not** put white text on
green-500 (only 3.3:1, fails AA for the 12–14px button labels here).

### Light mode (`:root`) — supported but secondary

| token | hex | note |
|---|---|---|
| `--background` | `#ffffff` | page |
| `--surface` | `#f6f6f6` | cards |
| `--surface-raised` | `#ffffff` | panels/dialogs (separated by `--hairline-strong`) |
| `--foreground` | `#171717` | headings |
| `--body` | `#404040` | body (neutral-700) |
| `--muted` | `#666666` | labels/meta (neutral-600, mother-site body color) — 5.7:1 on white |
| `--hairline` | `#e5e5e5` | neutral-200 (mother-site border) |
| `--hairline-strong` | `#d4d4d4` | neutral-300 |
| `--accent` | `#16a34a` | green-600 (darker for white bg legibility) — 3.7:1 as text, use for indicators/fills not fine text |
| `--accent-strong` | `#15803d` | primary-button bg, white text |
| `--danger` | `#dc2626` | red-600 |

### `@theme inline` mapping (Task 1)

Add alongside the existing `--color-background`/`--color-foreground`:
`--color-surface`, `--color-surface-raised`, `--color-body`, `--color-muted`,
`--color-hairline`, `--color-hairline-strong`, `--color-accent`, `--color-accent-strong`,
`--color-danger`. These generate `bg-surface`, `bg-surface-raised`, `text-body`, `text-muted`,
`border-hairline`, `border-hairline-strong`, `text-accent`/`bg-accent`, `bg-accent-strong`,
`text-danger` etc.

### Old→new class mapping (the sweep uses this table verbatim)

- `text-foreground/50` (body) → `text-body`
- `text-foreground/40`, `text-foreground/60` (labels/meta/muted) → `text-muted`
- `text-foreground/70` (secondary body, e.g. notes) → `text-body`
- `text-foreground/90` (headings) → **leave** `text-foreground`-equivalent (change to bare
  `text-foreground` for headings so they're fully bright — matches issue "full foreground for
  headings")
- `border-foreground/10`, `border-foreground/15` on **cards/rows** → `border-hairline`
- card container `border-foreground/10 p-4` → add `bg-surface` (cards become an elevated surface)
- manage panel / dialog container → `bg-surface-raised border-hairline-strong`
- `focus:border-foreground/40` → `focus:border-hairline-strong focus-visible:ring-1 focus-visible:ring-accent`
- primary buttons `bg-foreground/90 text-background` → `bg-accent-strong text-white`
- destructive `hover:text-red-500` → `hover:text-danger`

---

## Tasks

Implementer subagents, one per task. **Task 1 lands first** (everything depends on the tokens).
Tasks 2–6 each depend on Task 1; Tasks 2/3/4 all touch `JournalView.tsx` and `EntryDetail.tsx`,
so run them **sequentially in the order below** (or hand one implementer the JournalView-heavy
Tasks 2+4 together) to avoid merge churn. Task 5/6 touch layout/nav files and can run in parallel
with 3/4.

### Task 1 — Token layer in `globals.css`
- **Goal:** define the light+dark custom properties and `@theme inline` mappings above. No
  component edits yet; the build must stay green and existing `/40`,`/50` utilities keep working
  (we remove them in Task 2).
- **Files:** `src/app/globals.css`.
- **Tests:** none (CSS). Verify `pnpm build` compiles and the new `bg-surface`/`text-muted`/etc.
  utilities resolve (a throwaway usage or just trust Tailwind 4's on-demand generation — they
  generate because the `@theme` tokens exist).
- **Review gate:** hex values + contrast table match this doc; both `prefers-color-scheme`
  blocks present; existing tokens untouched in meaning.

### Task 2 — Type + surface + accent sweep across views
- **Goal:** apply the old→new mapping table to every view so labels/buttons/SelectionBar are
  legible, cards read as surfaces, panels as raised surfaces, and the green accent appears at
  the three confirmed points (active tab, primary buttons, focus rings). Owner's named pain
  points must visibly improve: entry-page Edit button, form labels, the sticky SelectionBar.
- **Files:** `TabBar.tsx`, `SelectionBar.tsx`, `SelectModeToggle.tsx`, `EntryCard.tsx`,
  `EntryDetail.tsx`, `EntryList.tsx`, `LibraryView.tsx`, `UnfiledView.tsx`, `JournalView.tsx`,
  `TrashView.tsx`, `SearchBar.tsx`, `PhotoTray.tsx`, `TranscriptEditor.tsx`, `EventLog.tsx`.
  (`grep -rEn "foreground/[0-9]+" src/app` is the worklist.)
- **Tests:** none (visual). `lamp.ts` green already covered; no logic changes.
- **Review gate:** no `text-foreground/40|/50|/60` left for body/labels (headings may become
  bare `text-foreground`); cards use `bg-surface`, panels `bg-surface-raised`; accent used
  **only** at the three points (grep for `bg-accent`/`text-accent` and eyeball); red destructive
  intact; SelectionBar readable against its sticky background.

### Task 3 — `<ConfirmDialog>` replacing all `window.confirm`
- **Goal:** one accessible styled confirm dialog + a promise-based `useConfirm()` that is a
  drop-in for `window.confirm` (`if (!(await confirm({...}))) return;`), wired into all 7 sites.
- **Files (new):** `src/app/ConfirmDialog.tsx` (presentational + provider/hook),
  `src/lib/confirm-controller.ts` (pure, framework-agnostic: `createConfirmController()` with
  `subscribe`, `confirm(opts): Promise<boolean>`, internal resolve on confirm/cancel — this is
  the unit-testable state core), `src/lib/focus-trap.ts` (pure `wrapIndex(current, count,
  shiftKey)` for Tab cycling).
- **Files (edit):** mount the provider once in `src/app/(tabs)/layout.tsx`; replace
  `window.confirm(...)` in `UnfiledView.tsx`, `TrashView.tsx` (×2), `JournalView.tsx` (×2),
  `EntryDetail.tsx`, `EntryCard.tsx` with `await confirm({ title, message, confirmLabel, tone:
  'danger' })`.
- **Dialog spec:** fixed overlay (`bg-black/50` backdrop) + centered panel
  (`bg-surface-raised border-hairline-strong rounded-2xl`); `role="alertdialog"`
  `aria-modal="true"` with `aria-labelledby`/`aria-describedby`; **default focus on Cancel**
  (so a stray Enter doesn't destroy data); Tab/Shift+Tab trapped between the two buttons via
  `wrapIndex`; backdrop click → cancel; return focus to the triggering element on close;
  destructive confirm button uses `bg-danger text-white`.
- **⚠️ Esc / `useEscUp` interaction (load-bearing):** `useEscUp` is a **bubble-phase** window
  listener that bails on `e.defaultPrevented`. If the dialog handled Esc in the bubble phase it
  would fire *after* `useEscUp` (which registered earlier on the view), so Esc would both close
  the dialog **and** navigate up. Fix: the dialog registers a **capture-phase** listener
  (`window.addEventListener("keydown", onKey, true)`) that on `Escape` calls
  `e.preventDefault()` (+ `stopPropagation()`) and cancels. Capture runs before any bubble
  listener, so `useEscUp` then sees `defaultPrevented` and does nothing. Note in the code
  comment that `isEditableTarget` does **not** save us here (the dialog buttons aren't editable
  targets) — the `preventDefault` is what matters.
- **Tests:** `src/lib/confirm-controller.test.ts` (confirm() returns a pending promise;
  resolving true/false; only-one-open invariant; cancel resolves false), `src/lib/focus-trap.test.ts`
  (`wrapIndex` forward/back wrap at both ends). Dialog rendering/focus-trap DOM behavior is
  verified in the smoke, not unit-tested (no jsdom).
- **Review gate:** zero `window.confirm` left in `src/app` (grep); Esc closes the dialog without
  also navigating up; focus returns to trigger; Cancel is the default focus.

### Task 4 — Journal manage panel: paper-archive toggle + date prefill + raised surface
- **Goal:** (a) replace the unclear `kind` `<select>` (—/Archive) with a checkbox/toggle labeled
  **"Old journal (paper archive)"**; (b) when the started/ended date inputs are empty, prefill
  them from the journal's computed first/last entry dates (`summary.firstEntryAt` /
  `lastEntryAt` already on the summary); (c) the panel already gets `bg-surface-raised` from
  Task 2 — confirm it reads distinct from entry cards.
- **Files:** `src/app/JournalView.tsx` (manage panel ~lines 313–401; kind select at 324–334,
  date inputs at 336–353), `src/lib/date-range.ts` (add the pure prefill helper — same file that
  owns `resolveJournalDateRange`).
- **Helpers (pure, tested):**
  - `isoToDateInput(iso: string | null): string` → `"YYYY-MM-DD"` in **local** time (empty
    string for null). Timezone-safe (must not day-shift west of UTC — build from
    `getFullYear/getMonth/getDate`, not `toISOString`). Used to seed the date fields from
    `firstEntryAt`/`lastEntryAt`.
  - kind mapping is trivial (`kind === "archive"` ⇄ checked) — inline it or a 2-line
    `paperArchiveChecked`/`checkedToKind` in `journal.ts`; keep the wire value `"archive"|null`
    unchanged so PR A's `validateJournalUpdate`/schema need no touch.
- **Behavior:** seeding is a *suggestion* on panel-open only — seed an empty `startedOn` field
  from `isoToDateInput(firstEntryAt)`, empty `endedOn` from `isoToDateInput(lastEntryAt)`; owner
  can clear or override; nothing auto-saves. Preserve an already-stored `startedOn`/`endedOn`.
- **Tests:** `src/lib/date-range.test.ts` (extend): `isoToDateInput` — valid iso → local date,
  null → "", the west-of-UTC no-shift case; kind mapping if a helper is added
  (`journal.test.ts`).
- **Review gate:** copy reads "Old journal (paper archive)"; wire value still `archive`/null;
  prefill only fills empty fields and never clobbers stored dates; no schema/route change.

### Task 5 — Desktop top-nav at md+ (`#35`)
- **Goal:** horizontal top-nav links in the sticky header on **md+** (owner decision #2);
  bottom `TabBar` becomes phone-only (`md:hidden`). Mother-site header vocabulary: the header
  in `(tabs)/layout.tsx` becomes `sticky top-0 z-30 border-b border-hairline
  bg-background/90 backdrop-blur` with the existing `max-w-2xl` content width.
- **Files:** `src/app/(tabs)/layout.tsx` (header), `src/app/TabBar.tsx` (add `md:hidden`),
  new `src/app/TopNav.tsx` (`hidden md:flex`, reuses `TABS`/`activeTab` from `src/lib/tabs.ts`
  and `useCaptureGuard` for the same busy-inert behavior; active link uses `text-accent`).
- **Mother-site reference:** `~/src/selected-projects/components/nav.tsx` — sticky
  `border-b bg-white/90 backdrop-blur`, `hidden … sm:flex text-sm` link row, hover to full
  foreground. Adapt colors to dark tokens (`bg-background/90`, `text-muted` → `hover:text-foreground`).
- **Tests:** none new — `activeTab`/`TABS` are already covered by `src/lib/tabs.test.ts`, and
  TopNav is a thin renderer over them (same pattern as TabBar). If any per-nav pure logic is
  introduced, unit-test it; otherwise smoke-only.
- **Review gate:** at md+ the top links appear + bottom bar is hidden; below md, bottom bar
  only; active state + capture-busy inert behavior match TabBar; `tabs.ts` remains the single
  source of truth (no duplicated route list).

### Task 6 — Mother-site finish: serif transcripts + (optional) footer (`#35`, owner-gated)
- **Goal (owner #4/#5):** if serif approved, load Newsreader via `next/font/google` in
  `layout.tsx` (add a `--font-serif` variable) and apply it to the transcript body on the entry
  detail page (`EntryDetail.tsx`) and/or `TranscriptEditor` read view. If footer approved, add a
  mother-site-style footer (`font-mono text-[11px] text-muted`, "Built … PT · <commit>") and
  move/duplicate the build stamp there, updating `docs/smoke-checklist.md` step 1.
- **Files:** `src/app/layout.tsx` (font), `src/app/EntryDetail.tsx` (serif class),
  optionally `(tabs)/layout.tsx` + `docs/smoke-checklist.md` (footer + stamp).
- **Tests:** none (visual).
- **Review gate:** serif applied to long-form transcript only (UI stays Geist Sans); if the
  stamp moves, the smoke checklist is updated so step 1 still points at a real location.

---

## Out of scope

- Journal cover photos (#33 — separate media phase), per-segment audio (#53).
- Library grouping build beyond the owner's chosen 1a/1b/1c (if 1a: badge only).
- Any schema/route/DB change — this is a styling pass; no migration.
- Search-view select mode, new search UI (#36 owns that).
- Node/pnpm bump (Phase 2), passkeys (Phase 5).

---

## Review checklist (final branch review)

- [ ] Tokens: dark + light custom props present; `@theme inline` maps all new colors; contrast
      table in this doc matches the hex actually shipped; measured `--muted` on
      `--surface-raised` ≥ 4.5:1.
- [ ] No `text-foreground/40|/50|/60` remain for body/labels; headings are full-bright; cards use
      `bg-surface`, panels/dialogs use `bg-surface-raised` + `border-hairline-strong` and read as
      distinct elevations.
- [ ] Accent (green) appears **only** at active tab, primary buttons, focus rings; primary
      buttons use `--accent-strong` + white text (not green-500 + white); red = destructive only.
- [ ] `grep -rn "window.confirm" src` returns nothing; all 7 sites use `useConfirm`.
- [ ] ConfirmDialog: `role="alertdialog"` + `aria-modal`, labelled/described, Tab trapped,
      default focus on Cancel, backdrop-click cancels, focus returns to trigger.
- [ ] Esc closes the dialog and does **not** also trigger `useEscUp` navigation (capture-phase
      `preventDefault` verified in the smoke).
- [ ] Journal manage: "Old journal (paper archive)" toggle; wire value still `archive`/null;
      started/ended prefill from computed first/last entry dates, only when empty, never
      clobbering stored dates.
- [ ] Desktop: top-nav at md+ with bottom tabs hidden; phone keeps bottom tabs; both driven by
      `tabs.ts`; capture-busy inert behavior consistent.
- [ ] `isoToDateInput` timezone-safe (no west-of-UTC day shift); unit tests green.
- [ ] `pnpm test` green (new: `confirm-controller`, `focus-trap`, extended `date-range`);
      `pnpm build` + `pnpm lint` clean.
- [ ] If serif adopted: only long-form transcript; if build stamp moved: smoke checklist updated.
</content>
</invoke>
