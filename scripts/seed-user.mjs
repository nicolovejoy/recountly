// One-off owner-account seeder. The app config disables sign-up (auth.ts), so
// accounts can't be created through the running app. This script builds a
// throwaway Better Auth instance with sign-up ENABLED, pointed at the same DB,
// and registers a single account.
//
// Usage (loads DATABASE_URL + BETTER_AUTH_SECRET from .env.local):
//   SEED_EMAIL=you@example.com SEED_PASSWORD='…' node --env-file=.env.local scripts/seed-user.mjs
//
// Seed PROD by pointing DATABASE_URL at the prod Neon DB, e.g. via op:
//   SEED_EMAIL=… SEED_PASSWORD='…' \
//   DATABASE_URL="$(op read op://dev-secrets/recountly-neon/credential)" \
//   BETTER_AUTH_SECRET="$(op read op://dev-secrets/recountly-better-auth/secret)" \
//   node scripts/seed-user.mjs
//
// Run the schema migration first so the auth tables exist.

import { betterAuth } from "better-auth";
import pg from "pg";

const email = process.env.SEED_EMAIL;
const password = process.env.SEED_PASSWORD;
const name = process.env.SEED_NAME || (email ? email.split("@")[0] : "owner");

if (!email || !password) {
  console.error("Set SEED_EMAIL and SEED_PASSWORD (see header for usage).");
  process.exit(1);
}
if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set.");
  process.exit(1);
}

const auth = betterAuth({
  database: new pg.Pool({ connectionString: process.env.DATABASE_URL }),
  // Sign-up enabled ONLY here so we can create the account; the app keeps it off.
  emailAndPassword: { enabled: true, disableSignUp: false },
  secret: process.env.BETTER_AUTH_SECRET,
});

try {
  await auth.api.signUpEmail({ body: { email, password, name } });
  console.log(`Seeded account for ${email}`);
  process.exit(0);
} catch (err) {
  console.error("Seed failed:", err?.message || err);
  process.exit(1);
}
