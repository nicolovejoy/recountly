import { describe, it, expect } from "vitest";
import { createConfirmController } from "./confirm-controller";

describe("createConfirmController", () => {
  it("opens a dialog and stays pending until resolved", async () => {
    const c = createConfirmController();
    let settled: boolean | null = null;
    const p = c.confirm({ title: "Trash entry?" });
    p.then((v) => {
      settled = v;
    });

    // State reflects the open dialog; the promise has not resolved yet.
    expect(c.getState()).toMatchObject({ title: "Trash entry?" });
    await Promise.resolve();
    expect(settled).toBeNull();
  });

  it("resolves true and clears state when confirmed", async () => {
    const c = createConfirmController();
    const p = c.confirm({ title: "Delete forever?", tone: "danger" });
    c.resolve(true);
    await expect(p).resolves.toBe(true);
    expect(c.getState()).toBeNull();
  });

  it("resolves false and clears state when cancelled", async () => {
    const c = createConfirmController();
    const p = c.confirm({ title: "Delete forever?" });
    c.resolve(false);
    await expect(p).resolves.toBe(false);
    expect(c.getState()).toBeNull();
  });

  it("keeps only one dialog open — a second confirm cancels the first", async () => {
    const c = createConfirmController();
    const first = c.confirm({ title: "First" });
    const second = c.confirm({ title: "Second" });

    // The pending first request resolves false; the state is now the second.
    await expect(first).resolves.toBe(false);
    expect(c.getState()).toMatchObject({ title: "Second" });

    c.resolve(true);
    await expect(second).resolves.toBe(true);
    expect(c.getState()).toBeNull();
  });

  it("assigns a distinct id to each opened dialog", () => {
    const c = createConfirmController();
    c.confirm({ title: "A" });
    const firstId = c.getState()?.id;
    c.confirm({ title: "B" });
    const secondId = c.getState()?.id;
    expect(firstId).toBeDefined();
    expect(secondId).not.toBe(firstId);
  });

  it("notifies subscribers on open and on resolve, and stops after unsubscribe", () => {
    const c = createConfirmController();
    let notifications = 0;
    const unsubscribe = c.subscribe(() => {
      notifications += 1;
    });

    c.confirm({ title: "Ping" });
    expect(notifications).toBe(1);
    c.resolve(true);
    expect(notifications).toBe(2);

    unsubscribe();
    c.confirm({ title: "Silent" });
    expect(notifications).toBe(2);
  });

  it("resolve is a no-op when no dialog is open", async () => {
    const c = createConfirmController();
    expect(() => c.resolve(true)).not.toThrow();
    expect(c.getState()).toBeNull();
  });
});
