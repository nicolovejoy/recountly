// Dependency-free ULID-style sortable IDs (unit-tested in ulid.test.ts) — no
// React, no DOM. 26 Crockford-base32 chars: 10 of millisecond timestamp
// (big-endian, so a plain string compare orders by creation time — exactly the
// "sortable stable ID" the entries table wants) + 16 of randomness. time and
// random are injected so callers can make them deterministic in tests.

// Crockford base32 — excludes I, L, O, U to avoid ambiguity.
export const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

const TIME_LEN = 10;
const RANDOM_LEN = 16;

// Encodes a millisecond timestamp into TIME_LEN base32 chars, most-significant
// first. 10 chars hold 50 bits — comfortably above the 48 bits ULID allots to
// time — so the top chars stay 0 and ordering is preserved.
export function encodeTime(ms: number, len: number = TIME_LEN): string {
  let n = Math.floor(ms);
  let out = "";
  for (let i = 0; i < len; i++) {
    out = CROCKFORD[n % 32] + out;
    n = Math.floor(n / 32);
  }
  return out;
}

function encodeRandom(random: () => number, len: number = RANDOM_LEN): string {
  let out = "";
  for (let i = 0; i < len; i++) {
    out += CROCKFORD[Math.floor(random() * 32)];
  }
  return out;
}

export function ulid(now: number = Date.now(), random: () => number = Math.random): string {
  return encodeTime(now) + encodeRandom(random);
}
