"use client";

// Per-entry detail page (issue #39), reached by tapping a card in Library/
// Search or via the post-save redirect. Transcript-first: unlike EntryCard's
// clamped preview, the full transcript reads top-to-bottom with nothing
// hidden. Same client-fetches-a-gated-route idiom as JournalView/EntryList —
// GET /api/entries/[id] for the row, GET /api/entries/[id]/photos for photos
// (getEntry doesn't carry photoCount, so this always fetches, unlike
// EntryCard's photoCount-gated fetch). Move…/Trash mirror EntryCard's
// handlers; trashing an entry you're looking at leaves nothing to show, so
// success routes back to Library instead of leaving a dead page mounted.
//
// ?saved=1 (RecorderClient's post-save redirect) shows a transient "Saved ✓"
// toast, matching RecorderClient's own toast idiom, plus a persistent "New
// recording" link back to Capture — carrying the written date forward via
// ?writtenAt= since (unlike the active journal, which is DB-backed) it's
// local RecorderClient state that would otherwise reset.
//
// Entry metadata editing (PR B): title/notes/location/written date are all
// post-save-only edits made here (never at capture) via PATCH /api/entries/
// [id] (metadata branch — separate from the existing move branch). The Edit
// affordance is hidden while the #54 post-save poll is still active so a
// late-arriving poll result can't be clobbered by (or clobber) an in-flight
// edit; Save writes the PATCH response straight into `entry` (handleMove's
// setEntry idiom), Cancel just drops the local form state.

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { pauseOthers } from "@/lib/audio-exclusive";
import { useRouter, useSearchParams } from "next/navigation";
import { formatElapsed } from "@/lib/elapsed";
import type { EntryRecord } from "@/lib/entry";
import type { PhotoRecord } from "@/lib/photo";
import { writtenAtDateInput, writtenAtIso } from "@/lib/written-at";
import {
  initialPollState,
  nextPollState,
  placeholderStatusLine,
  shouldPoll,
  stuckNote,
  POLL_INTERVAL_MS,
  type PollState,
} from "@/lib/post-save-poll";
import { idbPendingStore } from "./idb-pending";
import { openSelectPicker } from "./openSelectPicker";
import { useEscUp } from "./useEscUp";
import { useJournals } from "./useJournals";

// Sentinel for the Move picker's "Unfiled" option — same idea as
// EntryCard.tsx's UNFILED_VALUE / search.ts's UNFILED_FILTER.
const UNFILED_VALUE = "__unfiled__";

