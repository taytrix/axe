#!/usr/bin/env bash
set -euo pipefail

readonly IMAGE="axe-rig:latest"
readonly VOLUME="axe-conan-install"

cd "$(dirname "$0")/.."

podman volume create --ignore "$VOLUME" >/dev/null
podman build -t "$IMAGE" -f Containerfile .

cat <<EOF
rig built: $IMAGE
volume:    $VOLUME (persists across runs)

next:
  bun run compile
  ./scripts/rig-smoke.sh version
EOF
