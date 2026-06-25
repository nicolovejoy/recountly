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
  // Accept auth requests from both origins during/after the recountly.org cutover
  // so flipping BETTER_AUTH_URL doesn't lock out the vercel.app fallback.
  trustedOrigins: ["https://recountly.org", "https://recountly.vercel.app"],
  // Single trusted owner on a trusted device — keep sessions long and rolling so
  // re-login is rare. updateAge slides the expiry forward once a day on use.
  session: {
    expiresIn: 60 * 60 * 24 * 30, // 30 days
    updateAge: 60 * 60 * 24, // refresh at most once a day
  },
  // Better Auth enables rate limiting in production by default (incl. a built-in
  // 3-req/10s throttle on /sign-in). The default store is in-memory, which is
  // per-instance on serverless and resets on cold start — use the database store
  // so the brute-force limit holds across Vercel Fluid instances. Requires the
  // `rateLimit` table (created by `pnpm db:auth-migrate`).
  rateLimit: {
    storage: "database",
  },
});
