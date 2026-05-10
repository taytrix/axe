#!/usr/bin/env bash
set -euo pipefail

readonly IMAGE="axe-rig:latest"
readonly VOLUME="axe-conan-install"

podman rmi "$IMAGE" 2>/dev/null || true
echo "image removed; named volume $VOLUME preserved (use 'podman volume rm $VOLUME' to drop it)"
