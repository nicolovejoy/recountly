// Better Auth's catch-all handler — serves sign-in, sign-out, session, etc. at
// /api/auth/*. This path is allowlisted in proxy.ts so the gate doesn't block
// login itself.

import { auth } from "@/lib/auth";
import { toNextJsHandler } from "better-auth/next-js";

export const { GET, POST } = toNextJsHandler(auth);
