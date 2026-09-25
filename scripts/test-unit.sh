#!/bin/sh
# Unit tests (no Vue needed) inside the bun container.
set -eu
cd "$(dirname "$0")/.."
docker compose --profile build run --rm -T bun bun test test/unit
