import { describe, it, expect } from "vitest";
import { ulid, encodeTime, CROCKFORD } from "./ulid";

// A ULID is a 26-char Crockford-base32 string: 10 chars of millisecond
// timestamp (big-endian, so plain string compare sorts by time) + 16 chars of
// randomness. time and random are injected so the tests are deterministic.

const charset = new RegExp(`^[${CROCKFORD}]+$`);

describe("ulid", () => {
  const T0 = 1_700_000_000_000;
  const zeroRandom = () => 0; // every random char is the first symbol ("0")

  it("is 26 Crockford-base32 characters", () => {
    const id = ulid(T0, Math.random);
    expect(id).toHaveLength(26);
    expect(id).toMatch(charset);
  });

  it("encodes the timestamp in the first 10 chars, the rest random", () => {
    const id = ulid(T0, zeroRandom);
    expect(id.slice(0, 10)).toBe(encodeTime(T0));
    expect(id.slice(10)).toBe("0".repeat(16));
  });

  it("sorts lexicographically by time (later timestamp → larger string)", () => {
    const earlier = ulid(T0, zeroRandom);
    const later = ulid(T0 + 1, zeroRandom);
    expect(earlier < later).toBe(true);
  });

  it("shares the time prefix but differs in the random tail within the same ms", () => {
    let n = 0;
    const rng = () => ((n++ % 31) + 1) / 32; // non-zero, varying
    const a = ulid(T0, rng);
    const b = ulid(T0, rng);
    expect(a.slice(0, 10)).toBe(b.slice(0, 10));
    expect(a).not.toBe(b);
  });

  it("produces unique ids across many calls at the same instant", () => {
    const ids = new Set(Array.from({ length: 500 }, () => ulid(T0, Math.random)));
    expect(ids.size).toBe(500);
  });
});

describe("encodeTime", () => {
  it("encodes 0 as ten zero symbols", () => {
    expect(encodeTime(0)).toBe("0".repeat(10));
  });

  it("is monotonic across the second boundary", () => {
    expect(encodeTime(1000) < encodeTime(1001)).toBe(true);
  });

  it("round-trips a known value back from base32", () => {
    const ms = 1_700_000_000_000;
    const decoded = [...encodeTime(ms)].reduce((acc, c) => acc * 32 + CROCKFORD.indexOf(c), 0);
    expect(decoded).toBe(ms);
  });
});
