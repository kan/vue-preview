#!/bin/sh
# End-to-end: render fixture-app components with the built binary inside the
# node:22 app container, then assert on the JSON output in the bun container.
# Also render in the `bare` container (no node_modules) to exercise the dependency cache.
# Prerequisites: scripts/build.sh, `docker compose up -d app`, `docker compose exec app npm ci`.
set -eu
cd "$(dirname "$0")/.."
BIN=/opt/vue-preview/vue-preview-linux-x64
for c in \
  src/components/UserTable.vue \
  src/components/EditDialog.vue \
  src/components/UserPage.vue \
  src/components/edge/PlaceholderDemo.vue \
  src/components/edge/CircularA.vue \
  src/components/edge/Unresolved.vue
do
  name=$(basename "$c" .vue)
  docker compose exec -T app "$BIN" render "$c" --root /app --json --out "/out/$name.json"
  docker compose exec -T app "$BIN" render "$c" --root /app --out "/out/$name.html"
  echo "rendered $c"
done
# the first run installs into the cache, the second reuses it
for c in src/components/UserPage.vue src/components/UserTable.vue; do
  name=$(basename "$c" .vue)
  docker compose --profile bare run --rm -T bare "$BIN" render "$c" --json --out "/out/bare-$name.json"
  echo "rendered $c (dependency cache)"
done
docker compose --profile build run --rm -T bun bun test test/e2e
