#!/bin/sh
# Build the vue-preview single binary inside the bun container -> dist/vue-preview
#   VERSION=v0.1.0 scripts/build.sh
# --compile-autoload-package-json is required: without it the standalone binary
# cannot resolve nested bare imports from the project's node_modules (REPORT.md V1).
set -eu
cd "$(dirname "$0")/.."
VERSION="${VERSION:-dev}"
docker compose --profile build run --rm -T bun \
  bun build src/cli.ts --compile --compile-autoload-package-json \
  --target=bun-linux-x64 \
  --define "VUE_PREVIEW_VERSION=\"$VERSION\"" \
  --outfile /dist/vue-preview
