import { describe, it, expect } from "vitest";
import {
  buildEnrichmentPrompt,
  normalizeEnrichment,
  enrichTranscript,
  ENRICHMENT_MODEL,
  type RawEnrichment,
  type EnrichClient,
} from "./enrich";

// A fake client that records the body it was called with and replays a canned
// result — no live API. `throws` makes it reject (to exercise best-effort).
function fakeClient(
  result: { parsed_output: RawEnrichment | null } | { throws: true },
) {
  const calls: unknown[] = [];
  const client: EnrichClient = {
    messages: {
      async parse(body) {
        calls.push(body);
        if ("throws" in result) throw new Error("network down");
        return result;
      },
    },
  };
  return { client, calls };
}

describe("buildEnrichmentPrompt", () => {
  it("includes the transcript and the three field instructions", () => {
    const p = buildEnrichmentPrompt("walked the dog and thought about work");
    expect(p).toContain("walked the dog and thought about work");
    expect(p).toMatch(/title:/);
    expect(p).toMatch(/tags:/);
    expect(p).toMatch(/summary:/);
  });

  it("tells the model not to invent facts", () => {
    expect(buildEnrichmentPrompt("x")).toMatch(/do not invent/i);
  });
});

describe("normalizeEnrichment", () => {
  it("trims title/summary and carries the model", () => {
    const e = normalizeEnrichment(
      { title: "  A Morning Walk  ", tags: [], summary: "  A reflection.  " },
      "claude-haiku-4-5",
    );
    expect(e.title).toBe("A Morning Walk");
    expect(e.summary).toBe("A reflection.");
    expect(e.model).toBe("claude-haiku-4-5");
  });

  it("maps empty/whitespace/non-string title and summary to null", () => {
    expect(normalizeEnrichment({ title: "   ", summary: "" }, "m")).toMatchObject({
      title: null,
      summary: null,
    });
    expect(normalizeEnrichment({ title: 42, summary: null }, "m")).toMatchObject({
      title: null,
      summary: null,
    });
  });

  it("caps title and summary length", () => {
    const e = normalizeEnrichment(
      { title: "t".repeat(200), summary: "s".repeat(500) },
      "m",
    );
    expect(e.title!.length).toBeLessThanOrEqual(80);
    expect(e.summary!.length).toBeLessThanOrEqual(300);
  });

  it("lowercases, trims, dedupes and caps tags at 5", () => {
    const e = normalizeEnrichment(
      { tags: [" Work ", "work", "Dog", "walk", "health", "sleep", "food"] },
      "m",
    );
    expect(e.tags).toEqual(["work", "dog", "walk", "health", "sleep"]);
  });

  it("drops empty and non-string tags", () => {
    const e = normalizeEnrichment({ tags: ["  ", "ok", 7, null, ""] }, "m");
    expect(e.tags).toEqual(["ok"]);
  });

  it("defaults tags to [] when not an array", () => {
    expect(normalizeEnrichment({ tags: "nope" }, "m").tags).toEqual([]);
    expect(normalizeEnrichment({}, "m").tags).toEqual([]);
  });
});

describe("enrichTranscript", () => {
  it("calls the client and returns a normalized enrichment", async () => {
    const { client, calls } = fakeClient({
      parsed_output: { title: "Walk", tags: ["Walk", "walk"], summary: "A walk." },
    });
    const out = await enrichTranscript("I went for a walk", client);
    expect(out).toEqual({
      title: "Walk",
      tags: ["walk"],
      summary: "A walk.",
      model: ENRICHMENT_MODEL,
    });
    // The transcript reaches the model and the default model is used.
    const body = calls[0] as { model: string; messages: { content: string }[] };
    expect(body.model).toBe(ENRICHMENT_MODEL);
    expect(body.messages[0].content).toContain("I went for a walk");
  });

  it("threads a custom model through to the result and the request", async () => {
    const { client, calls } = fakeClient({
      parsed_output: { title: "X", tags: [], summary: "Y" },
    });
    const out = await enrichTranscript("t", client, "claude-opus-4-8");
    expect(out?.model).toBe("claude-opus-4-8");
    expect((calls[0] as { model: string }).model).toBe("claude-opus-4-8");
  });

  it("returns null when the model produced no parsed output", async () => {
    const { client } = fakeClient({ parsed_output: null });
    expect(await enrichTranscript("t", client)).toBeNull();
  });

  it("returns null (best-effort) when the client throws", async () => {
    const { client } = fakeClient({ throws: true });
    expect(await enrichTranscript("t", client)).toBeNull();
  });
});
