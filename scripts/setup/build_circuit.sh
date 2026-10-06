#!/bin/sh
# Compile circuits/v2/transact_v2.circom with the official circom release (sandbox only).
# Runs in a linux/amd64 glibc container (the release binary is x86_64; on an arm64 VM it runs under emulation).
#
# Usage: build_circuit.sh <repo_root> <circom_binary> <node_modules_dir> <out_dir> [circuit.circom]
#   circom binary: v2.2.3 circom-linux-amd64, SHA-256 85342c7ff332d948df7c0c50ecf201e6129349aef550ce873f3c811b79fe53a3
#   (GitHub release asset digest; fetch with scripts/setup/fetch_pinned.mjs).
# Outputs in <out_dir>: transact_v2.r1cs, transact_v2.sym, transact_v2_js/ (WASM witness), transact_v2_cpp/
# (native C++ witness sources, --no_asm so they build on arm64 and x86_64), inspect.log.
set -eu
ROOT=$1; CIRCOM=$2; NM=$3; OUT=$4; SRC=${5:-$ROOT/circuits/v2/transact_v2.circom}
CIRCOM_SHA=85342c7ff332d948df7c0c50ecf201e6129349aef550ce873f3c811b79fe53a3

got=$(sha256sum "$CIRCOM" | cut -d' ' -f1)
[ "$got" = "$CIRCOM_SHA" ] || { echo "circom binary hash $got != $CIRCOM_SHA" >&2; exit 1; }
"$CIRCOM" --version
mkdir -p "$OUT"
# --inspect reports signals that are not fully constrained; its log is kept next to the build.
"$CIRCOM" "$SRC" --O2 --r1cs --wasm --sym --c --no_asm --inspect -l "$NM" -o "$OUT" 2>&1 | tee "$OUT/inspect.log"
