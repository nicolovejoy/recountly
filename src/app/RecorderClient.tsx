"use client";

// Phase 1, spike #2 — minimal live-transcription client.
//
// Flow: GET /api/realtime-token -> open RTCPeerConnection -> add mic track ->
// open "oai-events" data channel -> POST SDP offer to /v1/realtime/calls ->
// apply answer -> render transcript deltas as they stream back.
//
// SPIKE: the inline event handling and the raw event log are throwaway. The
// transcript-merge logic now lives in ./transcript (appendSegment, unit-tested).
// The transcript itself is an uncontrolled <textarea> so the user can type/edit
// while spoken segments append to the end without disturbing the caret.

import { useCallback, useEffect, useRef, useState } from "react";
import { connectRealtimeSession } from "@/lib/realtime";
import { formatElapsed, totalElapsedSec } from "@/lib/elapsed";
import { parseRealtimeEvent, type RealtimeEvent } from "@/lib/realtime-events";
import { transition, type RecorderStatus } from "@/lib/recorder-state";
import TranscriptEditor, { type TranscriptEditorHandle } from "./TranscriptEditor";

const OPENAI_CALLS_URL = "https://api.openai.com/v1/realtime/calls";

// Inlined at build time from next.config.ts (PST, "MM/DD/YYYY HH:MM").
const BUILD_TIME = process.env.NEXT_PUBLIC_BUILD_TIME;

type LogLine = { id: number; type: string; text?: string };

