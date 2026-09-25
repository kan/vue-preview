#!/bin/sh
# Build the vue-preview single binary inside the bun container.
set -e
cd "$(dirname "$0")"
docker compose --profile build run --rm bun \
  bun build src/cli.ts --compile --compile-autoload-package-json --target=bun-linux-x64 --outfile /dist/vue-preview
