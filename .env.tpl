# Template — committed. Holds only 1Password references, no secrets.
# Generate the real (gitignored) .env.local with:
#   op inject -i .env.tpl -o .env.local
#
# Server-only secret. The browser never sees this; it only reaches the
# /api/realtime-token route, which mints short-lived ephemeral tokens.
OPENAI_API_KEY=op://dev-secrets/openAI-recountly-secret-key/credential

# Neon Postgres — entry index + transcripts. Production reads this from the
# Vercel project's env (Neon integration); locally we keep it in op because
# Vercel marks integration secrets write-only (`vercel env pull` returns them
# blank). Connection string from console.neon.tech (pooled, host has `-pooler`).
DATABASE_URL=op://dev-secrets/recountly-neon/password

# Vercel Blob — audio storage. Same story: prod from Vercel env, local from op.
# This item was saved from Vercel, so its field is named BLOB_READ_WRITE_TOKEN
# (not `credential` like the others).
BLOB_READ_WRITE_TOKEN=op://dev-secrets/recountly-blob/BLOB_READ_WRITE_TOKEN

# Better Auth — the owner gate. SECRET signs sessions (>=32 chars,
# `openssl rand -base64 32`); prod reads it from Vercel env. BETTER_AUTH_URL is
# the app's own base URL (not a secret); local is the dev server, prod sets its
# own in Vercel env (https://recountly.vercel.app, later recountly.org).
BETTER_AUTH_SECRET=op://dev-secrets/recountly-better-auth/secret
BETTER_AUTH_URL=http://localhost:8255

# Anthropic API — Phase 4 LLM enrichment (title/tags/summary on save). Server-only
# (never reaches the browser); prod reads it from Vercel env. Key from
# console.anthropic.com. NOTE: create the op item `recountly-anthropic` first
# (see CLAUDE.md Next) or `op inject` will fail on this line.
ANTHROPIC_API_KEY=op://dev-secrets/recountly-anthropic/credential