function formatWhen(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

export default function EntryDetail({ id }: { id: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const justSaved = searchParams.get("saved") === "1";

  // undefined = still awaiting the row; null = confirmed absent (404 on a
  // non-post-save visit); EntryRecord = loaded.
  const [entry, setEntry] = useState<EntryRecord | null | undefined>(undefined);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [photos, setPhotos] = useState<PhotoRecord[] | null>(null);
  const { journals } = useJournals();

  // Issue #54: post-save polling. After Done, RecorderClient navigates here
  // with ?saved=1 BEFORE the row exists — the save POST (and the after() -hook
  // enrichment) land a beat later. We poll the entry route, driving the pure
  // state machine (post-save-poll.ts): awaiting-entry → awaiting-enrichment →
  // done (or timed-out). A skeleton placeholder with a cycling status line
  // covers the awaiting-entry wait; enrichment (title/summary/tags) pops in
  // once it lands. On a normal (non-post-save) visit the first fetch resolves
  // straight to done — one request, today's behavior.
  const [pollState, setPollState] = useState<PollState>(initialPollState);
  const [elapsedMs, setElapsedMs] = useState(0);
  // Whether a durable pending-save record still exists on this device (the #23
  // net) — drives the honest amber note (stuckNote). Checked on mount and on
  // every phase change (so a terminal phase re-reads the freshest truth).
  const [pendingExists, setPendingExists] = useState(false);
  // The real error text from that record's last failed blob upload (issue #46
  // loud-error contract) — appended to the amber note so the diagnostic string
  // reaches the phone rather than only the console. null when none.
  const [pendingError, setPendingError] = useState<string | null>(null);

  const [trashing, setTrashing] = useState(false);
  const [trashError, setTrashError] = useState<string | null>(null);
  const [movePickerOpen, setMovePickerOpen] = useState(false);
  const [moving, setMoving] = useState(false);
  const [moveError, setMoveError] = useState<string | null>(null);

  // Post-save metadata editing (PR B): title/notes/location/written date.
  // Local form state, only populated when editing starts (startEdit) — never
  // derived live from `entry` while editing, so a poll's setEntry (still
  // possible until `polling` goes false, which is also what gates the Edit
  // button itself) can't clobber in-progress input.
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editLocation, setEditLocation] = useState("");
  const [editWrittenDate, setEditWrittenDate] = useState(""); // YYYY-MM-DD for <input type="date">
  const [editNotes, setEditNotes] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  // A ref-backed mirror of pollState so the interval closure always advances
  // from the current phase without re-subscribing on every transition.
  const stateRef = useRef<PollState>(initialPollState());
  useEffect(() => {
    let alive = true;
    const start = Date.now();
    stateRef.current = initialPollState();
    setPollState(stateRef.current);
    setElapsedMs(0);
    let timer: ReturnType<typeof setInterval> | null = null;
    const stop = () => {
      if (timer != null) {
        clearInterval(timer);
        timer = null;
      }
    };
    const advance = (event: Parameters<typeof nextPollState>[1]): PollState => {
      const ns = nextPollState(stateRef.current, event);
      stateRef.current = ns;
      setPollState(ns);
      return ns;
    };

    const applyResult = (e: EntryRecord | null) => {
      if (!alive) return;
      // A 404 on a normal (non-post-save) visit is today's immediate answer:
      // the entry is genuinely gone/trashed — don't sit on the placeholder.
      if (e === null && !justSaved) {
        setEntry(null);
        stateRef.current = { ...stateRef.current, phase: "done" };
        setPollState(stateRef.current);
        stop();
        return;
      }
      if (e) setEntry(e);
      const after = advance({ type: "result", entry: e ? { enrichedAt: e.enrichedAt } : null });
      if (!shouldPoll(after.phase)) stop();
    };

    const poll = async () => {
      if (!alive) return;
      const el = Date.now() - start;
      setElapsedMs(el);
      const afterTick = advance({ type: "tick", elapsedMs: el });
      if (!shouldPoll(afterTick.phase)) {
        stop();
        return;
      }
      try {
        const res = await fetch(`/api/entries/${id}`);
        if (res.status === 404) {
          applyResult(null);
          return;
        }
        if (!res.ok) throw new Error(`entry route ${res.status}`);
        applyResult(((await res.json()) as { entry: EntryRecord }).entry);
      } catch (err) {
        if (!alive) return;
        setLoadError(err instanceof Error ? err.message : String(err));
        // Finding 3: transient-error tolerance is ONLY for the just-saved path
        // (the row may simply not exist yet). On a normal visit a non-404
        // failure (e.g. a 500) is a real load error — surface it immediately
        // and stop, rather than sitting on a blank screen for the whole poll
        // window and ending in a misleading save-flavored timeout note.
        if (!justSaved) {
          stateRef.current = { ...stateRef.current, phase: "done" };
          setPollState(stateRef.current);
          stop();
        }
      }
    };

    void poll();
    timer = setInterval(() => void poll(), POLL_INTERVAL_MS);
    return () => {
      alive = false;
      stop();
    };
  }, [id, justSaved]);

  // Pending-save record presence (issue #54) — checked on mount and whenever
  // the phase changes, so a phase reaching a terminal state re-reads the truth
  // (e.g. onStop may have just deleted a clean record). Reads the full record
  // so `lastError` can join the amber note (#46).
  //
  // Finding 4 (false amber flash): at phase "done" the check can race onStop's
  // delete-after-201, showing "Audio is still uploading" for a clean save until
  // the enrichment budget expires. So at "done" we re-check ONCE after a poll
  // interval, giving that delete time to land; other phases check immediately.
  useEffect(() => {
    if (typeof indexedDB === "undefined") return;
    let alive = true;
    const check = () => {
      void idbPendingStore
        .get(id)
        .then((rec) => {
          if (!alive) return;
          setPendingExists(rec !== undefined);
          setPendingError(rec?.lastError ?? null);
        })
        .catch(() => {
          /* IndexedDB unavailable — treat as no pending record */
        });
    };
    if (pollState.phase === "done") {
      const t = setTimeout(check, POLL_INTERVAL_MS);
      return () => {
        alive = false;
        clearTimeout(t);
      };
    }
    check();
    return () => {
      alive = false;
    };
  }, [id, pollState.phase]);

  // Photos aren't on the GET /api/entries/[id] payload (unlike the list/
  // search routes' photoCount) — fetch once the entry itself has loaded.
  useEffect(() => {
    if (!entry) return;
    let alive = true;
    fetch(`/api/entries/${entry.id}/photos`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`photos route ${res.status}`);
        return (await res.json()) as { photos: PhotoRecord[] };
      })
      .then((data) => {
        if (alive) setPhotos(data.photos);
      })
      .catch(() => {
        // The transcript is still readable without photos; leave them unset.
      });
    return () => {
      alive = false;
    };
  }, [entry]);

  async function handleDelete() {
    if (!entry) return;
    if (
      !window.confirm(
        "Move this entry to trash? It disappears from the list but nothing is destroyed — it can be recovered later.",
      )
    ) {
      return;
    }
    setTrashing(true);
    setTrashError(null);
    try {
      const res = await fetch(`/api/entries/${entry.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`delete route ${res.status}`);
      // Nothing left to show on this page once it's trashed.
      router.push("/library");
    } catch (err) {
      setTrashError(err instanceof Error ? err.message : String(err));
      setTrashing(false);
    }
  }

  async function handleMove(journalId: string | null) {
    if (!entry) return;
    setMoving(true);
    setMoveError(null);
    try {
      const res = await fetch(`/api/entries/${entry.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ journalId }),
      });
      if (!res.ok) throw new Error(`move route ${res.status}`);
      setMovePickerOpen(false);
      setEntry((prev) => (prev ? { ...prev, journalId } : prev));
    } catch (err) {
      setMoveError(err instanceof Error ? err.message : String(err));
    } finally {
      setMoving(false);
    }
  }

  function startEdit() {
    if (!entry) return;
    setEditTitle(entry.title ?? "");
    setEditLocation(entry.location ?? "");
    setEditWrittenDate(entry.writtenAt ? (writtenAtDateInput(entry.writtenAt) ?? "") : "");
    setEditNotes(entry.notes ?? "");
    setEditError(null);
    setEditing(true);
  }

  function cancelEdit() {
    setEditing(false);
    setEditError(null);
  }

  async function handleSaveEdit() {
    if (!entry) return;
    setSavingEdit(true);
    setEditError(null);
    try {
      const res = await fetch(`/api/entries/${entry.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: editTitle,
          location: editLocation,
          notes: editNotes,
          // Blank = clearing (the field is available for every entry, not
          // just journal ones); a filled date is anchored at local noon
          // (writtenAtIso) same as capture-time — a malformed value can't
          // reach here (the browser date picker only yields well-formed
          // YYYY-MM-DD or "").
          writtenAt: editWrittenDate.trim() ? (writtenAtIso(editWrittenDate) ?? null) : null,
        }),
      });
      if (!res.ok) throw new Error(`entry update route ${res.status}`);
      const data = (await res.json()) as { entry: EntryRecord };
      setEntry(data.entry);
      setEditing(false);
    } catch (err) {
      setEditError(err instanceof Error ? err.message : String(err));
    } finally {
      setSavingEdit(false);
    }
  }

  const journalLabel =
    entry?.journalId ? (journals?.find((j) => j.id === entry.journalId)?.label ?? "journal") : null;
  // "New recording" carries the written date AND page label forward (both are
  // local Capture state that would otherwise reset — unlike the DB-backed
  // active journal). Built via URLSearchParams so a page label with spaces/
  // dashes is encoded correctly; the writtenAt-only and empty cases stay
  // byte-identical to before.
  const writtenDateParam = entry?.writtenAt ? writtenAtDateInput(entry.writtenAt) : undefined;
  const newRecordingParams = new URLSearchParams();
  if (writtenDateParam) newRecordingParams.set("writtenAt", writtenDateParam);
  if (entry?.pageLabel) newRecordingParams.set("pageLabel", entry.pageLabel);
  const newRecordingQuery = newRecordingParams.toString();
  const newRecordingHref = newRecordingQuery ? `/?${newRecordingQuery}` : "/";

  const polling = shouldPoll(pollState.phase);
  // The honest amber banner: safe-and-retrying / couldn't-confirm / audio-still-
  // uploading, or null when there's nothing to flag (see stuckNote).
  const note = stuckNote({ phase: pollState.phase, pendingRecordExists: pendingExists });
  // Skeleton placeholder only while a post-save row hasn't landed yet.
  const showPlaceholder = entry === undefined && justSaved && polling;

  // Esc goes "up": close whatever's open first, else back to this entry's
  // journal (or Unfiled). Presses inside the edit form's inputs don't land
  // here (useEscUp ignores editable targets), so Esc there needs one extra
  // tab-out — acceptable.
  useEscUp(() => {
    if (editing) {
      cancelEdit();
      return;
    }
    if (movePickerOpen) {
      setMovePickerOpen(false);
      return;
    }
    router.push(
      entry?.journalId
        ? `/library/${entry.journalId}`
        : entry
          ? "/library/unfiled"
          : "/library",
    );
  });

  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <Link href="/library" className="text-xs text-foreground/40 hover:text-foreground/70">
          ← Library
        </Link>
        {justSaved && (
          <Link
            href={newRecordingHref}
            className="rounded-full border border-foreground/20 px-3 py-1 text-xs text-foreground/70 transition-colors hover:bg-foreground/[0.06]"
          >
            New recording
          </Link>
        )}
      </div>

      {note && (
        <p className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm text-amber-600">
          {note.text}
          {/* Finding 2 (#46): surface the real upload error so the diagnostic
              string reaches the phone, not only the console. */}
          {pendingError && <span className="mt-1 block text-xs opacity-70">({pendingError})</span>}
        </p>
      )}

      {/* Post-save wait: skeleton + a cycling status line so the gap between
          "Done" and the row landing reads as progress rather than a hang. */}
      {showPlaceholder && (
        <div className="flex flex-col gap-3">
          <div className="h-6 w-2/3 animate-pulse rounded bg-foreground/10" />
          <div className="flex flex-col gap-2">
            <div className="h-4 w-full animate-pulse rounded bg-foreground/10" />
            <div className="h-4 w-5/6 animate-pulse rounded bg-foreground/10" />
            <div className="h-4 w-4/6 animate-pulse rounded bg-foreground/10" />
          </div>
          <p className="text-sm text-foreground/50" aria-live="polite">
            {placeholderStatusLine(elapsedMs)}
          </p>
        </div>
      )}

      {/* A hard error only surfaces once polling has stopped without a row —
          transient blips during the poll window are swallowed (see the loop). */}
      {loadError && entry === undefined && !polling && !note && (
        <p className="text-sm text-red-500">Couldn’t load entry: {loadError}</p>
      )}

      {entry === null && !loadError && (
        <p className="text-sm text-foreground/40">No such entry.</p>
      )}

      {entry === undefined && !justSaved && polling && !loadError && (
        <p className="text-sm text-foreground/40">Loading…</p>
      )}

      {entry && (
        <>
          {editing ? (
            <div className="flex flex-col gap-2">
              <input
                type="text"
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                placeholder={formatWhen(entry.recordedAt)}
                aria-label="Title"
                className="rounded-lg border border-foreground/15 bg-transparent px-3 py-2 text-sm outline-none focus:border-foreground/40"
              />
              <input
                type="text"
                value={editLocation}
                onChange={(e) => setEditLocation(e.target.value)}
                placeholder="Location"
                aria-label="Location"
                className="rounded-lg border border-foreground/15 bg-transparent px-3 py-2 text-sm outline-none focus:border-foreground/40"
              />
              <label className="flex flex-col gap-1 text-xs text-foreground/50">
                Written date
                <input
                  type="date"
                  value={editWrittenDate}
                  onChange={(e) => setEditWrittenDate(e.target.value)}
                  className="rounded-lg border border-foreground/15 bg-transparent px-3 py-2 text-sm text-foreground outline-none focus:border-foreground/40"
                />
              </label>
              <textarea
                value={editNotes}
                onChange={(e) => setEditNotes(e.target.value)}
                placeholder="Notes"
                rows={3}
                aria-label="Notes"
                className="rounded-lg border border-foreground/15 bg-transparent px-3 py-2 text-sm outline-none focus:border-foreground/40"
              />
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleSaveEdit}
                  disabled={savingEdit}
                  className="rounded-full border border-foreground/20 px-3 py-1 text-xs text-foreground/70 transition-colors hover:bg-foreground/[0.06] disabled:opacity-50"
                >
                  {savingEdit ? "Saving…" : "Save"}
                </button>
                <button
                  type="button"
                  onClick={cancelEdit}
                  disabled={savingEdit}
                  className="text-xs text-foreground/40 hover:text-foreground/70 disabled:opacity-50"
                >
                  Cancel
                </button>
              </div>
              {editError && (
                <p className="text-sm text-red-500">Couldn’t save: {editError}</p>
              )}
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <h1 className="text-lg font-medium text-foreground/90">
                {entry.title ?? formatWhen(entry.recordedAt)}
              </h1>
              {entry.title && (
                <span className="text-xs text-foreground/40">{formatWhen(entry.recordedAt)}</span>
              )}
              {(journalLabel || entry.writtenAt || entry.pageLabel || entry.location) && (
                <div className="flex flex-wrap items-center gap-2 text-xs text-foreground/40">
                  {journalLabel && (
                    <span className="rounded-full border border-foreground/10 px-2 py-0.5">
                      📓 {journalLabel}
                    </span>
                  )}
                  {entry.pageLabel && (
                    <span className="rounded-full border border-foreground/10 px-2 py-0.5">
                      {entry.pageLabel}
                    </span>
                  )}
                  {entry.location && (
                    <span className="rounded-full border border-foreground/10 px-2 py-0.5">
                      📍 {entry.location}
                    </span>
                  )}
                  {entry.writtenAt && (
                    <span>written {new Date(entry.writtenAt).toLocaleDateString()}</span>
                  )}
                </div>
              )}
              {entry.summary && (
                <p className="text-sm italic text-foreground/60">{entry.summary}</p>
              )}
              {entry.notes && (
                <p className="whitespace-pre-wrap text-sm text-foreground/70">{entry.notes}</p>
              )}
              {entry.tags.length > 0 && (
                <ul className="flex flex-wrap gap-1.5">
                  {entry.tags.map((tag) => (
                    <li
                      key={tag}
                      className="rounded-full bg-foreground/5 px-2 py-0.5 text-xs text-foreground/60"
                    >
                      {tag}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {/* Action bar lives up top, under the title — owner request
              2026-07-28 (was buried below transcript/audio/photos). */}
          <div className="flex flex-col gap-2 border-b border-foreground/10 pb-3">
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs tabular-nums text-foreground/50">
                {formatElapsed(entry.durationSeconds)}
              </span>
              <span className="flex shrink-0 items-center gap-2">
                {/* Hidden while the #54 post-save placeholder/poll is still
                    active — entering edit mode against a row that hasn't
                    fully landed (or whose poll could still update it) is
                    confusing rather than useful. */}
                {!polling && !editing && (
                  <button
                    type="button"
                    onClick={startEdit}
                    className="rounded-full border border-foreground/20 px-3 py-1 text-xs text-foreground/70 transition-colors hover:bg-foreground/[0.06]"
                  >
                    ✏️ Edit
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setMovePickerOpen((open) => !open)}
                  disabled={moving}
                  className="rounded-full border border-foreground/20 px-3 py-1 text-xs text-foreground/70 transition-colors hover:bg-foreground/[0.06] disabled:opacity-50"
                >
                  {moving ? "Moving…" : "📁 Move…"}
                </button>
                <button
                  type="button"
                  onClick={handleDelete}
                  disabled={trashing}
                  className="rounded-full border border-foreground/20 px-3 py-1 text-xs text-foreground/70 transition-colors hover:border-red-300 hover:text-red-500 disabled:opacity-50"
                >
                  {trashing ? "Trashing…" : "🗑 Trash"}
                </button>
              </span>
            </div>
            {movePickerOpen && (
              <div className="flex items-center gap-2 text-xs text-foreground/50">
                <span>Move to</span>
                <select
                  ref={openSelectPicker}
                  defaultValue=""
                  disabled={moving}
                  onChange={(ev) => {
                    const v = ev.target.value;
                    if (!v) return;
                    handleMove(v === UNFILED_VALUE ? null : v);
                  }}
                  aria-label="Move to journal"
                  className="rounded-lg border border-foreground/15 bg-transparent px-2 py-1 text-xs outline-none focus:border-foreground/40"
                >
                  <option value="" disabled>
                    Choose…
                  </option>
                  {entry.journalId !== null && <option value={UNFILED_VALUE}>Unfiled</option>}
                  {journals
                    ?.filter((j) => j.id !== entry.journalId)
                    .map((j) => (
                      <option key={j.id} value={j.id}>
                        {j.label}
                      </option>
                    ))}
                </select>
                <button
                  type="button"
                  onClick={() => setMovePickerOpen(false)}
                  className="text-foreground/40 hover:text-foreground/70"
                >
                  Cancel
                </button>
              </div>
            )}
            {moveError && (
              <p className="text-sm text-red-500">Couldn’t move entry: {moveError}</p>
            )}
            {trashError && (
              <p className="text-sm text-red-500">Couldn’t trash entry: {trashError}</p>
            )}
          </div>

          {/* Transcript-first: full text, no clamp — this is the read view. */}
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground/80">
            {entry.transcript}
          </p>

          {entry.audioUrl && (
            <audio
              controls
              preload="metadata"
              src={entry.audioUrl}
              className="w-full"
              onPlay={(e) =>
                pauseOthers(document.querySelectorAll("audio"), e.currentTarget)
              }
            >
              <track kind="captions" />
            </audio>
          )}
          {entry.audioUrl && entry.audioComplete === false && (
            <p className="text-xs text-amber-600">
              ⚠ Audio is partial — this entry was paused, so only the last segment was
              recorded. The transcript is complete.
            </p>
          )}

          {(photos?.length ?? 0) > 0 && (
            <ul className="flex flex-wrap gap-2">
              {photos?.map((p) => (
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

        </>
      )}
    </section>
  );
}
