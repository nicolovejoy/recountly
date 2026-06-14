import { describe, it, expect } from "vitest";
import { validateEntryInput, buildEntryRecord, type EntryInput } from "./entry";

const validInput: EntryInput = {
  transcript: "Today I walked and thought about the rewrite.",
  durationSeconds: 42,
  audioMime: "audio/webm",
  audioBytes: 12_345,
};

describe("validateEntryInput", () => {
  it("accepts a well-formed input (no errors)", () => {
    expect(validateEntryInput(validInput)).toEqual([]);
  });

  it("rejects an empty/whitespace transcript", () => {
    expect(validateEntryInput({ ...validInput, transcript: "   " })).toContain(
      "transcript is empty",
    );
  });

  it("rejects a negative or non-finite duration", () => {
    expect(validateEntryInput({ ...validInput, durationSeconds: -1 })).toContain(
      "durationSeconds must be a non-negative number",
    );
    expect(validateEntryInput({ ...validInput, durationSeconds: NaN })).toContain(
      "durationSeconds must be a non-negative number",
    );
  });

  it("rejects a non-positive audioBytes", () => {
    expect(validateEntryInput({ ...validInput, audioBytes: 0 })).toContain(
      "audioBytes must be a positive integer",
    );
  });

  it("rejects a missing audio mime type", () => {
    expect(validateEntryInput({ ...validInput, audioMime: "" })).toContain(
      "audioMime is required",
    );
  });

  it("accepts an audio-less input (best-effort audio)", () => {
    expect(
      validateEntryInput({ transcript: "spoke, no audio saved", durationSeconds: 10 }),
    ).toEqual([]);
  });

  it("collects multiple problems at once", () => {
    const errors = validateEntryInput({
      transcript: "",
      durationSeconds: -5,
      audioMime: "",
      audioBytes: 0,
    });
    expect(errors.length).toBeGreaterThanOrEqual(4);
  });
});

describe("buildEntryRecord", () => {
  const id = "01HXAMPLE0000000000000000";
  const now = new Date("2026-06-13T01:00:00.000Z");
  const audioUrl = "https://blob.example/01HXAMPLE.webm";

  it("assembles a full record from input + server-assigned fields", () => {
    const rec = buildEntryRecord(validInput, { id, audioUrl, now });
    expect(rec).toMatchObject({
      id,
      transcript: validInput.transcript,
      durationSeconds: 42,
      audioUrl,
      audioMime: "audio/webm",
      audioBytes: 12_345,
      title: null,
      tags: [],
    });
  });

  it("defaults recorded_at, created_at and updated_at to now (ISO)", () => {
    const rec = buildEntryRecord(validInput, { id, audioUrl, now });
    expect(rec.recordedAt).toBe(now.toISOString());
    expect(rec.createdAt).toBe(now.toISOString());
    expect(rec.updatedAt).toBe(now.toISOString());
  });

  it("honors an explicit recordedAt while still stamping created/updated as now", () => {
    const recordedAt = "2026-06-12T22:30:00.000Z";
    const rec = buildEntryRecord({ ...validInput, recordedAt }, { id, audioUrl, now });
    expect(rec.recordedAt).toBe(recordedAt);
    expect(rec.createdAt).toBe(now.toISOString());
  });

  it("trims the stored transcript", () => {
    const rec = buildEntryRecord(
      { ...validInput, transcript: "  hello  " },
      { id, audioUrl, now },
    );
    expect(rec.transcript).toBe("hello");
  });

  it("stores nulls for an audio-less entry", () => {
    const rec = buildEntryRecord(
      { transcript: "no audio", durationSeconds: 10 },
      { id, audioUrl: null, now },
    );
    expect(rec.audioUrl).toBeNull();
    expect(rec.audioMime).toBeNull();
    expect(rec.audioBytes).toBeNull();
  });
});
