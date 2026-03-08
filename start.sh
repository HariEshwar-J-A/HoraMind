#!/usr/bin/env bash
# start.sh — HoraMind launcher
#
# What this does (in order):
#   1. cd to the HoraMind directory regardless of where you call it from,
#      so that relative paths in openclaw.json (./agent_config, ./tools)
#      always resolve correctly.
#   2. Load .env into the current shell so OPENROUTER_API_KEY, CHROMA_URL, etc.
#      are available to the openclaw process (auth.profiles picks up
#      OPENROUTER_API_KEY automatically; CHROMA_URL is read by the RAG tool).
#   3. Launch openclaw gateway with the local config file.
#
# Usage:
#   ./start.sh             — foreground (logs to stdout)
#   ./start.sh &           — background (logs lost)
#   pm2 start ./start.sh --name horamind   — recommended for production

set -euo pipefail

# ── 1. Always run from the directory that contains this script ──────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# ── 2. Load .env ────────────────────────────────────────────────────────────
if [ -f ".env" ]; then
    # set -a exports every variable defined hereafter; set +a stops it.
    set -a
    # shellcheck disable=SC1091
    source .env
    set +a
    echo "[horamind] Loaded .env"
else
    echo "[horamind] WARNING: .env not found. Copy .env.example to .env and fill in your keys."
    echo "[horamind] Continuing — OPENROUTER_API_KEY must already be in the environment."
fi

# ── 3. Validate the two most critical keys are present ──────────────────────
if [ -z "${OPENROUTER_API_KEY:-}" ]; then
    echo "[horamind] ERROR: OPENROUTER_API_KEY is not set. Aborting."
    exit 1
fi

# ── 4. Launch OpenClaw ──────────────────────────────────────────────────────
echo "[horamind] Starting OpenClaw gateway..."
echo "[horamind] Workspace : $SCRIPT_DIR/agent_config"
echo "[horamind] Config    : $SCRIPT_DIR/openclaw.json"

exec env OPENCLAW_CONFIG_PATH="$SCRIPT_DIR/openclaw.json" openclaw gateway
