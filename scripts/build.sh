#!/bin/sh
# Build the vue-preview single binaries inside the bun container -> dist/vue-preview-<target>[.exe]
#   VERSION=v0.1.0 scripts/build.sh                  # all targets
#   TARGETS=linux-x64 scripts/build.sh               # only some
# --compile-autoload-package-json is required: without it the standalone binary
# cannot resolve nested bare imports from the project's node_modules, nor from
# the dependency cache on NODE_PATH (REPORT.md V1 / V7).
set -eu
cd "$(dirname "$0")/.."
VERSION="${VERSION:-dev}"
TARGETS="${TARGETS:-linux-x64 windows-x64 darwin-arm64}"
for target in $TARGETS; do
  out="/dist/vue-preview-$target"
  case "$target" in windows-*) out="$out.exe" ;; esac
  docker compose --profile build run --rm -T bun \
    bun build src/cli.ts --compile --compile-autoload-package-json \
    --target="bun-$target" \
    --define "VUE_PREVIEW_VERSION=\"$VERSION\"" \
    --outfile "$out"
done
