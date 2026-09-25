#!/bin/sh
# End-to-end: render fixture-app components with the built binary inside the
# node:22 app container, then assert on the JSON output in the bun container.
# Prerequisites: scripts/build.sh, `docker compose up -d app`, `docker compose exec app npm ci`.
set -eu
cd "$(dirname "$0")/.."
for c in \
  src/components/UserTable.vue \
  src/components/EditDialog.vue \
  src/components/UserPage.vue \
  src/components/edge/PlaceholderDemo.vue \
  src/components/edge/CircularA.vue \
  src/components/edge/Unresolved.vue
do
  name=$(basename "$c" .vue)
  docker compose exec -T app /opt/vue-preview/vue-preview render "$c" --root /app --json --out "/out/$name.json"
  docker compose exec -T app /opt/vue-preview/vue-preview render "$c" --root /app --out "/out/$name.html"
  echo "rendered $c"
done
docker compose --profile build run --rm -T bun bun test test/e2e
