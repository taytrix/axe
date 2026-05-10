#!/usr/bin/env bash
set -euo pipefail

readonly IMAGE="axe-rig:latest"
readonly VOLUME="axe-conan-install"

cd "$(dirname "$0")/.."

if [[ ! -x dist/axe ]]; then
  echo "dist/axe not found or not executable — run 'bun run compile' first" >&2
  exit 1
fi

exec podman run --rm \
  -v "$PWD/dist/axe:/work/axe:ro,Z" \
  -v "$VOLUME:/srv/conan:Z" \
  "$IMAGE" "$@"
