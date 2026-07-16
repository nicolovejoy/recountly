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
    expect(rec.audioComplete).toBeNull();
  });

  it("leaves enrichment fields empty when no enrichment is given", () => {
    const rec = buildEntryRecord(validInput, { id, audioUrl, now });
    expect(rec.title).toBeNull();
    expect(rec.tags).toEqual([]);
    expect(rec.summary).toBeNull();
    expect(rec.enrichedAt).toBeNull();
    expect(rec.enrichmentModel).toBeNull();
  });

  it("threads enrichment in, stamping enrichedAt = now", () => {
    const rec = buildEntryRecord(validInput, {
      id,
      audioUrl,
      now,
      enrichment: {
        title: "A Morning Walk",
        tags: ["walk", "reflection"],
        summary: "Walked and reflected on the rewrite.",
        model: "claude-haiku-4-5",
      },
    });
    expect(rec.title).toBe("A Morning Walk");
    expect(rec.tags).toEqual(["walk", "reflection"]);
    expect(rec.summary).toBe("Walked and reflected on the rewrite.");
    expect(rec.enrichmentModel).toBe("claude-haiku-4-5");
    expect(rec.enrichedAt).toBe(now.toISOString());
  });

  it("treats a null enrichment like no enrichment", () => {
    const rec = buildEntryRecord(validInput, { id, audioUrl, now, enrichment: null });
    expect(rec.title).toBeNull();
    expect(rec.enrichedAt).toBeNull();
  });

  it("defaults audioComplete to true when audio is present", () => {
    const rec = buildEntryRecord(validInput, { id, audioUrl, now });
    expect(rec.audioComplete).toBe(true);
  });

  it("marks audio partial when the entry was paused mid-recording", () => {
    const rec = buildEntryRecord(
      { ...validInput, audioComplete: false },
      { id, audioUrl, now },
    );
    expect(rec.audioComplete).toBe(false);
  });
});

describe("journal archive fields (Phase: physical journals)", () => {
  it("accepts journalId + writtenAt and carries them onto the record", () => {
    const input = {
      transcript: "read from the red notebook",
      durationSeconds: 30,
      journalId: "01JRNL",
      writtenAt: "1994-03-02T00:00:00.000Z",
    };
    expect(validateEntryInput(input)).toEqual([]);
    const rec = buildEntryRecord(input, {
      id: "01HX",
      audioUrl: null,
      now: new Date("2026-07-16T10:00:00Z"),
    });
    expect(rec.journalId).toBe("01JRNL");
    expect(rec.writtenAt).toBe("1994-03-02T00:00:00.000Z");
  });

  it("defaults journalId and writtenAt to null for a normal spoken entry", () => {
    const rec = buildEntryRecord(
      { transcript: "hi", durationSeconds: 1 },
      { id: "01HX", audioUrl: null, now: new Date("2026-07-16T10:00:00Z") },
    );
    expect(rec.journalId).toBeNull();
    expect(rec.writtenAt).toBeNull();
  });

  it("rejects a blank journalId and an unparseable writtenAt", () => {
    const errors = validateEntryInput({
      transcript: "hi",
      durationSeconds: 1,
      journalId: "  ",
      writtenAt: "not-a-date",
    });
    expect(errors).toContain("journalId must be a non-empty string");
    expect(errors).toContain("writtenAt must be a valid date");
  });
});
