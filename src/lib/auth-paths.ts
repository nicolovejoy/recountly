// Pure path classifier for the auth gate (proxy.ts) — no Next/DOM, unit-tested.
// Public paths bypass the session check: the login page itself, Better Auth's
// own endpoints (you must be able to reach them to authenticate), and the PWA
// manifest + home-screen icons (iOS/Android fetch these before any cookie
// exists — e.g. while deciding whether "Add to Home Screen" is available —
// so gating them would break the install). Everything else is gated. The
// proxy matcher separately excludes _next/static assets.
const PUBLIC_ASSET_PATHS = new Set([
  "/manifest.webmanifest",
  "/icon-192.png",
  "/icon-512.png",
  "/icon-512-maskable.png",
  "/apple-touch-icon.png",
]);

export function isPublicPath(pathname: string): boolean {
  if (pathname === "/login") return true;
  if (pathname.startsWith("/api/auth/")) return true;
  if (PUBLIC_ASSET_PATHS.has(pathname)) return true;
  return false;
}
