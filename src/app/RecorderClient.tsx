"use client";

// Phase 1, spike #2 — minimal live-transcription client.
//
// Flow: GET /api/realtime-token -> open RTCPeerConnection -> add mic track ->
// open "oai-events" data channel -> POST SDP offer to /v1/realtime/calls ->
// apply answer -> render transcript deltas as they stream back.
//
// SPIKE: the inline event handling and the raw event log are throwaway. Once we
// confirm the real event names/shapes by speaking into this, the transcript logic
// gets extracted into a tested pure reducer (Phase 1, step 3).

import { useCallback, useRef, useState } from "react";

const OPENAI_CALLS_URL = "https://api.openai.com/v1/realtime/calls";

type Status = "idle" | "connecting" | "live" | "stopping" | "error";

type LogLine = { id: number; type: string; text?: string };

export default function RecorderClient() {
  const [status, setStatus] = useState<Status>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [committed, setCommitted] = useState("");
  const [interim, setInterim] = useState("");
  const [log, setLog] = useState<LogLine[]>([]);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const logIdRef = useRef(0);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number | null>(null);
  const meterRef = useRef<HTMLDivElement | null>(null);

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
          setCommitted((prev) => (prev ? prev + " " : "") + event.transcript!.trim());
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

  const start = useCallback(async () => {
    setErrorMsg(null);
    setCommitted("");
    setInterim("");
    setLog([]);
    setStatus("connecting");
    try {
      const tokenRes = await fetch("/api/realtime-token");
      if (!tokenRes.ok) throw new Error(`token route ${tokenRes.status}`);
      const { token } = (await tokenRes.json()) as { token: string };

      const pc = new RTCPeerConnection();
      pcRef.current = pc;
      pc.addEventListener("connectionstatechange", () => pushLog(`pc:${pc.connectionState}`));

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      stream.getTracks().forEach((track) => pc.addTrack(track, stream));

      // Live mic-level meter — visual proof the mic is actually capturing audio.
      // Drives the bar via a ref (no re-render per frame).
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

      const dc = pc.createDataChannel("oai-events");
      dc.addEventListener("open", () => setStatus("live"));
      dc.addEventListener("message", (e) => {
        try {
          handleEvent(JSON.parse(e.data));
        } catch {
          pushLog("(unparseable)", String(e.data).slice(0, 80));
        }
      });

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      const sdpRes = await fetch(OPENAI_CALLS_URL, {
        method: "POST",
        body: offer.sdp,
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/sdp" },
      });
      if (!sdpRes.ok) throw new Error(`calls ${sdpRes.status}: ${(await sdpRes.text()).slice(0, 120)}`);

      await pc.setRemoteDescription({ type: "answer", sdp: await sdpRes.text() });
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
      setStatus("error");
      cleanup();
    }
  }, [cleanup, handleEvent, pushLog]);

  const stop = useCallback(() => {
    setStatus("stopping");
    cleanup();
    setInterim("");
    setStatus("idle");
  }, [cleanup]);

  const live = status === "live" || status === "connecting";

  return (
    <main className="mx-auto flex min-h-full w-full max-w-2xl flex-1 flex-col gap-6 px-5 py-8">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">recountly</h1>
        <span className="rounded-full border border-foreground/10 px-3 py-1 text-xs text-foreground/50">
          {status}
        </span>
      </header>

      <button
        onClick={live ? stop : start}
        className={`flex h-14 items-center justify-center gap-2 rounded-full px-6 text-base font-medium text-background transition-colors ${
          live ? "bg-red-600 hover:bg-red-700" : "bg-foreground hover:opacity-90"
        }`}
      >
        {live ? "■ Stop" : "● Record"}
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

      {errorMsg && (
        <p className="rounded-lg border border-red-500/30 bg-red-500/5 px-4 py-3 text-sm text-red-500">
          {errorMsg}
        </p>
      )}

      <section className="min-h-32 rounded-xl border border-foreground/10 p-4 text-lg leading-relaxed">
        {committed && <span>{committed} </span>}
        {interim && <span className="text-foreground/40">{interim}</span>}
        {!committed && !interim && (
          <span className="text-foreground/30">Your words will appear here…</span>
        )}
      </section>

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
