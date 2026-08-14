#!/usr/bin/env bash
#
# Local development stack, without Docker.
#
#   ./infra/scripts/dev-local.sh start     Postgres up, migrations applied
#   ./infra/scripts/dev-local.sh stop      Postgres down
#   ./infra/scripts/dev-local.sh status    Where things are and whether they answer
#
# This runs Postgres directly from Homebrew rather than in a container, for one
# blunt reason: this machine already runs another project's Postgres and Chroma
# on 5432 and 8000. Publishing HoraMind's on the same ports would collide, and
# taking the other project down to test this one is not a trade worth making.
# The cluster below is HoraMind's alone — its own data directory, its own port,
# nothing shared.
#
# The API and the client are deliberately NOT started here. They belong in the
# foreground where their logs are readable and `tsx watch` / Vite can reload:
#
#   set -a && . ./.env && set +a && npm run dev            # API   :8080
#   npm run dev --workspace @horamind/web                  # client:5173

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PG_HOME="${HORAMIND_PG_HOME:-$HOME/.local/share/horamind}"
PGDATA="$PG_HOME/pgdata"
PGLOG="$PG_HOME/postgres.log"
PGPORT=55432

PG_BIN="$(dirname "$(command -v pg_ctl || echo /opt/homebrew/bin/pg_ctl)")"

# Postgres refuses to fork a postmaster that has become multithreaded, and on
# macOS an unset or invalid locale makes libc spawn threads during startup. The
# failure reads as "postmaster became multithreaded during startup", which says
# nothing about locales unless you already know. Pin it.
export LC_ALL=C LANG=C

require_env() {
    if [ ! -f "$REPO_ROOT/.env" ]; then
        echo "No .env at the repository root. Copy .env.example and fill it in:" >&2
        echo "  cp .env.example .env" >&2
        echo "  JWT_SECRET=\$(openssl rand -base64 48)" >&2
        exit 1
    fi
    set -a
    # shellcheck disable=SC1091
    . "$REPO_ROOT/.env"
    set +a

    # psql and createdb read PGPASSWORD, not POSTGRES_PASSWORD. Without this
    # they prompt — and with stdin not a terminal that prompt never resolves,
    # so the script spins instead of failing. `-w` below makes the same
    # mistake fail immediately rather than hang.
    export PGPASSWORD="$POSTGRES_PASSWORD"
}

running() {
    "$PG_BIN/pg_ctl" -D "$PGDATA" status >/dev/null 2>&1
}

start() {
    require_env

    if [ ! -d "$PGDATA/base" ]; then
        echo "Initialising a HoraMind-only cluster at $PGDATA"
        mkdir -p "$PG_HOME"
        umask 077
        printf '%s' "$POSTGRES_PASSWORD" > "$PG_HOME/.initpw"
        # C collation matches the compose file: the app never relies on
        # locale-aware sorting, and C is faster.
        "$PG_BIN/initdb" -D "$PGDATA" -U "$POSTGRES_USER" \
            --pwfile="$PG_HOME/.initpw" --data-checksums \
            --lc-collate=C --lc-ctype=C -E UTF8 --auth=scram-sha-256 >/dev/null
        rm -f "$PG_HOME/.initpw"
    fi

    if running; then
        echo "Postgres already running on :$PGPORT"
    else
        # Loopback only. Nothing here should be reachable from the network.
        "$PG_BIN/pg_ctl" -D "$PGDATA" -l "$PGLOG" -w \
            -o "-p $PGPORT -c listen_addresses=127.0.0.1 -c unix_socket_directories=$PG_HOME" \
            start >/dev/null
        echo "Postgres started on :$PGPORT"
    fi

    if ! "$PG_BIN/psql" -w -h 127.0.0.1 -p "$PGPORT" -U "$POSTGRES_USER" -d postgres \
            -tAc "SELECT 1 FROM pg_database WHERE datname='$POSTGRES_DB'" | grep -q 1; then
        "$PG_BIN/createdb" -w -h 127.0.0.1 -p "$PGPORT" -U "$POSTGRES_USER" "$POSTGRES_DB"
        echo "Created database $POSTGRES_DB"
    fi

    ( cd "$REPO_ROOT" && node db/migrate.mjs )

    echo
    echo "Ready. Start the two processes in their own terminals:"
    echo "  set -a && . ./.env && set +a && npm run dev"
    echo "  npm run dev --workspace @horamind/web"
}

stop() {
    if running; then
        "$PG_BIN/pg_ctl" -D "$PGDATA" -m fast -w stop >/dev/null
        echo "Postgres stopped"
    else
        echo "Postgres was not running"
    fi
}

status() {
    require_env
    if running; then
        echo "postgres  :$PGPORT  up    ($PGDATA)"
    else
        echo "postgres  :$PGPORT  down  ($PGDATA)"
    fi
    for probe in "api      :8080  http://localhost:8080/ready" \
                 "web      :5173  http://localhost:5173/"; do
        url="${probe##* }"
        if curl -fsS --max-time 2 "$url" >/dev/null 2>&1; then
            echo "${probe% *}  up"
        else
            echo "${probe% *}  down"
        fi
    done
}

case "${1:-start}" in
    start)  start  ;;
    stop)   stop   ;;
    status) status ;;
    *) echo "usage: $0 {start|stop|status}" >&2; exit 2 ;;
esac
