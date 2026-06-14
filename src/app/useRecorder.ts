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
import { pickAudioMimeType } from "@/lib/audio";
import fixWebmDuration from "fix-webm-duration";

const OPENAI_CALLS_URL = "https://api.openai.com/v1/realtime/calls";

// On pause we stop the mic immediately (privacy) but hold the peer connection
// open this long so the in-flight segment's `completed` event can still land
// before we tear down. Resume cancels a pending flush if it fires first.
const FLUSH_MS = 1500;

export type LogLine = { id: number; type: string; text?: string };

// Handed to onStop when a recording finishes (Done). Audio is best-effort — a
// single continuous segment (the last one if the entry was paused/resumed), or
// null if the browser couldn't record / nothing was captured.
export interface RecordingResult {
  durationSeconds: number;
  audioBlob: Blob | null;
  audioMime: string | null;
}

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
  /** Called once on Done with the duration + best-effort audio (caller saves). */
  onStop?: (result: RecordingResult) => void;
}): Recorder {
  const [status, setStatus] = useState<RecorderStatus>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [interim, setInterim] = useState("");
  const [log, setLog] = useState<LogLine[]>([]);
  const [elapsedSec, setElapsedSec] = useState(0);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  // The "oai-events" data channel — kept so pause/stop can send a manual
  // input_audio_buffer.commit to force the tail segment to finalize.
  const dcRef = useRef<RTCDataChannel | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  // Best-effort audio capture. A fresh MediaRecorder is started on every mic
  // stream (start AND resume), resetting the chunk buffer — so a paused-then-
  // resumed entry keeps only the last continuous segment (the agreed v1 rule:
  // transcript always complete, audio best-effort). null when unsupported.
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const audioMimeRef = useRef<string>("");
  // When the current recorder started — used to write the real duration into the
  // WebM (MediaRecorder omits it, which breaks Chrome's seek/playback).
  const recorderStartRef = useRef<number | null>(null);
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
  const onStopRef = useRef(opts.onStop);
  useEffect(() => {
    onSegmentRef.current = opts.onSegment;
    onStopRef.current = opts.onStop;
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
    dcRef.current = null; // closed implicitly with the pc above
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    // Free any lingering recorder. The Done path finalizes it first (state
    // already inactive here); start() uses this to discard a prior one.
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      try {
        mediaRecorderRef.current.stop();
      } catch {
        /* already stopping/inactive */
      }
    }
    mediaRecorderRef.current = null;
  }, []);

  // Force the server to finalize whatever audio is still buffered (not yet
  // VAD-committed) so its transcript lands before we tear the connection down.
  // Safe to call when the buffer is empty — that returns a benign
  // empty-buffer error which handleEvent suppresses.
  const commitBuffer = useCallback(() => {
    const dc = dcRef.current;
    if (dc?.readyState === "open") {
      dc.send(JSON.stringify({ type: "input_audio_buffer.commit" }));
    }
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
        // A manual commit with nothing newly buffered (e.g. Done/pause right
        // after a VAD auto-commit) returns a benign empty-buffer error — log it
        // but don't alarm the user with a failure banner.
        const code = event.error?.code ?? "";
        const benignEmptyCommit = code.includes("buffer") && code.includes("empty");
        if (errText && !benignEmptyCommit) setErrorMsg(`transcription failed: ${errText}`);
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

  // Start a fresh MediaRecorder on a mic stream (called per connect, so resume
  // discards the prior segment — best-effort "last continuous segment" audio).
  // Timeslice keeps chunks flowing so a pause that ends the track still leaves
  // most of the segment buffered without an explicit stop. No-op (audio stays
  // null) when the platform lacks MediaRecorder or a supported container.
  const startRecorder = useCallback((stream: MediaStream) => {
    if (typeof MediaRecorder === "undefined") {
      mediaRecorderRef.current = null;
      return;
    }
    const mime = pickAudioMimeType((t) => MediaRecorder.isTypeSupported(t));
    audioChunksRef.current = [];
    audioMimeRef.current = mime;
    recorderStartRef.current = null;
    try {
      const rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };
      rec.start(1000);
      mediaRecorderRef.current = rec;
      recorderStartRef.current = Date.now();
    } catch (err) {
      pushLog("recorder:error", err instanceof Error ? err.message : String(err));
      mediaRecorderRef.current = null;
    }
  }, [pushLog]);

  // Flush and assemble the captured audio into one Blob. Resolves null when no
  // audio was recorded. Stopping the recorder (if still active) forces the tail
  // chunk out before we read the buffer.
  const finalizeRecording = useCallback((): Promise<{ blob: Blob; mime: string } | null> => {
    const rec = mediaRecorderRef.current;
    const mime = audioMimeRef.current || "audio/webm";
    const startedAt = recorderStartRef.current;
    const assemble = async (): Promise<{ blob: Blob; mime: string } | null> => {
      const chunks = audioChunksRef.current;
      if (chunks.length === 0) return null;
      let blob = new Blob(chunks, { type: mime });
      if (blob.size === 0) return null;
      // MediaRecorder writes no duration into the WebM header, so Chrome can't
      // seek and mis-plays. Write the real recorded length in before upload
      // (WebM only; mp4/Safari already carries duration). Keep the raw blob if
      // the patch fails — the audio data is intact regardless.
      if (startedAt != null && mime.includes("webm")) {
        try {
          blob = await fixWebmDuration(blob, Date.now() - startedAt);
        } catch {
          /* keep the unpatched blob */
        }
      }
      return { blob, mime };
    };
    if (!rec || rec.state === "inactive") return assemble();
    return new Promise((resolve) => {
      rec.addEventListener("stop", () => resolve(assemble()), { once: true });
      rec.stop();
    });
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
            startRecorder(stream);
          },
          onDataChannel: (dc) => {
            dcRef.current = dc;
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
  }, [cleanup, handleEvent, pushLog, startMeter, startRecorder]);

  const start = useCallback(() => {
    // Close any connection still lingering inside a Done/pause flush window (and
    // cancel its pending teardown timer) so we never start a fresh session on
    // top of an old pc. Idempotent when nothing is open.
    closeConnection();
    // Fresh recording: clear the event log and zero the timer. The transcript
    // editor is intentionally NOT cleared — the user may have pre-typed
    // hard-to-transcribe words, and may record multiple times into one entry.
    setLog([]);
    resetTimer();
    void connect("START");
  }, [closeConnection, connect, resetTimer]);

  const pause = useCallback(() => {
    genRef.current += 1; // stop any in-flight connect from touching the pc
    commitBuffer(); // finalize the in-flight segment before the flush-then-close
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
  }, [closeConnection, commitBuffer]);

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
    // Force-finalize the buffered tail, then hold the connection open briefly so
    // its completed transcript (and any segments still being transcribed) can
    // land before teardown — the same flush rationale as pause. Closing
    // immediately, as this used to, dropped everything said since the last VAD
    // commit.
    commitBuffer();
    setStatus((s) => transition(s, "DONE"));
    setInterim("");
    // Snapshot the final duration before resetTimer zeroes it.
    const durationSeconds = totalElapsedSec(
      accumulatedMsRef.current,
      segmentStartRef.current,
      Date.now(),
    );
    // Kick off audio finalization now — finalizeRecording calls recorder.stop()
    // synchronously here, before the mic tracks are cut below, so the tail chunk
    // flushes cleanly. We deliberately do NOT save yet: the last spoken segment's
    // transcript only lands during the FLUSH_MS window, and the caller's onStop
    // reads the editor — so the save must wait until that window closes (below).
    const audioPromise = finalizeRecording();
    // Freeze timer + meter and cut the mic now; defer the connection teardown.
    if (timerRef.current != null) clearInterval(timerRef.current);
    timerRef.current = null;
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    resetTimer();
    if (flushTimerRef.current != null) clearTimeout(flushTimerRef.current);
    flushTimerRef.current = setTimeout(() => {
      flushTimerRef.current = null;
      closeConnection();
      // The transcript tail has landed by now — hand the complete result over.
      void audioPromise.then((audio) => {
        onStopRef.current?.({
          durationSeconds,
          audioBlob: audio?.blob ?? null,
          audioMime: audio?.mime ?? null,
        });
      });
    }, FLUSH_MS);
  }, [commitBuffer, closeConnection, resetTimer, finalizeRecording]);

  return { status, elapsedSec, interim, errorMsg, log, start, pause, resume, stop, meterRef };
}
