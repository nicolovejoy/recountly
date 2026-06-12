import { describe, it, expect, vi } from "vitest";
import { connectRealtimeSession } from "./realtime";

// Minimal mocks for the browser objects the orchestration touches. The point of
// extracting connectRealtimeSession from the component is exactly this: the
// connection + cancellation logic becomes testable in node, with no real WebRTC.

function makeTrack() {
  return { stop: vi.fn() } as unknown as MediaStreamTrack;
}

function makeStream(tracks: MediaStreamTrack[]) {
  return { getTracks: () => tracks } as unknown as MediaStream;
}

function makePc() {
  const dc = { addEventListener: vi.fn() };
  const pc = {
    addTrack: vi.fn(),
    createDataChannel: vi.fn(() => dc),
    createOffer: vi.fn(async () => ({ type: "offer", sdp: "offer-sdp" })),
    setLocalDescription: vi.fn(async () => {}),
    setRemoteDescription: vi.fn(async () => {}),
    _dc: dc,
  };
  return pc;
}

type AnyPc = ReturnType<typeof makePc>;

function makeCallbacks(overrides: Record<string, unknown> = {}) {
  return {
    isStale: () => false,
    onPeerConnection: vi.fn(),
    onStream: vi.fn(),
    onDataChannel: vi.fn(),
    ...overrides,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

function makeDeps(overrides: Record<string, unknown> = {}) {
  return {
    fetchToken: vi.fn(async () => "tok"),
    createPeerConnection: vi.fn(() => makePc()),
    getUserMedia: vi.fn(async () => makeStream([makeTrack()])),
    postOffer: vi.fn(async () => ({ ok: true, status: 201, sdp: "answer-sdp" })),
    ...overrides,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

describe("connectRealtimeSession", () => {
  it("connects end to end and wires the pc, stream, tracks, and data channel", async () => {
    const pc = makePc();
    const track = makeTrack();
    const stream = makeStream([track]);
    const cb = makeCallbacks();
    const deps = makeDeps({
      createPeerConnection: () => pc,
      getUserMedia: async () => stream,
    });

    const result = await connectRealtimeSession(deps, cb);

    expect(result).toBe("connected");
    expect(cb.onPeerConnection).toHaveBeenCalledWith(pc);
    expect(cb.onStream).toHaveBeenCalledWith(stream);
    expect(pc.addTrack).toHaveBeenCalledWith(track, stream);
    expect(cb.onDataChannel).toHaveBeenCalledWith(pc._dc);
    expect(pc.setRemoteDescription).toHaveBeenCalledWith({
      type: "answer",
      sdp: "answer-sdp",
    });
  });

  // Regression test for the Esc-mid-connect crash: stop() ran during the
  // getUserMedia await, so the original code called pc.addTrack on a closed pc
  // ("signalingState is 'closed'") and leaked the freshly-granted mic stream.
  it("stops the orphaned mic stream and never adds tracks if cancelled during getUserMedia", async () => {
    const pc = makePc();
    const track = makeTrack();
    const stream = makeStream([track]);
    let stale = false;
    const cb = makeCallbacks({ isStale: () => stale });
    const deps = makeDeps({
      createPeerConnection: () => pc,
      getUserMedia: async () => {
        stale = true; // stop() fired while the mic was being acquired
        return stream;
      },
    });

    const result = await connectRealtimeSession(deps, cb);

    expect(result).toBe("cancelled");
    expect(pc.addTrack).not.toHaveBeenCalled();
    expect(track.stop).toHaveBeenCalled();
    expect(pc.setRemoteDescription).not.toHaveBeenCalled();
  });

  it("never creates a peer connection if cancelled during the token fetch", async () => {
    let stale = false;
    const cb = makeCallbacks({ isStale: () => stale });
    const deps = makeDeps({
      fetchToken: async () => {
        stale = true;
        return "tok";
      },
    });

    const result = await connectRealtimeSession(deps, cb);

    expect(result).toBe("cancelled");
    expect(deps.createPeerConnection).not.toHaveBeenCalled();
  });

  it("never posts the offer if cancelled during SDP setup", async () => {
    const pc: AnyPc = makePc();
    let stale = false;
    const cb = makeCallbacks({ isStale: () => stale });
    pc.setLocalDescription = vi.fn(async () => {
      stale = true;
    });
    const deps = makeDeps({ createPeerConnection: () => pc });

    const result = await connectRealtimeSession(deps, cb);

    expect(result).toBe("cancelled");
    expect(deps.postOffer).not.toHaveBeenCalled();
  });

  it("throws with the HTTP status when the SDP exchange fails", async () => {
    const deps = makeDeps({
      postOffer: async () => ({ ok: false, status: 504, sdp: "gateway timeout body" }),
    });

    await expect(connectRealtimeSession(deps, makeCallbacks())).rejects.toThrow(/504/);
  });
});