export default function RecorderClient() {
  const [status, setStatus] = useState<RecorderStatus>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [interim, setInterim] = useState("");
  const [log, setLog] = useState<LogLine[]>([]);
  const [elapsedSec, setElapsedSec] = useState(0);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const logIdRef = useRef(0);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number | null>(null);
  const meterRef = useRef<HTMLSpanElement | null>(null);
  const editorRef = useRef<TranscriptEditorHandle | null>(null);
  // Cancellation token for the async start() sequence. stop() bumps it; each
  // await in start() checks it and bails if a newer start/stop has superseded
  // this attempt — so an Esc mid-connect can't run code against a torn-down pc.
  const genRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Cumulative recording time (see totalElapsedSec): accumulatedMsRef banks
  // finished segments (always 0 until pause/resume lands); segmentStartRef is
  // the running segment's start, or null when not live.
  const accumulatedMsRef = useRef(0);
  const segmentStartRef = useRef<number | null>(null);

  const pushLog = useCallback((type: string, text?: string) => {
    logIdRef.current += 1;
    const id = logIdRef.current;
    setLog((prev) => [{ id, type, text }, ...prev].slice(0, 40));
  }, []);

  const cleanup = useCallback(() => {
    if (timerRef.current != null) clearInterval(timerRef.current);
    timerRef.current = null;
    accumulatedMsRef.current = 0;
    segmentStartRef.current = null;
    setElapsedSec(0);
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    audioCtxRef.current?.close();
    audioCtxRef.current = null;
    pcRef.current?.getSenders().forEach((s) => s.track?.stop());
    pcRef.current?.close();
    pcRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  const handleEvent = useCallback((event: RealtimeEvent) => {
    switch (event.type) {
      case "conversation.item.input_audio_transcription.delta":
        pushLog(event.type, event.delta);
        setInterim((prev) => prev + event.delta);
        break;
      case "conversation.item.input_audio_transcription.completed":
        pushLog(event.type, event.transcript);
        editorRef.current?.append(event.transcript);
        setInterim("");
        break;
      // Surface the reason so a failed segment isn't a silent dead-end.
      case "conversation.item.input_audio_transcription.failed":
      case "error": {
        const errText = event.error?.message ?? event.error?.code;
        pushLog(event.type, errText);
        if (errText) setErrorMsg(`transcription failed: ${errText}`);
        break;
      }
      case "unknown":
        pushLog(event.rawType, event.text);
        break;
    }
  }, [pushLog]);

  // Live mic-level meter — visual proof the mic is actually capturing audio.
  // Drives the bar via a ref (no re-render per frame).
  const startMeter = useCallback((stream: MediaStream) => {
    const audioCtx = new AudioContext();
    audioCtxRef.current = audioCtx;
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 256;
    audioCtx.createMediaStreamSource(stream).connect(analyser);
    const samples = new Uint8Array(analyser.frequencyBinCount);
    const tick = () => {
      analyser.getByteTimeDomainData(samples);
      let sum = 0;
      for (let i = 0; i < samples.length; i++) {
        const v = (samples[i] - 128) / 128;
        sum += v * v;
      }
      const level = Math.min(1, Math.sqrt(sum / samples.length) * 3);
      if (meterRef.current) meterRef.current.style.transform = `scaleX(${level})`;
      rafRef.current = requestAnimationFrame(tick);
    };
    tick();
  }, []);

  const start = useCallback(async () => {
    // Capture this attempt's generation. If stop() (or a newer start) bumps
    // genRef while we're awaiting, connectRealtimeSession sees isStale() and bails.
    const myGen = ++genRef.current;
    setErrorMsg(null);
    // NOTE: intentionally do NOT clear the textarea here — the user may have
    // pre-typed hard-to-transcribe words before tapping Record, and may record
    // multiple times into one entry. They clear it by editing the textarea.
    setInterim("");
    setLog([]);
    setStatus((s) => transition(s, "START"));
    try {
      const result = await connectRealtimeSession(
        {
          fetchToken: async () => {
            const res = await fetch("/api/realtime-token");
            if (!res.ok) throw new Error(`token route ${res.status}`);
            return ((await res.json()) as { token: string }).token;
          },
          createPeerConnection: () => new RTCPeerConnection(),
          getUserMedia: () => navigator.mediaDevices.getUserMedia({ audio: true }),
          postOffer: async (sdp, token) => {
            const res = await fetch(OPENAI_CALLS_URL, {
              method: "POST",
              body: sdp,
              headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/sdp" },
            });
            return { ok: res.ok, status: res.status, sdp: await res.text() };
          },
        },
        {
          isStale: () => genRef.current !== myGen,
          onPeerConnection: (pc) => {
            pcRef.current = pc;
            pc.addEventListener("connectionstatechange", () => pushLog(`pc:${pc.connectionState}`));
          },
          onStream: (stream) => {
            streamRef.current = stream;
            startMeter(stream);
          },
          onDataChannel: (dc) => {
            dc.addEventListener("open", () => {
              if (genRef.current !== myGen) return; // cancelled before the channel opened
              setStatus((s) => transition(s, "CONNECTED")); // button goes red — on air
              segmentStartRef.current = Date.now();
              timerRef.current = setInterval(() => {
                setElapsedSec(
                  totalElapsedSec(accumulatedMsRef.current, segmentStartRef.current, Date.now()),
                );
              }, 250);
            });
            dc.addEventListener("message", (e) => {
              handleEvent(parseRealtimeEvent(String(e.data)));
            });
          },
        },
      );
      if (result === "cancelled") return;
    } catch (err) {
      if (genRef.current !== myGen) return; // a cancelled attempt's throw isn't a real error
      setErrorMsg(err instanceof Error ? err.message : String(err));
      setStatus((s) => transition(s, "FAIL"));
      cleanup();
    }
  }, [cleanup, handleEvent, pushLog, startMeter]);

  const stop = useCallback(() => {
    genRef.current += 1; // invalidate any in-flight start() so it stops touching the pc
    setStatus((s) => transition(s, "DONE"));
    cleanup();
    setInterim("");
  }, [cleanup]);

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

      {/* One circular Record/Stop button — the universal recorder affordance.
          Idle/error: red dot = tap to record. Live: red, pulsing ring, stop
          square = tap to stop, with REC timer + live mic-level bar. */}
      <div className="flex flex-col items-center gap-3">
        <button
          onClick={live ? stop : start}
          aria-label={live ? "Stop recording" : "Start recording"}
          className={`relative flex h-20 w-20 cursor-pointer items-center justify-center rounded-full border-2 transition-colors ${
            status === "live"
              ? "border-red-600 bg-red-600"
              : status === "connecting"
                ? "animate-pulse border-foreground/30 bg-foreground/[0.04]"
                : "border-foreground/20 bg-foreground/[0.04] hover:bg-foreground/[0.08]"
          }`}
        >
          {status === "live" && (
            <span className="absolute inset-0 animate-ping rounded-full bg-red-600/40" aria-hidden />
          )}
          {status === "live" ? (
            <span className="relative h-6 w-6 rounded-sm bg-white" aria-hidden />
          ) : (
            <span className="relative h-7 w-7 rounded-full bg-red-600" aria-hidden />
          )}
        </button>

        <div className="flex h-5 items-center gap-3 text-sm">
          {status === "live" ? (
            <>
              <span className="font-medium text-red-500">● REC</span>
              <span className="tabular-nums text-foreground/70">{formatElapsed(elapsedSec)}</span>
              <span className="h-1 w-20 overflow-hidden rounded-full bg-foreground/10" aria-hidden>
                <span
                  ref={meterRef}
                  className="block h-full w-full origin-left rounded-full bg-green-500 transition-transform duration-75 ease-out"
                  style={{ transform: "scaleX(0)" }}
                />
              </span>
            </>
          ) : status === "connecting" ? (
            <span className="text-foreground/50">Connecting…</span>
          ) : (
            <span className="text-foreground/40">Tap to record</span>
          )}
        </div>

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

      <details className="text-xs text-foreground/50">
        <summary className="cursor-pointer select-none">raw event log (spike)</summary>
        <ul className="mt-2 space-y-1 font-mono">
          {log.map((l) => (
            <li key={l.id} className="truncate">
              <span className="text-foreground/70">{l.type}</span>
              {l.text ? <span className="text-foreground/40"> — {l.text}</span> : null}
            </li>
          ))}
        </ul>
      </details>
    </main>
  );
}
