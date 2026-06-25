import { describe, it, expect } from "vitest";
import {
  parseRecordedAt,
  importId,
  extractTranscript,
  parseAudioRef,
} from "./journal-parse.mjs";

describe("parseRecordedAt", () => {
  it("parses MON_DD_HH.MM + year into a local-time Date", () => {
    const d = parseRecordedAt("JUL_28_08.46", 2025);
    expect(d.getFullYear()).toBe(2025);
    expect(d.getMonth()).toBe(6); // July = index 6
    expect(d.getDate()).toBe(28);
    expect(d.getHours()).toBe(8);
    expect(d.getMinutes()).toBe(46);
  });

  it("handles single-digit-looking zero-padded fields and other months", () => {
    const d = parseRecordedAt("JAN_30_10.12", 2026);
    expect(d.getMonth()).toBe(0);
    expect(d.getDate()).toBe(30);
    expect(d.getHours()).toBe(10);
    expect(d.getMinutes()).toBe(12);
  });

  it("throws on a malformed name or unknown month", () => {
    expect(() => parseRecordedAt("garbage", 2025)).toThrow();
    expect(() => parseRecordedAt("ZZZ_01_00.00", 2025)).toThrow();
  });
});

describe("importId", () => {
  it("is deterministic and includes year + filename", () => {
    expect(importId(2025, "JUL_28_08.46")).toBe("imp_2025_JUL_28_08.46");
  });
});

const MD_2025 = `# Audio Journal - July 28, 2025 at 08:48 AM

**Audio:** \`JUL_28_08.46.m4a\` | **Duration:** 62s | **Size:** 568K

---

## Transcript

Well, isn't that interesting. I need visual feedback.
Here we are, audio journaling.

---

## Notes

<!-- Add your thoughts, tags, or follow-up notes here -->

First real entry.
`;

const MD_2026 = `# Audio Journal - January 30, 2026 at 10:13 AM

**Audio:** \`JAN_30_10.12.m4a\` | **Duration:** 00:47 | **Segments:** 3

---

## Transcript

[00:00] So at this point we should be talking.

[00:10] Not clear to me that we are getting too much going on.

---

## Metadata

- **Words:** 81
`;

describe("extractTranscript", () => {
  it("pulls the prose from the Transcript section, dropping trailing sections", () => {
    const t = extractTranscript(MD_2025);
    expect(t).toBe(
      "Well, isn't that interesting. I need visual feedback.\nHere we are, audio journaling.",
    );
    expect(t).not.toContain("Notes");
    expect(t).not.toContain("First real entry");
  });

  it("strips [MM:SS] markers from the 2026-style files", () => {
    const t = extractTranscript(MD_2026);
    expect(t).not.toMatch(/\[\d{1,2}:\d{2}\]/);
    expect(t).toContain("So at this point we should be talking.");
    expect(t).toContain("Not clear to me");
    expect(t).not.toContain("Metadata");
  });

  it("returns empty string when there is no Transcript section", () => {
    expect(extractTranscript("# Title\n\nno transcript here")).toBe("");
  });
});

describe("parseAudioRef", () => {
  it("parses filename + seconds-style duration", () => {
    expect(parseAudioRef(MD_2025)).toEqual({
      fileName: "JUL_28_08.46.m4a",
      durationSeconds: 62,
    });
  });

  it("parses MM:SS-style duration", () => {
    expect(parseAudioRef(MD_2026)).toEqual({
      fileName: "JAN_30_10.12.m4a",
      durationSeconds: 47,
    });
  });

  it("returns nulls when the audio line is absent", () => {
    expect(parseAudioRef("# Title\n\nno audio line")).toEqual({
      fileName: null,
      durationSeconds: null,
    });
  });
});
