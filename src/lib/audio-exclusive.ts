// Pure helper (unit-tested in audio-exclusive.test.ts) — no DOM. Only one
// entry's audio should play at a time (issue #39). Wired via an onPlay
// handler that queries every <audio> on the page and hands them here.

export interface Pausable {
  pause(): void;
}

// Pauses every player except `current`. Identity comparison (not equality)
// so passing the currently-playing element as `current` is a no-op for it.
export function pauseOthers(players: Iterable<Pausable>, current: unknown): void {
  for (const player of players) {
    if (player !== current) player.pause();
  }
}
