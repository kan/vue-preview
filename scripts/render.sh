#!/bin/sh
# Render a component inside the app container and summarise the result:
#   scripts/render.sh src/components/UserPage.vue [extra args]
# Writes out/<Name>.json and out/<Name>.html.
set -eu
cd "$(dirname "$0")/.."
name=$(basename "$1" .vue)
docker compose exec -T app /opt/vue-preview/vue-preview render "$@" --root /app --json --out "/out/$name.json"
python3 - "out/$name.json" "out/$name.html" <<'PY'
import json, sys
d = json.load(open(sys.argv[1]))
open(sys.argv[2], 'w').write(d['html'])
print('warnings:', json.dumps(d['warnings'], ensure_ascii=False, indent=1))
print('deps:', d['deps'])
print('timings:', d['timings'], 'tailwind:', d['tailwind'])
PY
