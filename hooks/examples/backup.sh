#!/usr/bin/env bash
# Wire at: before_sync (strict = true if you want sync to abort on backup failure)
# Effect:  tar -czf <BACKUP_DIR>/saved-<timestamp>.tar.gz <AXE_ROOT>/ConanSandbox/Saved/
#
# Env (required):
#   AXE_ROOT         server root (axe sets this)
# Env (optional):
#   BACKUP_DIR       where to write the tar; default <AXE_ROOT>/backups
#   BACKUP_KEEP      how many tarballs to keep; default 14 (older are deleted)

set -euo pipefail

: "${AXE_ROOT:?AXE_ROOT not set; axe should have set this}"
BACKUP_DIR="${BACKUP_DIR:-${AXE_ROOT}/backups}"
BACKUP_KEEP="${BACKUP_KEEP:-14}"

mkdir -p "${BACKUP_DIR}"
stamp=$(date -u +%Y%m%dT%H%M%SZ)
out="${BACKUP_DIR}/saved-${stamp}.tar.gz"

cd "${AXE_ROOT}"
if [[ ! -d ConanSandbox/Saved ]]; then
    echo "backup: nothing to do (no ConanSandbox/Saved/ yet)" >&2
    exit 0
fi

tar -czf "${out}.tmp" ConanSandbox/Saved/
mv "${out}.tmp" "${out}"
echo "backup: wrote ${out}" >&2

# Prune old tarballs, keeping the most recent BACKUP_KEEP.
ls -1t "${BACKUP_DIR}"/saved-*.tar.gz 2>/dev/null \
    | tail -n +"$((BACKUP_KEEP + 1))" \
    | xargs -r rm --
