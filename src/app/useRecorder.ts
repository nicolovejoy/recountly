"use client";

// useRecorder owns the entire imperative recording session: the WebRTC peer
// connection (via the node-tested connectRealtimeSession orchestration), the
// mic stream + level meter, the REC timer, the gen-counter cancellation token,
// and realtime-event dispatch. Status changes go through the pure, tested
// state machine (transition); finalized transcript segments are delivered to
// the caller via onSegment. The component that consumes this hook is purely
// presentational.
//
// Flow: GET /api/realtime-token -> open RTCPeerConnection -> add mic track ->
// open "oai-events" data channel -> POST SDP offer to /v1/realtime/calls ->
// apply answer -> dispatch transcript events as they stream back.

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { connectRealtimeSession } from "@/lib/realtime";
import { totalElapsedSec, bankSegment } from "@/lib/elapsed";
import { parseRealtimeEvent, type RealtimeEvent } from "@/lib/realtime-events";
import { transition, type RecorderStatus, type RecorderEvent } from "@/lib/recorder-state";

const OPENAI_CALLS_URL = "https://api.openai.com/v1/realtime/calls";

// On pause we stop the mic immediately (privacy) but hold the peer connection
// open this long so the in-flight segment's `completed` event can still land
// before we tear down. Resume cancels a pending flush if it fires first.
const FLUSH_MS = 1500;

export type LogLine = { id: number; type: string; text?: string };

export interface Recorder {
  status: RecorderStatus;
  elapsedSec: number;
  /** Interim (not yet finalized) transcription text for the current segment. */
  interim: string;
  errorMsg: string | null;
  /** Raw event log, newest first (debugging window — see EventLog). */
  log: LogLine[];
  /** Begin a fresh recording (clears the timer + event log, keeps editor text). */
  start: () => void;
  /** Suspend: bank elapsed, mic off now, flush the in-flight segment, then close. */
  pause: () => void;
  /** Reconnect a paused session; the timer continues from the banked time. */
  resume: () => void;
  /** Finish: return to idle, keep the transcript text. */
  stop: () => void;
  /** Attach to the mic-level bar span; driven per-frame without re-renders. */
  meterRef: RefObject<HTMLSpanElement | null>;
}

export function useRecorder(opts: {
  /** Called with each finalized spoken segment (caller appends it to the editor). */
  onSegment: (segment: string) => void;
}): Recorder {
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
  // Cancellation token for the async start() sequence. stop() bumps it; each
  // await in start() checks it and bails if a newer start/stop has superseded
  // this attempt — so an Esc mid-connect can't run code against a torn-down pc.
  const genRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Pending pause-flush teardown; cleared if resume/stop happens first.
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Cumulative recording time (see totalElapsedSec): accumulatedMsRef banks
  // finished segments (always 0 until pause/resume lands); segmentStartRef is
  // the running segment's start, or null when not live.
  const accumulatedMsRef = useRef(0);
  const segmentStartRef = useRef<number | null>(null);

  // Latest-ref for the segment callback: the data-channel "message" listener
  // is bound once per connection, so going through this ref keeps it pointed
  // at the current render's closure instead of a stale one. Updated in an
  // effect (not during render) per the react-hooks/refs rule; the listener
  // only fires from events, so effect timing is sufficient.
  const onSegmentRef = useRef(opts.onSegment);
  useEffect(() => {
    onSegmentRef.current = opts.onSegment;
  });

  const pushLog = useCallback((type: string, text?: string) => {
    logIdRef.current += 1;
    const id = logIdRef.current;
    setLog((prev) => [{ id, type, text }, ...prev].slice(0, 40));
  }, []);

  // Teardown is split so the forthcoming pause can close the connection while
  // KEEPING the banked time (pause = closeConnection + bank elapsed; full stop
  // = both halves).
  const closeConnection = useCallback(() => {
    if (flushTimerRef.current != null) clearTimeout(flushTimerRef.current);
    flushTimerRef.current = null;
    if (timerRef.current != null) clearInterval(timerRef.current);
    timerRef.current = null;
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

  const resetTimer = useCallback(() => {
    accumulatedMsRef.current = 0;
    segmentStartRef.current = null;
    setElapsedSec(0);
  }, []);

  const cleanup = useCallback(() => {
    closeConnection();
    resetTimer();
  }, [closeConnection, resetTimer]);

  const handleEvent = useCallback((event: RealtimeEvent) => {
    switch (event.type) {
      case "conversation.item.input_audio_transcription.delta":
        pushLog(event.type, event.delta);
        setInterim((prev) => prev + event.delta);
        break;
      case "conversation.item.input_audio_transcription.completed":
        pushLog(event.type, event.transcript);
        onSegmentRef.current(event.transcript);
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
  // Drives the bar via meterRef (no re-render per frame); the null-guard also
  // covers the span not being mounted yet while still "connecting".
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

  // The shared connection sequence, used by both start (trigger START) and
  // resume (trigger RESUME). It does NOT reset the timer or log — start/resume
  // each decide what to preserve before calling in. On a successful connect the
  // running segment's start is stamped and the interval resumes counting from
  // whatever is already banked in accumulatedMsRef (0 for start, prior elapsed
  // for resume).
  const connect = useCallback(async (trigger: RecorderEvent) => {
    // Capture this attempt's generation. If stop()/pause() (or a newer connect)
    // bumps genRef while we're awaiting, connectRealtimeSession sees isStale()
    // and bails — so an Esc mid-connect can't run code against a torn-down pc.
    const myGen = ++genRef.current;
    setErrorMsg(null);
    setInterim("");
    setStatus((s) => transition(s, trigger));
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

  const start = useCallback(() => {
    // Fresh recording: clear the event log and zero the timer. The transcript
    // editor is intentionally NOT cleared — the user may have pre-typed
    // hard-to-transcribe words, and may record multiple times into one entry.
    setLog([]);
    resetTimer();
    void connect("START");
  }, [connect, resetTimer]);

  const pause = useCallback(() => {
    genRef.current += 1; // stop any in-flight connect from touching the pc
    // Bank the running segment so the frozen timer reads correctly and resume
    // continues from here.
    accumulatedMsRef.current = bankSegment(
      accumulatedMsRef.current,
      segmentStartRef.current,
      Date.now(),
    );
    segmentStartRef.current = null;
    setStatus((s) => transition(s, "PAUSE"));
    setInterim("");
    setElapsedSec(totalElapsedSec(accumulatedMsRef.current, null, Date.now()));
    // Freeze the timer + meter immediately, and cut the mic NOW for privacy.
    if (timerRef.current != null) clearInterval(timerRef.current);
    timerRef.current = null;
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    // Keep the pc open briefly so the in-flight segment's completed event can
    // still land via the message listener, then fully tear the connection down.
    flushTimerRef.current = setTimeout(() => {
      flushTimerRef.current = null;
      closeConnection();
    }, FLUSH_MS);
  }, [closeConnection]);

  const resume = useCallback(() => {
    // Tear down any lingering connection first: if resume fires DURING the flush
    // window the old pc is still open, so closeConnection (which also cancels the
    // pending flush) prevents leaking it. It leaves the banked time and log
    // intact — only resetTimer would zero those — so the reconnect continues
    // the same entry.
    closeConnection();
    void connect("RESUME");
  }, [closeConnection, connect]);

  const stop = useCallback(() => {
    genRef.current += 1; // invalidate any in-flight connect so it stops touching the pc
    setStatus((s) => transition(s, "DONE"));
    cleanup();
    setInterim("");
  }, [cleanup]);

  return { status, elapsedSec, interim, errorMsg, log, start, pause, resume, stop, meterRef };
}
