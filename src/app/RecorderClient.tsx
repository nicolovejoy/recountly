"use client";

// Composition root for the recorder page. All imperative session logic lives
// in useRecorder (WebRTC, timer, meter, cancellation); the transcript caret
// logic lives in TranscriptEditor; this component wires them together and
// keeps page-level UI policy (the Esc shortcut, header chrome).

import { useCallback, useEffect, useRef, useState } from "react";
import { primaryAction } from "@/lib/recorder-state";
import { buildEntryFormData } from "@/lib/entry-form";
import { downscalePhoto } from "@/lib/image";
import { writtenAtIso } from "@/lib/written-at";
import { SAVE_BYTES_BUDGET } from "@/lib/payload-size";
import { planSave } from "@/lib/save-plan";
import { useRecorder, type RecordingResult } from "./useRecorder";
import { useJournals } from "./useJournals";
import TranscriptEditor, { type TranscriptEditorHandle } from "./TranscriptEditor";
import RecordButton from "./RecordButton";
import RecStatusLine from "./RecStatusLine";
import EventLog from "./EventLog";
import EntryList from "./EntryList";
import JournalBar from "./JournalBar";
import PhotoTray from "./PhotoTray";

type SaveState = "idle" | "finishing" | "saving" | "saved" | "error";

// Inlined at build time from next.config.ts (PST, "MM/DD/YYYY HH:MM").
const BUILD_TIME = process.env.NEXT_PUBLIC_BUILD_TIME;

export default function RecorderClient() {
  const editorRef = useRef<TranscriptEditorHandle | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
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

  // Done's save trigger: read the transcript the editor holds, attach the
  // best-effort audio plus the journal context and verified page photos, POST
  // it, then refresh the list. An empty transcript is a no-op. Audio failing
  // is fine; photos are NOT best-effort — the route fails the save if one
  // can't be stored, and we keep the tray so the user retries.
  const onStop = useCallback(
    (result: RecordingResult) => {
      const transcript = editorRef.current?.getValue().trim() ?? "";
      const plan = planSave(
        transcript,
        result.audioBlob?.size ?? 0,
        pendingPhotos.map((p) => p.blob.size),
        SAVE_BYTES_BUDGET,
      );
      if (plan.kind === "empty") {
        setSaveError(
          "Nothing to save — the transcript was empty when the session ended. Any attached photos are still here; record or dictate again and they'll be included.",
        );
        setSaveState("error");
        return;
      }
      if (plan.kind === "too-large") {
        setSaveError(
          "Save is too large for one upload — remove a photo, then tap Record and Done to save again (the transcript and photos are kept).",
        );
        setSaveState("error");
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

  const { status, elapsedSec, interim, errorMsg, log, start, pause, resume, stop, meterRef } =
    useRecorder({
      onSegment: (segment) => editorRef.current?.append(segment),
      onStop,
    });

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
    <main className="mx-auto flex min-h-full w-full max-w-2xl flex-1 flex-col gap-6 px-5 py-8">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">recountly</h1>
        <div className="flex items-center gap-3">
          {BUILD_TIME && (
            <span className="text-[10px] text-foreground/40 tabular-nums">{BUILD_TIME} PST</span>
          )}
          <span className="rounded-full border border-foreground/10 px-3 py-1 text-xs text-foreground/50">
            {status}
          </span>
        </div>
      </header>

      <div className="flex flex-col items-center gap-3">
        <RecordButton status={status} onPress={onPressPrimary} />
        <RecStatusLine status={status} elapsedSec={elapsedSec} meterRef={meterRef} />
        {inSession && (
          <button
            onClick={() => {
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

      <EntryList reloadKey={reloadKey} journals={journals} />

      <EventLog log={log} />
    </main>
  );
}
