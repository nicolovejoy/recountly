# Template — committed. Holds only 1Password references, no secrets.
# Generate the real (gitignored) .env.local with:
#   op inject -i .env.tpl -o .env.local
#
# Server-only secret. The browser never sees this; it only reaches the
# /api/realtime-token route, which mints short-lived ephemeral tokens.
OPENAI_API_KEY=op://dev-secrets/openAI-recountly-secret-key/credential
