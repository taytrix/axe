#!/usr/bin/env bash
# Wire at: before_sync
# Effect:  copies <AXE_ROOT>/ConanSandbox/Mods/modlist.txt to a timestamped
#          snapshot under <AXE_ROOT>/.axe/modlist-snapshots/.
#
# Useful for: rolling back a bad sync by hand — `cp <snap> modlist.txt`.
#
# Env (required):
#   AXE_ROOT          server root (axe sets this)
# Env (optional):
#   SNAPSHOT_KEEP     how many snapshots to keep; default 30

set -euo pipefail

: "${AXE_ROOT:?AXE_ROOT not set; axe should have set this}"
SNAPSHOT_KEEP="${SNAPSHOT_KEEP:-30}"

src="${AXE_ROOT}/ConanSandbox/Mods/modlist.txt"
dir="${AXE_ROOT}/.axe/modlist-snapshots"

if [[ ! -f "${src}" ]]; then
    echo "modlist-snapshot: no modlist.txt at ${src}, nothing to do" >&2
    exit 0
fi

mkdir -p "${dir}"
stamp=$(date -u +%Y%m%dT%H%M%SZ)
out="${dir}/modlist-${stamp}.txt"
cp -- "${src}" "${out}"
echo "modlist-snapshot: wrote ${out}" >&2

ls -1t "${dir}"/modlist-*.txt 2>/dev/null \
    | tail -n +"$((SNAPSHOT_KEEP + 1))" \
    | xargs -r rm --
