// Better Auth instance — the owner gate for recountly. Accounts live in the same
// Neon Postgres as entries (see db.ts), via a plain pg Pool over the pooled
// DATABASE_URL (the Neon serverless WebSocket Pool would need ws configured on
// Node 20; pg over TCP works locally and on Vercel Fluid without that).
//
// Email+password only, sign-up DISABLED: the single owner account is created
// out-of-band by scripts/seed-user.mjs. To go multi-user later, flip
// disableSignUp to false and add a sign-up form (see the plan / CLAUDE.md).
//
// A pg Pool connects lazily (no socket opened until the first query), so
// constructing it at import is build-safe even when DATABASE_URL is absent.

import { betterAuth } from "better-auth";
import { Pool } from "pg";

export const auth = betterAuth({
  // better-auth accepts a pg Pool directly (wrapped via its Kysely adapter).
  database: new Pool({ connectionString: process.env.DATABASE_URL }),
  emailAndPassword: { enabled: true, disableSignUp: true },
  secret: process.env.BETTER_AUTH_SECRET,
  baseURL: process.env.BETTER_AUTH_URL,
});
