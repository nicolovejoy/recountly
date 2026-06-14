# Template — committed. Holds only 1Password references, no secrets.
# Generate the real (gitignored) .env.local with:
#   op inject -i .env.tpl -o .env.local
#
# Server-only secret. The browser never sees this; it only reaches the
# /api/realtime-token route, which mints short-lived ephemeral tokens.
OPENAI_API_KEY=op://dev-secrets/openAI-recountly-secret-key/credential

# Neon Postgres — entry index + transcripts. Connection string from the Neon
# store on the Vercel project (or the Neon dashboard). Server-only.
DATABASE_URL=op://dev-secrets/recountly-neon/credential

# Vercel Blob — audio storage. Read-write token from the Blob store settings.
# Server-only; the browser uploads via our route, never holding this.
BLOB_READ_WRITE_TOKEN=op://dev-secrets/recountly-blob/credential
