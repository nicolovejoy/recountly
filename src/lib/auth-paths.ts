// Pure path classifier for the auth gate (proxy.ts) — no Next/DOM, unit-tested.
// Public paths bypass the session check: the login page itself, and Better Auth's
// own endpoints (you must be able to reach them to authenticate). Everything else
// is gated. The proxy matcher separately excludes _next/static assets.
export function isPublicPath(pathname: string): boolean {
  if (pathname === "/login") return true;
  if (pathname.startsWith("/api/auth/")) return true;
  return false;
}
