// Connection orchestration for the live-transcription session, extracted from
// the React component so the cancellation logic is testable in node (see
// realtime.test.ts) — no real WebRTC needed.
//
// The browser primitives are injected (RealtimeDeps) and the React-side wiring
// (refs, meter, data-channel handlers) is delegated through callbacks
// (RealtimeCallbacks). cb.isStale() is the cancellation token: the component
// returns true once stop()/a newer start() has superseded this attempt, and we
// bail after every await so we never touch a torn-down peer connection.

export interface RealtimeDeps {
  fetchToken: () => Promise<string>;
  createPeerConnection: () => RTCPeerConnection;
  getUserMedia: () => Promise<MediaStream>;
  // Returns the raw answer SDP text plus the HTTP status so callers can build
  // an error message without re-reading the body.
  postOffer: (sdp: string | undefined, token: string) => Promise<{
    ok: boolean;
    status: number;
    sdp: string;
  }>;
}

export interface RealtimeCallbacks {
  isStale: () => boolean;
  onPeerConnection: (pc: RTCPeerConnection) => void;
  onStream: (stream: MediaStream) => void;
  onDataChannel: (dc: RTCDataChannel) => void;
}

export type ConnectResult = "connected" | "cancelled";

export async function connectRealtimeSession(
  deps: RealtimeDeps,
  cb: RealtimeCallbacks,
): Promise<ConnectResult> {
  const token = await deps.fetchToken();
  if (cb.isStale()) return "cancelled"; // cancelled before the pc exists

  const pc = deps.createPeerConnection();
  cb.onPeerConnection(pc);

  const stream = await deps.getUserMedia();
  if (cb.isStale()) {
    // cleanup() already ran and saw no stream ref, so this freshly-granted mic
    // stream is orphaned — stop it ourselves rather than leak the mic.
    stream.getTracks().forEach((t) => t.stop());
    return "cancelled";
  }
  cb.onStream(stream);
  stream.getTracks().forEach((track) => pc.addTrack(track, stream));

  const dc = pc.createDataChannel("oai-events");
  cb.onDataChannel(dc);

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  if (cb.isStale()) return "cancelled";

  const res = await deps.postOffer(offer.sdp, token);
  if (cb.isStale()) return "cancelled";
  if (!res.ok) throw new Error(`calls ${res.status}: ${res.sdp.slice(0, 120)}`);

  await pc.setRemoteDescription({ type: "answer", sdp: res.sdp });
  if (cb.isStale()) return "cancelled";

  return "connected";
}
