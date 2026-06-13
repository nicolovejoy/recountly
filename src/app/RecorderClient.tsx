"use client";

// Composition root for the recorder page. All imperative session logic lives
// in useRecorder (WebRTC, timer, meter, cancellation); the transcript caret
// logic lives in TranscriptEditor; this component wires them together and
// keeps page-level UI policy (the Esc shortcut, header chrome).

import { useEffect, useRef } from "react";
import { primaryAction } from "@/lib/recorder-state";
import { useRecorder } from "./useRecorder";
import TranscriptEditor, { type TranscriptEditorHandle } from "./TranscriptEditor";
import RecordButton from "./RecordButton";
import RecStatusLine from "./RecStatusLine";
import EventLog from "./EventLog";

// Inlined at build time from next.config.ts (PST, "MM/DD/YYYY HH:MM").
const BUILD_TIME = process.env.NEXT_PUBLIC_BUILD_TIME;

export default function RecorderClient() {
  const editorRef = useRef<TranscriptEditorHandle | null>(null);
  const { status, elapsedSec, interim, errorMsg, log, start, pause, resume, stop, meterRef } =
    useRecorder({
      onSegment: (segment) => editorRef.current?.append(segment),
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
            onClick={stop}
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

      {errorMsg && (
        <p className="rounded-lg border border-red-500/30 bg-red-500/5 px-4 py-3 text-sm text-red-500">
          {errorMsg}
        </p>
      )}

      <TranscriptEditor ref={editorRef} interim={interim} />

      <EventLog log={log} />
    </main>
  );
}
