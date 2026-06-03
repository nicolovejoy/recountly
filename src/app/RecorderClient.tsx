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
import { appendSegment } from "./transcript";
import { connectRealtimeSession } from "./realtime";
import { recordingLight, type RecordingStatus } from "./recordingLight";

const OPENAI_CALLS_URL = "https://api.openai.com/v1/realtime/calls";

// Inlined at build time from next.config.ts (PST, "MM/DD/YYYY HH:MM").
const BUILD_TIME = process.env.NEXT_PUBLIC_BUILD_TIME;

type Status = RecordingStatus;

type LogLine = { id: number; type: string; text?: string };

export default function RecorderClient() {
  const [status, setStatus] = useState<Status>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [interim, setInterim] = useState("");
  const [log, setLog] = useState<LogLine[]>([]);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const logIdRef = useRef(0);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number | null>(null);
  const meterRef = useRef<HTMLDivElement | null>(null);
  const textRef = useRef<HTMLTextAreaElement | null>(null);
  // Cancellation token for the async start() sequence. stop() bumps it; each
  // await in start() checks it and bails if a newer start/stop has superseded
  // this attempt — so an Esc mid-connect can't run code against a torn-down pc.
  const genRef = useRef(0);

  const pushLog = useCallback((type: string, text?: string) => {
    logIdRef.current += 1;
    const id = logIdRef.current;
    setLog((prev) => [{ id, type, text }, ...prev].slice(0, 40));
  }, []);

  const cleanup = useCallback(() => {
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

  const handleEvent = useCallback((event: {
    type?: string;
    delta?: string;
    transcript?: string;
    error?: { message?: string; code?: string; type?: string };
  }) => {
    const errText = event.error?.message ?? event.error?.code;
    pushLog(event.type ?? "(no type)", event.delta ?? event.transcript ?? errText);
    switch (event.type) {
      case "conversation.item.input_audio_transcription.delta":
        if (typeof event.delta === "string") setInterim((prev) => prev + event.delta);
        break;
      case "conversation.item.input_audio_transcription.completed":
        if (typeof event.transcript === "string") {
          // Append the finalized segment to the editable textarea WITHOUT
          // disturbing the user's caret. We only ever append at the end, so an
          // earlier selection stays valid and is restored verbatim. If the caret
          // was already at the end (or the textarea is unfocused), follow along
          // and scroll to the bottom.
          const ta = textRef.current;
          if (ta) {
            const selStart = ta.selectionStart;
            const selEnd = ta.selectionEnd;
            const wasAtEnd =
              selStart === ta.value.length && selEnd === ta.value.length;
            ta.value = appendSegment(ta.value, event.transcript);
            if (wasAtEnd) {
              ta.selectionStart = ta.selectionEnd = ta.value.length;
              ta.scrollTop = ta.scrollHeight;
            } else {
              ta.selectionStart = selStart;
              ta.selectionEnd = selEnd;
            }
          }
          setInterim("");
        }
        break;
      // Surface the reason so a failed segment isn't a silent dead-end.
      case "conversation.item.input_audio_transcription.failed":
      case "error":
        if (errText) setErrorMsg(`transcription failed: ${errText}`);
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
    setStatus("connecting");
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
              setStatus("live"); // stoplight flips to red — on air
            });
            dc.addEventListener("message", (e) => {
              try {
                handleEvent(JSON.parse(e.data));
              } catch {
                pushLog("(unparseable)", String(e.data).slice(0, 80));
              }
            });
          },
        },
      );
      if (result === "cancelled") return;
    } catch (err) {
      if (genRef.current !== myGen) return; // a cancelled attempt's throw isn't a real error
      setErrorMsg(err instanceof Error ? err.message : String(err));
      setStatus("error");
      cleanup();
    }
  }, [cleanup, handleEvent, pushLog, startMeter]);

  const stop = useCallback(() => {
    genRef.current += 1; // invalidate any in-flight start() so it stops touching the pc
    setStatus("stopping");
    cleanup();
    setInterim("");
    setStatus("idle");
  }, [cleanup]);

  const live = status === "live" || status === "connecting";
  const light = recordingLight(status);

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

      {/* The traffic light IS the control — tap to record/stop. Lamps run
          green → orange → red (red on the right): green = ready, orange =
          connecting, red (pulsing) = live/on-air. */}
      <button
        onClick={live ? stop : start}
        aria-label={live ? "Stop recording" : "Start recording"}
        className="mx-auto flex cursor-pointer items-center gap-4 rounded-full border border-foreground/15 bg-foreground/[0.04] px-7 py-4 transition-colors hover:bg-foreground/[0.08]"
      >
        <span className="flex items-center gap-3" aria-hidden>
          <span
            className={`h-7 w-7 rounded-full bg-green-500 transition-opacity ${light.lamp === "green" ? "opacity-100 shadow-lg shadow-green-500/50" : "opacity-20"}`}
          />
          <span
            className={`h-7 w-7 rounded-full bg-orange-500 transition-opacity ${light.lamp === "orange" ? "opacity-100 shadow-lg shadow-orange-500/50" : "opacity-20"}`}
          />
          <span
            className={`h-7 w-7 rounded-full bg-red-500 transition-opacity ${light.lamp === "red" ? "opacity-100 animate-pulse shadow-lg shadow-red-500/60" : "opacity-20"}`}
          />
        </span>
        <span
          className="min-w-24 whitespace-nowrap text-left text-lg font-medium text-foreground/70"
          aria-live="polite"
        >
          {light.label}
        </span>
      </button>

      {live && (
        <div className="mx-auto h-1 w-24 overflow-hidden rounded-full bg-foreground/10" aria-hidden>
          <div
            ref={meterRef}
            className="h-full w-full origin-left rounded-full bg-green-500 transition-transform duration-75 ease-out"
            style={{ transform: "scaleX(0)" }}
          />
        </div>
      )}

      {live && (
        <p className="text-center text-xs text-foreground/40">
          press <kbd className="font-mono">Esc</kbd> to stop
        </p>
      )}

      {errorMsg && (
        <p className="rounded-lg border border-red-500/30 bg-red-500/5 px-4 py-3 text-sm text-red-500">
          {errorMsg}
        </p>
      )}

      <div className="flex flex-1 flex-col gap-1">
        <textarea
          ref={textRef}
          placeholder="Type or talk — your words appear here…"
          aria-label="Transcript"
          className="min-h-48 w-full flex-1 resize-none rounded-xl border border-foreground/10 bg-transparent p-4 text-lg leading-relaxed outline-none placeholder:text-foreground/30 focus:border-foreground/30"
        />
        {interim && (
          <p className="px-4 text-lg leading-relaxed text-foreground/40">{interim}</p>
        )}
      </div>

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
