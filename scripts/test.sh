#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

# Backend requires Bun's SQLite and bun:test; extension tests use Node.
bun test --timeout 20000 tests/backend.test.mjs
mapfile -t tests < <(find tests -maxdepth 1 -type f -name '*.test.mjs' ! -name 'backend.test.mjs' | sort)
node --test "${tests[@]}"
