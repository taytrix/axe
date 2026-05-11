#!/usr/bin/env bash
# Wire at: before_restart (consider strict = false; we don't want a Discord
#          warning to abort a restart if the RCON daemon is wedged).
# Effect:  fires a "/broadcast" RCON command to warn players of an incoming
#          restart. axe has no native RCON — you supply the binary path.
#
# Env (required):
#   AXE_ROOT          server root (axe sets this)
#   RCON_BIN          path to your rcon-cli binary (mcrcon, rcon-cli, etc.)
#   RCON_HOST         host:port for the rcon endpoint (e.g. 127.0.0.1:25575)
#   RCON_PASS         the rcon password
# Env (optional):
#   RESTART_NOTICE    message to broadcast; default "Server restarting in 30s"

set -euo pipefail

: "${AXE_ROOT:?AXE_ROOT not set; axe should have set this}"
: "${RCON_BIN:?RCON_BIN not set}"
: "${RCON_HOST:?RCON_HOST not set (host:port)}"
: "${RCON_PASS:?RCON_PASS not set}"

notice="${RESTART_NOTICE:-Server restarting in 30s — back shortly.}"

host="${RCON_HOST%:*}"
port="${RCON_HOST##*:}"

# Adapt the flags to whatever rcon client you actually use.
if ! "${RCON_BIN}" -H "${host}" -P "${port}" -p "${RCON_PASS}" "broadcast ${notice}" >/dev/null; then
    echo "rcon-broadcast: warn — rcon command failed (server may already be down)" >&2
    exit 0   # don't abort the restart on this
fi

echo "rcon-broadcast: '${notice}' sent" >&2
