import { describe, it, expect } from "vitest";
import { isPublicPath } from "./auth-paths";

describe("isPublicPath", () => {
  it("lets the login page through", () => {
    expect(isPublicPath("/login")).toBe(true);
  });

  it("lets Better Auth's own endpoints through", () => {
    expect(isPublicPath("/api/auth/sign-in/email")).toBe(true);
    expect(isPublicPath("/api/auth/get-session")).toBe(true);
  });

  it("gates the app home and the data/audio/token routes", () => {
    expect(isPublicPath("/")).toBe(false);
    expect(isPublicPath("/api/entries")).toBe(false);
    expect(isPublicPath("/api/audio/01HX")).toBe(false);
    expect(isPublicPath("/api/realtime-token")).toBe(false);
  });

  it("does not treat a lookalike path as the login page", () => {
    expect(isPublicPath("/login-help")).toBe(false);
    expect(isPublicPath("/api/authx")).toBe(false);
  });

  it("lets the PWA manifest and home-screen icons through (iOS/Android fetch them unauthenticated)", () => {
    expect(isPublicPath("/manifest.webmanifest")).toBe(true);
    expect(isPublicPath("/icon-192.png")).toBe(true);
    expect(isPublicPath("/icon-512.png")).toBe(true);
    expect(isPublicPath("/icon-512-maskable.png")).toBe(true);
    expect(isPublicPath("/apple-touch-icon.png")).toBe(true);
  });

  it("does not treat a lookalike PWA asset path as public", () => {
    expect(isPublicPath("/manifest-evil.json")).toBe(false);
    expect(isPublicPath("/manifest.json")).toBe(false);
    expect(isPublicPath("/icon-999.png")).toBe(false);
    expect(isPublicPath("/icon-192.png/../../api/entries")).toBe(false);
    expect(isPublicPath("/apple-touch-icon.png.evil")).toBe(false);
    expect(isPublicPath("/icons/icon-192.png")).toBe(false);
  });
});
