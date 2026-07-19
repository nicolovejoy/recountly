"use client";

// Composition root for the Capture tab. All imperative session logic lives
// in useRecorder (WebRTC, timer, meter, cancellation); the transcript caret
// logic lives in TranscriptEditor; this component wires them together and
// keeps page-level UI policy (the Esc shortcut, the capture-guard sync).
// Header chrome (brand + build stamp) and the tab bar live in (tabs)/layout.

import { useCallback, useEffect, useRef, useState } from "react";
import { upload } from "@vercel/blob/client";
import { primaryAction, guardBusy, isCaptureBusy, type SaveState } from "@/lib/recorder-state";
import { shouldFlushOnHide } from "@/lib/lifecycle-flush";
import { uploadEntryBlobs } from "@/lib/blob-upload";
import { buildSaveBody, withinKeepaliveCap } from "@/lib/save-payload";
import { ulid } from "@/lib/ulid";
import { downscalePhoto } from "@/lib/image";
import { writtenAtIso } from "@/lib/written-at";
import { planSave } from "@/lib/save-plan";
import { idbPendingStore } from "./idb-pending";
import { useRecorder, type RecordingResult } from "./useRecorder";
import { useJournals } from "./useJournals";
import { useCaptureGuard } from "./CaptureGuard";
import TranscriptEditor, { type TranscriptEditorHandle } from "./TranscriptEditor";
import RecordButton from "./RecordButton";
import RecStatusLine from "./RecStatusLine";
import EventLog from "./EventLog";
import JournalBar from "./JournalBar";
import PhotoTray from "./PhotoTray";

