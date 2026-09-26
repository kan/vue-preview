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
  src/components/edge/Unresolved.vue \
  src/components/edge/GlobalRegistered.vue \
  src/components/edge/I18nDemo.vue
do
  name=$(basename "$c" .vue)
  docker compose exec -T app "$BIN" render "$c" --root /app --json --out "/out/$name.json"
  docker compose exec -T app "$BIN" render "$c" --root /app --out "/out/$name.html"
  echo "rendered $c"
done
# messages of another locale (REPORT V13)
docker compose exec -T app "$BIN" render src/components/edge/I18nDemo.vue --root /app --locale en --json --out /out/I18nDemo-en.json
echo "rendered src/components/edge/I18nDemo.vue (--locale en)"
# fixture-app without vue-preview.config.json: the config is inferred from src/main.ts (REPORT V8)
docker compose exec -T app sh -c 'rm -rf /tmp/noconfig && mkdir /tmp/noconfig && for f in src node_modules package.json package-lock.json tsconfig.json; do ln -s /app/$f /tmp/noconfig/$f; done'
for c in src/components/UserPage.vue src/components/UserTable.vue src/components/edge/GlobalRegistered.vue; do
  name=$(basename "$c" .vue)
  docker compose exec -T app "$BIN" render "$c" --root /tmp/noconfig --json --out "/out/noconfig-$name.json"
  echo "rendered $c (inferred config)"
done
# ...and without tsconfig.json either: the `@` alias comes from vite.config.ts (REPORT V9)
docker compose exec -T app sh -c 'rm -rf /tmp/viteonly && mkdir /tmp/viteonly && for f in src node_modules package.json package-lock.json vite.config.ts; do ln -s /app/$f /tmp/viteonly/$f; done'
docker compose exec -T app "$BIN" render src/components/UserPage.vue --root /tmp/viteonly --json --out /out/viteonly-UserPage.json
echo "rendered src/components/UserPage.vue (alias from vite.config)"
# the first run installs into the cache, the second reuses it
for c in src/components/UserPage.vue src/components/UserTable.vue; do
  name=$(basename "$c" .vue)
  docker compose --profile bare run --rm -T bare "$BIN" render "$c" --json --out "/out/bare-$name.json"
  echo "rendered $c (dependency cache)"
done
docker compose --profile build run --rm -T bun bun test test/e2e
