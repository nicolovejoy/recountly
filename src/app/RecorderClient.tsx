"use client";

// Composition root for the recorder page. All imperative session logic lives
// in useRecorder (WebRTC, timer, meter, cancellation); the transcript caret
// logic lives in TranscriptEditor; this component wires them together and
// keeps page-level UI policy (the Esc shortcut, header chrome).

import { useEffect, useRef } from "react";
import { useRecorder } from "./useRecorder";
import TranscriptEditor, { type TranscriptEditorHandle } from "./TranscriptEditor";
import RecordButton from "./RecordButton";
import RecStatusLine from "./RecStatusLine";
import EventLog from "./EventLog";

// Inlined at build time from next.config.ts (PST, "MM/DD/YYYY HH:MM").
const BUILD_TIME = process.env.NEXT_PUBLIC_BUILD_TIME;

export default function RecorderClient() {
  const editorRef = useRef<TranscriptEditorHandle | null>(null);
  const { status, elapsedSec, interim, errorMsg, log, start, stop, meterRef } =
    useRecorder({
      onSegment: (segment) => editorRef.current?.append(segment),
    });

  const live = status === "live" || status === "connecting";

  // Esc ends (or cancels) recording from anywhere on the page — including while
  // typing in the transcript. Listen on the document so a focused textarea can't
  // swallow the key. Only bound while live, so Esc is free for normal use when idle.
  useEffect(() => {
    if (!live) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        stop();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [live, stop]);

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
        <RecordButton status={status} onPress={live ? stop : start} />
        <RecStatusLine status={status} elapsedSec={elapsedSec} meterRef={meterRef} />
        {live && (
          <p className="text-xs text-foreground/40">
            press <kbd className="font-mono">Esc</kbd> to stop
          </p>
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
