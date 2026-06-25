// Auth gate (Next 16 renamed Middleware → Proxy; same mechanism). Runs before
// every non-static request and does an OPTIMISTIC check: is a Better Auth session
// cookie present? If not, redirect page requests to /login and 401 API requests.
//
// This is UX/coarse protection only — getSessionCookie checks presence, not the
// signature. The real enforcement lives in the API routes via getServerSession()
// (auth-server.ts), which validates the session against the secret + DB. Defense
// in depth: a forged cookie slips past here but is rejected there.

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getSessionCookie } from "better-auth/cookies";
import { isPublicPath } from "@/lib/auth-paths";

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (isPublicPath(pathname)) return NextResponse.next();

  if (getSessionCookie(request)) return NextResponse.next();

  // Unauthenticated. API callers want JSON, not an HTML login page.
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const url = new URL("/login", request.url);
  url.searchParams.set("from", pathname);
  return NextResponse.redirect(url);
}

export const config = {
  // Run on everything except Next internals and static assets.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
