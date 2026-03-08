#!/usr/bin/env bash
# start.sh — HoraMind launcher
#
# What this does (in order):
#   1. cd to the HoraMind directory regardless of where you call it from,
#      so that relative paths in openclaw.json (workspace ".", ./tools) resolve correctly.
#   2. Load .env so OPENROUTER_API_KEY and CHROMA_URL are in the process environment.
#   3. Validate critical env vars are present.
#   4. Bootstrap the OpenClaw agent auth store with the OpenRouter API key
#      (one-time operation — skipped on subsequent runs if already registered).
#   5. Launch the OpenClaw gateway.
#
# Usage:
#   ./start.sh                          — foreground
#   pm2 start ./start.sh --name horamind  — recommended for production

set -euo pipefail

# ── 1. Always run from this script's directory ──────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# ── 2. Load .env ─────────────────────────────────────────────────────────────
if [ -f ".env" ]; then
    set -a
    # shellcheck disable=SC1091
    source .env
    set +a
    echo "[horamind] Loaded .env"
else
    echo "[horamind] WARNING: .env not found. Copy .env.example to .env and fill in your keys."
fi

# ── 3. Validate critical env vars ────────────────────────────────────────────
if [ -z "${OPENROUTER_API_KEY:-}" ]; then
    echo "[horamind] ERROR: OPENROUTER_API_KEY is not set. Add it to .env and retry."
    exit 1
fi

# ── 4. Bootstrap OpenClaw agent auth store (one-time) ───────────────────────
#
# OpenClaw stores provider API keys in a per-agent auth-profiles.json file,
# separate from the main openclaw.json config. This block writes the
# OPENROUTER_API_KEY into that store on first run so the gateway can
# authenticate with OpenRouter without requiring an interactive setup command.
#
# The agent ID "main" is OpenClaw's default. The auth store path is:
#   ~/.openclaw/agents/main/agent/auth-profiles.json
#
AGENT_AUTH_DIR="$HOME/.openclaw/agents/main/agent"
AUTH_FILE="$AGENT_AUTH_DIR/auth-profiles.json"

if [ ! -f "$AUTH_FILE" ] || ! grep -q '"openrouter:default"' "$AUTH_FILE" 2>/dev/null; then
    mkdir -p "$AGENT_AUTH_DIR"
    cat > "$AUTH_FILE" <<EOF
{
    "openrouter:default": {
        "apiKey": "$OPENROUTER_API_KEY"
    }
}
EOF
    echo "[horamind] Registered OpenRouter API key in agent auth store."
else
    echo "[horamind] OpenRouter auth already registered — skipping."
fi

# ── 5. Launch OpenClaw ───────────────────────────────────────────────────────
echo "[horamind] Starting OpenClaw gateway..."
echo "[horamind] Workspace : $SCRIPT_DIR"
echo "[horamind] Config    : $SCRIPT_DIR/openclaw.json"

exec env OPENCLAW_CONFIG_PATH="$SCRIPT_DIR/openclaw.json" openclaw gateway
