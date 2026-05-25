#!/usr/bin/env sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$ROOT_DIR"

printf '==> Dark Null public bootstrap\n'

if [ "${SKIP_INSTALL:-0}" = "1" ]; then
  printf '==> SKIP_INSTALL=1, skipping npm install\n'
else
  printf '==> Installing npm dependencies\n'
  npm install
fi

printf '==> Running public repo checks and SDK tests\n'
npm test

if [ "${FULL_VALIDATION:-0}" = "1" ]; then
  printf '==> FULL_VALIDATION=1, running the cumulative validation lane\n'
  npm run test:all
fi

printf '==> Complete\n'
printf '==> Start with README.md and docs/getting-started.md\n'
