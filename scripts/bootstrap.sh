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
  printf '==> FULL_VALIDATION=1, running Python and Rust checks when available\n'
  if command -v python3 >/dev/null 2>&1; then
    npm run test:python
    if python3 - <<'PY' >/dev/null 2>&1
import pytest
import solders
import solana
PY
    then
      npm run test:python:unit
    else
      printf '==> Python unit-test dependencies not installed, skipping pytest suite\n'
    fi
  else
    printf '==> python3 not found, skipping Python check\n'
  fi

  if command -v cargo >/dev/null 2>&1; then
    npm run test:rust
  else
    printf '==> cargo not found, skipping Rust check\n'
  fi
fi

printf '==> Complete\n'
printf '==> Start with README.md and docs/getting-started.md\n'
