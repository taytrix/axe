#!/usr/bin/env bash
# Wire at: on_drift OR after_sync (or any event you want pinged in Discord)
# Effect:  POSTs a short message describing the event to DISCORD_WEBHOOK_URL.
#
# Env (required):
#   AXE_EVENT             the lifecycle event name (axe sets this)
#   DISCORD_WEBHOOK_URL   target webhook (you set this in axe.service or shell env)
# Env (optional, all set by axe for sync-shape events):
#   AXE_MODS_STALE  AXE_MODS_MISSING_LOCAL  AXE_MODS_MISSING_REMOTE
#   AXE_BUILD_DRIFTED  AXE_BUILD_INSTALLED  AXE_BUILD_LATEST
#   AXE_SYNC_DOWNLOADED  AXE_SYNC_MISSING  AXE_SYNC_MODLIST_CHANGED  (after_sync only)
#   AXE_RESTART_OLD_PID  AXE_RESTART_NEW_PID  (restart events only)

set -euo pipefail

: "${DISCORD_WEBHOOK_URL:?DISCORD_WEBHOOK_URL not set in env}"
: "${AXE_EVENT:?AXE_EVENT not set; axe should have set this}"

case "${AXE_EVENT}" in
    drift)
        msg=":rotating_light: axe: drift detected"
        msg+=" — mods stale=${AXE_MODS_STALE:-0}"
        msg+=" missing_local=${AXE_MODS_MISSING_LOCAL:-0}"
        msg+=" missing_remote=${AXE_MODS_MISSING_REMOTE:-0}"
        msg+=" build_drifted=${AXE_BUILD_DRIFTED:-0}"
        ;;
    after_sync)
        msg=":white_check_mark: axe: sync complete"
        msg+=" — downloaded=${AXE_SYNC_DOWNLOADED:-0}"
        msg+=" missing=${AXE_SYNC_MISSING:-0}"
        msg+=" modlist_changed=${AXE_SYNC_MODLIST_CHANGED:-0}"
        ;;
    after_restart)
        msg=":arrows_counterclockwise: axe: server restarted"
        msg+=" — old_pid=${AXE_RESTART_OLD_PID:-?}"
        msg+=" new_pid=${AXE_RESTART_NEW_PID:-?}"
        ;;
    *)
        msg=":information_source: axe: ${AXE_EVENT}"
        ;;
esac

payload=$(printf '{"content":%s}' "$(printf '%s' "${msg}" | jq -Rs .)")
curl -sS -X POST -H 'Content-Type: application/json' \
    -d "${payload}" "${DISCORD_WEBHOOK_URL}" >/dev/null
