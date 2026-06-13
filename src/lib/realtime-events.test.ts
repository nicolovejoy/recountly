import { describe, it, expect } from "vitest";
import { parseRealtimeEvent } from "./realtime-events";

// parseRealtimeEvent maps raw data-channel payloads (JSON strings) onto an
// honestly-discriminated union: every recognized shape is narrowed, everything
// else — unparseable data, unrecognized types, recognized types missing their
// payload field — lands in the explicit "unknown" arm instead of half-typed.

describe("parseRealtimeEvent", () => {
  it("parses an interim delta event", () => {
    const raw = JSON.stringify({
      type: "conversation.item.input_audio_transcription.delta",
      item_id: "item_1",
      delta: "hello ",
    });
    expect(parseRealtimeEvent(raw)).toEqual({
      type: "conversation.item.input_audio_transcription.delta",
      delta: "hello ",
    });
  });

  it("parses a completed (finalized segment) event", () => {
    const raw = JSON.stringify({
      type: "conversation.item.input_audio_transcription.completed",
      item_id: "item_1",
      transcript: "hello world",
    });
    expect(parseRealtimeEvent(raw)).toEqual({
      type: "conversation.item.input_audio_transcription.completed",
      transcript: "hello world",
    });
  });

  it("parses a transcription-failed event with its error detail", () => {
    const raw = JSON.stringify({
      type: "conversation.item.input_audio_transcription.failed",
      error: { message: "audio too short", code: "audio_too_short" },
    });
    expect(parseRealtimeEvent(raw)).toEqual({
      type: "conversation.item.input_audio_transcription.failed",
      error: { message: "audio too short", code: "audio_too_short" },
    });
  });

  it("parses a session error event even when error detail is absent", () => {
    const raw = JSON.stringify({ type: "error" });
    expect(parseRealtimeEvent(raw)).toEqual({ type: "error", error: undefined });
  });

  it("maps unrecognized event types to unknown, keeping the raw type for logging", () => {
    const raw = JSON.stringify({ type: "session.created", session: { id: "s_1" } });
    expect(parseRealtimeEvent(raw)).toEqual({
      type: "unknown",
      rawType: "session.created",
      text: undefined,
    });
  });

  it("surfaces a text snippet on unknown events when one is available", () => {
    const raw = JSON.stringify({ type: "response.done", transcript: "stray" });
    expect(parseRealtimeEvent(raw)).toEqual({
      type: "unknown",
      rawType: "response.done",
      text: "stray",
    });
  });

  it("maps JSON without a type field to unknown('(no type)')", () => {
    const raw = JSON.stringify({ delta: "orphan" });
    expect(parseRealtimeEvent(raw)).toEqual({
      type: "unknown",
      rawType: "(no type)",
      text: "orphan",
    });
  });

  it("maps non-JSON payloads to unknown('(unparseable)') with a bounded snippet", () => {
    const evt = parseRealtimeEvent("garbage{{{" + "x".repeat(200));
    expect(evt.type).toBe("unknown");
    if (evt.type === "unknown") {
      expect(evt.rawType).toBe("(unparseable)");
      expect(evt.text?.length).toBeLessThanOrEqual(80);
      expect(evt.text?.startsWith("garbage{{{")).toBe(true);
    }
  });

  it("demotes a delta event whose delta field is missing or not a string", () => {
    const raw = JSON.stringify({
      type: "conversation.item.input_audio_transcription.delta",
      delta: 42,
    });
    expect(parseRealtimeEvent(raw)).toEqual({
      type: "unknown",
      rawType: "conversation.item.input_audio_transcription.delta",
      text: undefined,
    });
  });

  it("demotes a completed event whose transcript field is missing", () => {
    const raw = JSON.stringify({
      type: "conversation.item.input_audio_transcription.completed",
    });
    expect(parseRealtimeEvent(raw)).toEqual({
      type: "unknown",
      rawType: "conversation.item.input_audio_transcription.completed",
      text: undefined,
    });
  });
});
