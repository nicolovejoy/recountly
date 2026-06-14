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
DATABASE_URL=op://dev-secrets/recountly-neon/credential

# Vercel Blob — audio storage. Same story: prod from Vercel env, local from op.
# This item was saved from Vercel, so its field is named BLOB_READ_WRITE_TOKEN
# (not `credential` like the others).
BLOB_READ_WRITE_TOKEN=op://dev-secrets/recountly-blob/BLOB_READ_WRITE_TOKEN
