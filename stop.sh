#!/usr/bin/env bash
# stop.sh — HoraMind safe shutdown
#
# Modes:
#   ./stop.sh              — stop gateway process AND wipe API key from disk
#   ./stop.sh --revoke-only — wipe API key only, do not touch the process
#                             (useful after a crash where the process is already dead)
#
# The key is re-written automatically on the next `./start.sh` run.
# Treat this as the canonical shutdown command — always run it when stopping the bot.
#
# Usage:
#   ./stop.sh              — full shutdown
#   ./stop.sh --revoke-only — key wipe only
#   npm run stop           — full shutdown via npm
#   npm run revoke         — key wipe only via npm

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AUTH_FILE="$HOME/.openclaw/agents/main/agent/auth-profiles.json"
REVOKE_ONLY=false

# Parse flags
for arg in "$@"; do
    case "$arg" in
        --revoke-only) REVOKE_ONLY=true ;;
        *) echo "[horamind] Unknown flag: $arg"; exit 1 ;;
    esac
done

if $REVOKE_ONLY; then
    echo "[horamind] Revoke-only mode — skipping process shutdown."
else
    echo "[horamind] Shutting down..."
fi

# ── 1. Stop the gateway process ──────────────────────────────────────────────
#
# Tries three methods in order:
#   a) pm2 stop (if pm2 is managing it)
#   b) SIGTERM on any process with "openclaw gateway" in its command line
#   c) SIGKILL fallback after 5 seconds if still alive
#
if ! $REVOKE_ONLY; then
    OPENCLAW_STOPPED=false

    if command -v pm2 &>/dev/null && pm2 list 2>/dev/null | grep -q "horamind"; then
        pm2 stop horamind 2>/dev/null && OPENCLAW_STOPPED=true
        echo "[horamind] Stopped pm2 process 'horamind'."
    fi

    if ! $OPENCLAW_STOPPED; then
        PIDS=$(pgrep -f "openclaw gateway" 2>/dev/null || true)
        if [ -n "$PIDS" ]; then
            echo "[horamind] Sending SIGTERM to openclaw gateway (PID: $PIDS)..."
            kill -TERM $PIDS 2>/dev/null || true
            for i in $(seq 1 5); do
                sleep 1
                REMAINING=$(pgrep -f "openclaw gateway" 2>/dev/null || true)
                if [ -z "$REMAINING" ]; then
                    break
                fi
                if [ "$i" -eq 5 ]; then
                    echo "[horamind] Process did not exit — sending SIGKILL..."
                    kill -KILL $REMAINING 2>/dev/null || true
                fi
            done
            echo "[horamind] OpenClaw gateway stopped."
        else
            echo "[horamind] No running openclaw gateway process found."
        fi
    fi
fi

# ── 2. Wipe the API key from the auth store ──────────────────────────────────
#
# Overwrites auth-profiles.json with an empty placeholder.
# The real key is re-injected by start.sh on the next run.
# We overwrite rather than delete so OpenClaw does not fail on missing file.
#
if [ -f "$AUTH_FILE" ]; then
    # Atomic overwrite: write to a temp file first, then rename.
    TMP_FILE="$(dirname "$AUTH_FILE")/.auth-profiles.tmp"
    cat > "$TMP_FILE" <<'EOF'
{
    "_note": "API key cleared by stop.sh. Run start.sh to restore.",
    "openrouter:default": {
        "apiKey": ""
    }
}
EOF
    mv "$TMP_FILE" "$AUTH_FILE"
    echo "[horamind] OpenRouter API key wiped from auth store ($AUTH_FILE)."
else
    echo "[horamind] Auth store not found — nothing to wipe."
fi

# ── 3. Summary ────────────────────────────────────────────────────────────────
echo ""
echo "[horamind] Shutdown complete. API key is no longer on disk."
echo "[horamind] Run './start.sh' (or 'npm start') to restart."
