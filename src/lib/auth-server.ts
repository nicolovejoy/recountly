// Server-side session access. Kept separate from auth.ts so the next/headers
// import never leaks into non-Next contexts (e.g. the seed script). The API
// routes call this to do the REAL session check (the proxy is optimistic only).

import { headers } from "next/headers";
import { auth } from "./auth";

export async function getServerSession() {
  return auth.api.getSession({ headers: await headers() });
}
