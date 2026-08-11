#!/usr/bin/env bash
#
# Verify a HoraMind tunnel can be created without disturbing the one this
# machine already runs for another application.
#
#   ./infra/scripts/tunnel-preflight.sh [tunnel-name] [hostname]
#
# Checks only. Nothing is created, changed or deleted — the commands to run are
# printed for you to execute yourself, so nothing happens to an existing tunnel
# on the strength of a script's assumptions.

set -euo pipefail

TUNNEL_NAME="${1:-horamind}"
HOSTNAME_ARG="${2:-astrology.harieshwar.dev}"

bold() { printf '\033[1m%s\033[0m\n' "$1"; }
warn() { printf '\033[33m!! %s\033[0m\n' "$1"; }
ok()   { printf '\033[32mok\033[0m %s\n' "$1"; }
fail() { printf '\033[31mXX %s\033[0m\n' "$1"; }

bold "Cloudflare tunnel preflight"
echo "  tunnel name : ${TUNNEL_NAME}"
echo "  hostname    : ${HOSTNAME_ARG}"
echo

if ! command -v cloudflared >/dev/null 2>&1; then
    fail "cloudflared is not installed."
    echo "   https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/"
    exit 1
fi
ok "cloudflared present ($(cloudflared --version 2>&1 | head -1))"

if ! cloudflared tunnel list >/dev/null 2>&1; then
    fail "Not logged in. Run: cloudflared tunnel login"
    exit 1
fi
ok "authenticated to Cloudflare"

echo
bold "Tunnels that already exist on this account"
cloudflared tunnel list || true
echo

# The important check. Reusing a name would attach HoraMind's ingress rules to
# a tunnel another application depends on.
if cloudflared tunnel list --output json 2>/dev/null | grep -q "\"name\":\"${TUNNEL_NAME}\""; then
    warn "A tunnel named '${TUNNEL_NAME}' already exists."
    warn "Pick a different name, or confirm this one is HoraMind's and reuse its UUID."
    warn "Do NOT point it at another app's config."
    exit 1
fi
ok "the name '${TUNNEL_NAME}' is free"

# The other app's config lives here on most installs. We never touch it, but
# knowing it exists explains why --config is passed explicitly everywhere.
DEFAULT_CFG="${HOME}/.cloudflared/config.yml"
if [ -f "${DEFAULT_CFG}" ]; then
    warn "Another tunnel config exists at ${DEFAULT_CFG}."
    warn "HoraMind never reads or writes it — the container always passes"
    warn "--config /etc/cloudflared/config.yml explicitly."
else
    ok "no default config present"
fi

cat <<EOF

$(bold "Next steps — run these yourself")

  1. Create the tunnel (prints a UUID and writes a credentials file):

     cloudflared tunnel create ${TUNNEL_NAME}

  2. Copy the credentials next to the compose file:

     cp ~/.cloudflared/<UUID>.json infra/docker/cloudflared/creds.json

  3. Route the hostname. This adds ONE CNAME and cannot affect records
     belonging to the other tunnel:

     cloudflared tunnel route dns ${TUNNEL_NAME} ${HOSTNAME_ARG}

  4. Fill in infra/docker/cloudflared/config.yml (copy the .example) and set
     CF_TUNNEL_ID and CF_HOSTNAME in .env.

  5. Start it alongside the stack:

     docker compose -f infra/docker/docker-compose.yml --profile tunnel up -d

$(bold "To verify both tunnels are healthy afterwards")

     cloudflared tunnel list
     docker compose -f infra/docker/docker-compose.yml logs -f cloudflared

EOF
