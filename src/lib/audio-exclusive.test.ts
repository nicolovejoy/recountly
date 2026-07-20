import { describe, expect, it, vi } from "vitest";
import { pauseOthers, type Pausable } from "./audio-exclusive";

function fakePlayer(): Pausable & { pause: ReturnType<typeof vi.fn> } {
  return { pause: vi.fn() };
}

describe("pauseOthers", () => {
  it("pauses every player except current", () => {
    const a = fakePlayer();
    const b = fakePlayer();
    const c = fakePlayer();

    pauseOthers([a, b, c], b);

    expect(a.pause).toHaveBeenCalledTimes(1);
    expect(b.pause).not.toHaveBeenCalled();
    expect(c.pause).toHaveBeenCalledTimes(1);
  });

  it("tolerates an empty list", () => {
    expect(() => pauseOthers([], {})).not.toThrow();
  });

  it("pauses everyone when current is not in the list", () => {
    const a = fakePlayer();
    const b = fakePlayer();

    pauseOthers([a, b], "not-a-player");

    expect(a.pause).toHaveBeenCalledTimes(1);
    expect(b.pause).toHaveBeenCalledTimes(1);
  });
});