export default function RecorderClient() {
  const editorRef = useRef<TranscriptEditorHandle | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [saveError, setSaveError] = useState<string | null>(null);

  // "Saved ✓" is a fixed toast (see below) — clear it so it doesn't sit over
  // the page forever. Errors stay until explicitly dismissed.
  useEffect(() => {
    if (saveState !== "saved") return;
    const t = setTimeout(() => setSaveState("idle"), 4000);
    return () => clearTimeout(t);
  }, [saveState]);

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

  // The entry id, shared across the normal Done save AND a lifecycle flush
  // (issue #23 Task 8 — see the pagehide/visibilitychange effect below): a
  // flush that fires before Done finishes must reuse the SAME id so its
  // transcript-only insert and the later full-refs save land on one row
  // (idempotent upsert — src/lib/entry-sql.ts). Minted lazily by whichever
  // fires first; cleared only once a save fully succeeds.
  const entryIdRef = useRef<string | null>(null);
  const getEntryId = useCallback(() => {
    if (!entryIdRef.current) entryIdRef.current = ulid();
    return entryIdRef.current;
  }, []);
  // elapsedSec snapshot taken the instant Done is tapped — useRecorder's
  // stop() zeroes elapsedSec synchronously (well before a lifecycle flush
  // might fire during the finishing/saving window), so the flush path needs
  // its own copy of "how long was this take" for that window.
  const pendingDurationRef = useRef(0);
  // "Already fired" guard for the lifecycle-flush effect below — pagehide and
  // visibilitychange(hidden) commonly fire together for one hide episode.
  const flushFiredRef = useRef(false);

  // Done's save trigger (issue #23 client-direct flow): mint the entry id +
  // per-photo ids, upload the blobs STRAIGHT to Vercel Blob (audio best-effort,
  // photos NOT — a photo throw aborts and keeps the tray), then POST a small
  // JSON body of the refs. keepalive when the body fits the 64 KB cap so a
  // backgrounded tab still lands the save. An empty transcript is a no-op.
  const onStop = useCallback(
    async (result: RecordingResult) => {
      const transcript = editorRef.current?.getValue().trim() ?? "";
      if (planSave(transcript).kind === "empty") {
        setSaveError(
          "Nothing to save — the transcript was empty when the session ended. Any attached photos are still here; record or dictate again and they'll be included.",
        );
        setSaveState("error");
        return;
      }
      setSaveState("saving");
      setSaveError(null);

      const id = getEntryId();
      const journalId = active?.id;
      const photos = pendingPhotos.map((p) => ({ id: ulid(), blob: p.blob, mime: p.mime }));
      const audio = result.audioBlob
        ? {
            blob: result.audioBlob,
            mime: result.audioMime ?? "audio/webm",
            complete: result.audioComplete ?? true,
          }
        : null;

      // Issue #23 Task 9: persist a durable snapshot to IndexedDB BEFORE
      // starting uploads, so a crash/discard between now and the confirmed
      // full-refs 201 below leaves a record PendingSaveRecovery can retry on
      // next open. audio/photos fields are placeholders — retryPending fills
      // them in from the re-uploaded refs; only the raw Blobs above matter.
      // Best-effort: IndexedDB being unavailable must never block a save.
      try {
        await idbPendingStore.put({
          id,
          body: buildSaveBody({
            id,
            transcript,
            durationSeconds: result.durationSeconds,
            journalId,
            writtenAt: writtenAtIso(writtenDate),
            audio: null,
            photos: [],
          }),
          audio,
          photos,
          createdAt: Date.now(),
        });
      } catch {
        /* IndexedDB unavailable — proceed without the durability net */
      }

      let uploaded;
      try {
        uploaded = await uploadEntryBlobs({ entryId: id, audio, photos }, upload);
      } catch (err) {
        // Photos are not best-effort: keep the tray so the user can retry Done.
        setSaveError(
          `Photo upload failed — your photos are still attached; tap Done again. (${
            err instanceof Error ? err.message : String(err)
          })`,
        );
        setSaveState("error");
        return;
      }

      const body = buildSaveBody({
        id,
        transcript,
        durationSeconds: result.durationSeconds,
        journalId: active?.id,
        writtenAt: writtenAtIso(writtenDate),
        audio: uploaded.audio,
        photos: uploaded.photos,
      });
      const json = JSON.stringify(body);

      try {
        const res = await fetch("/api/entries", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: json,
          keepalive: withinKeepaliveCap(json),
        });
        if (!res.ok) throw new Error(`save failed (${res.status}): ${await res.text()}`);
        editorRef.current?.clear();
        pendingPhotos.forEach((p) => URL.revokeObjectURL(p.previewUrl));
        setPendingPhotos([]);
        setWrittenDate("");
        setSaveState("saved");
        // Fully landed — the next recording (or a retry after a later error)
        // gets a fresh id / flush guard.
        entryIdRef.current = null;
        flushFiredRef.current = false;
        // This is the confirmed FULL-REFS 201 (audio/photo refs included) —
        // the only response that should clear the pending-save record. The
        // Task 8 lifecycle-flush POST is transcript-only and never reaches
        // here, so it can never delete a record that still needs its blobs
        // attached. Best-effort cleanup — a failure just leaves the record
        // for PendingSaveRecovery to clean up (harmlessly) on next open.
        try {
          await idbPendingStore.delete(id);
        } catch {
          /* best-effort cleanup */
        }
      } catch (err) {
        setSaveError(err instanceof Error ? err.message : String(err));
        setSaveState("error");
      }
    },
    [active?.id, writtenDate, pendingPhotos, getEntryId],
  );

  const { status, elapsedSec, interim, errorMsg, log, start, pause, resume, stop, forceFlush, meterRef } =
    useRecorder({
      onSegment: (segment) => editorRef.current?.append(segment),
      onStop,
    });

  // Issue #23 Task 8 — lifecycle flush: while a capture session is in flight
  // OR a save is between Done and the POST settling, a backgrounded/discarded
  // tab can't be trusted to keep a setTimeout or an in-flight fetch(audio
  // upload) alive. Register pagehide/visibilitychange listeners for exactly
  // that window (shouldFlushOnHide) and, on fire, force out a TRANSCRIPT-ONLY
  // keepalive JSON save (audio: null, photos: []) — blob uploads can't be
  // trusted to finish in a hidden tab, and posting refs to blobs that never
  // landed would create rows pointing at nothing. The audio/photos still land
  // later via the normal path (accelerated below) or, once built, Task 9's
  // IndexedDB recovery — this flush's insert is NOT deleted by that later
  // path, only replaced/attached onto via the Task 1 idempotent upsert.
  // Mirrors elapsedSec so fire() (below) reads a live value without the
  // listener-registration effect re-running on every 250ms timer tick.
  const elapsedSecRef = useRef(elapsedSec);
  useEffect(() => {
    elapsedSecRef.current = elapsedSec;
  }, [elapsedSec]);
  // iOS bfcache restore fires `pageshow`, not necessarily `visibilitychange`
  // — without this, a page restored from bfcache after a flush could carry a
  // stale "already fired" guard into its NEXT hide and silently skip that
  // flush. Registered unconditionally (not gated on shouldFlushOnHide, unlike
  // the effect below) so it's armed across the whole component lifetime.
  useEffect(() => {
    const onPageShow = () => {
      flushFiredRef.current = false;
    };
    window.addEventListener("pageshow", onPageShow);
    return () => window.removeEventListener("pageshow", onPageShow);
  }, []);
  useEffect(() => {
    if (!shouldFlushOnHide(status, saveState)) return;

    const fire = () => {
      // "Already fired" guard: pagehide and visibilitychange(hidden) commonly
      // fire together for one hide episode — only act once per episode.
      if (flushFiredRef.current) return;
      flushFiredRef.current = true;

      // Merge the interim tail FIRST when still capturing, before reading the
      // editor: stop() is what delivers the not-yet-finalized tail (Task 7),
      // and TranscriptEditor's append/getValue are synchronous DOM ops (see
      // TranscriptEditor.tsx — uncontrolled textarea via ref), so the merged
      // text is readable immediately after stop() returns. Reading the editor
      // BEFORE stop() (the original bug) POSTs a transcript truncated at the
      // last completed segment — and since the server upsert is
      // transcript-first-write-wins, that truncation is PERMANENT.
      const captureBusy = isCaptureBusy(status);
      if (captureBusy) stop();

      const transcript = editorRef.current?.getValue().trim() ?? "";
      if (planSave(transcript).kind !== "empty") {
        const durationSeconds = captureBusy ? elapsedSecRef.current : pendingDurationRef.current;
        const id = getEntryId();
        const body = buildSaveBody({
          id,
          transcript,
          durationSeconds,
          journalId: active?.id,
          writtenAt: writtenAtIso(writtenDate),
          audio: null,
          photos: [],
        });
        const json = JSON.stringify(body);

        // Persist a pending-save snapshot in PARALLEL with the POST (not
        // awaited first): onStop's own put() runs off an async audioPromise
        // continuation that pagehide gives no guarantee will run before the
        // page is actually killed, so this flush must persist for itself too.
        // audio: null — audio isn't finalized at flush time. If onStop's put()
        // DOES still land later (the accelerated teardown below), it
        // overwrites this same id with the full record including audio — so a
        // killed page only ever loses audio on recovery, never the transcript
        // or photos.
        try {
          void idbPendingStore.put({
            id,
            body,
            audio: null,
            photos: pendingPhotos.map((p) => ({ id: ulid(), blob: p.blob, mime: p.mime })),
            createdAt: Date.now(),
          });
        } catch {
          /* best-effort — a killed page can't be blocked on IndexedDB either */
        }

        // Fire-and-forget: this is the emergency path itself, nothing left to
        // fall back to if it fails, and there's no page left to show an error
        // in. Same keepalive-cap guard as onStop — some browsers silently
        // reject an over-cap keepalive fetch outright.
        void fetch("/api/entries", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: json,
          keepalive: withinKeepaliveCap(json),
        }).catch(() => {});
      }

      // Accelerate any pending session teardown: a live/paused/connecting
      // session already got its implicit Done above (stop()); a Done already
      // in flight (status back to idle, saveState "finishing") just gets its
      // pending flush timer run now instead of after FLUSH_MS. No-op in
      // "saving" (the flush already fired earlier) — this call is a bonus,
      // not the save itself.
      forceFlush();
    };

    const onVisibility = () => {
      if (document.visibilityState === "hidden") fire();
      else flushFiredRef.current = false; // re-arm for the next hide episode
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", fire);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", fire);
    };
  }, [status, saveState, active?.id, writtenDate, stop, forceFlush, getEntryId, pendingPhotos]);

  // The one circular control's action is derived from status (single tested
  // source of truth — see primaryAction).
  const onPressPrimary = () => {
    switch (primaryAction(status)) {
      case "start": return start();
      case "cancel": return stop();
      case "pause": return pause();
      case "resume": return resume();
    }
  };

  const inSession = status === "connecting" || status === "live" || status === "paused";

  // Report session-OR-save-in-flight to the tab bar (disables Library/Search):
  // navigating away during "finishing"/"saving" would unmount this page and
  // silently lose a failed save's transcript. The cleanup keeps the guard
  // honest between changes and on unmount.
  const { setBusy, setStatus } = useCaptureGuard();
  useEffect(() => {
    setBusy(guardBusy(status, saveState));
    setStatus(status);
    return () => {
      setBusy(false);
      setStatus("idle");
    };
  }, [status, saveState, setBusy, setStatus]);

  // Esc, from anywhere on the page (incl. while typing in the transcript —
  // listen on the document so a focused textarea can't swallow it): pause while
  // live, cancel an in-flight connect, do nothing once paused (Done is explicit).
  useEffect(() => {
    if (status !== "live" && status !== "connecting") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        if (status === "live") pause();
        else stop(); // connecting → cancel
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [status, pause, stop]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex justify-end">
        <span className="rounded-full border border-foreground/10 px-3 py-1 text-xs text-foreground/50">
          {status}
        </span>
      </div>

      <div className="flex flex-col items-center gap-3">
        <RecordButton status={status} onPress={onPressPrimary} />
        <RecStatusLine status={status} elapsedSec={elapsedSec} meterRef={meterRef} />
        {inSession && (
          <button
            onClick={() => {
              // Snapshot before stop() zeroes elapsedSec — the lifecycle
              // flush (issue #23 Task 8) needs this if it fires during the
              // finishing/saving window that follows.
              pendingDurationRef.current = elapsedSec;
              setSaveState("finishing");
              stop();
            }}
            className="rounded-full border border-foreground/20 px-4 py-1 text-sm text-foreground/70 transition-colors hover:bg-foreground/[0.06]"
          >
            Done
          </button>
        )}
        {status === "live" && (
          <p className="text-xs text-foreground/40">
            press <kbd className="font-mono">Esc</kbd> to pause
          </p>
        )}
        {status === "paused" && (
          <p className="text-xs text-foreground/40">tap the red button to resume</p>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <JournalBar
          journals={journals}
          active={active}
          writtenDate={writtenDate}
          onSelect={(id) => void setActive(id)}
          onCreate={async (label) => {
            const j = await create(label);
            if (j) await setActive(j.id);
            return j !== null;
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

      {errorMsg && (
        <p className="rounded-lg border border-red-500/30 bg-red-500/5 px-4 py-3 text-sm text-red-500">
          {errorMsg}
        </p>
      )}

      <TranscriptEditor ref={editorRef} interim={interim} />

      {/* Save status lives in a fixed toast, not inline — on a phone the area
          below the transcript is often beneath the fold, which made save
          feedback (and the save-failure banner) invisible right when it
          mattered. */}
      {saveState !== "idle" && (
        <div className="fixed inset-x-0 top-3 z-50 flex justify-center px-4">
          {saveState === "error" ? (
            <div className="flex max-w-md items-start gap-3 rounded-lg border border-red-500/40 bg-background px-4 py-3 text-sm text-red-500 shadow-lg">
              <span>Couldn’t save: {saveError}</span>
              <button
                type="button"
                onClick={() => setSaveState("idle")}
                aria-label="Dismiss"
                className="shrink-0 text-red-500/70 hover:text-red-500"
              >
                ✕
              </button>
            </div>
          ) : (
            <p
              className={`rounded-full border border-foreground/15 bg-background px-4 py-1.5 text-sm shadow-lg ${
                saveState === "saved" ? "text-green-600" : "text-foreground/70"
              }`}
            >
              {saveState === "finishing" && "Finishing…"}
              {saveState === "saving" && "Saving…"}
              {saveState === "saved" && "Saved ✓"}
            </p>
          )}
        </div>
      )}

      <EventLog log={log} />
    </div>
  );
}
