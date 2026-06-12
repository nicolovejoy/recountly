#!/bin/bash
# SessionStart hook — installs dependencies so lint/test/build work immediately
# in Claude Code on the web sessions (this repo's container starts with no
# node_modules). Synchronous: the session waits for install to finish, which
# avoids races where the agent runs pnpm before deps are ready.
set -euo pipefail

# Web/remote sessions only — local sessions manage their own install.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-.}"

# Use the container's ambient pnpm (corepack-provided fallback if absent).
# NOTE: we deliberately do NOT pin pnpm 9 here. That pin in CLAUDE.md is for
# the owner's LOCAL Node 20 machine; the remote container runs Node 22, where
# pnpm 10 is fine and already on PATH. Forcing a downgrade makes pnpm purge and
# reinstall node_modules behind an interactive prompt. The lockfile is v9.0,
# which pnpm 10 reads without modifying.
if ! command -v pnpm >/dev/null 2>&1; then
  corepack enable >/dev/null 2>&1 || true
fi

# Idempotent and non-interactive (CI=1 suppresses any prompts). Plain `install`
# (not `--frozen-lockfile`) so the container cache is reused across sessions.
CI=1 pnpm install
