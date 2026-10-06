#!/bin/bash
# Native (C++) witness generator runs: valid V-E2E inputs produce a witness, W1-W17 are refused, and timing for B1.
# Runs where the generator was built (scripts/setup/build_native_witness.sh). Network off.
# Usage: native_witness.sh <transact_v2 binary dir> <inputs dir from write_inputs.mjs> <out dir> [runs per step]
# Writes <out>/e2e_<step>.wtns and prints one JSON line per run.
set -u
ulimit -c 0
BIN=$1/transact_v2; IN=$2; OUT=$3; RUNS=${4:-15}
mkdir -p "$OUT"
cd "$1"   # the generator reads transact_v2.dat from its own directory
for s in deposit transfer withdraw; do
  for r in $(seq 1 "$RUNS"); do
    t0=$(date +%s%N)
    "$BIN" "$IN/e2e_$s.json" "$OUT/e2e_$s.wtns" >/dev/null 2>&1; rc=$?
    t1=$(date +%s%N)
    echo "{\"kind\":\"native_witness\",\"step\":\"$s\",\"run\":$r,\"exit\":$rc,\"ms\":$(( (t1 - t0) / 1000 )).0}" | sed 's/\([0-9]*\)\([0-9]\{3\}\)\.0}/\1.\2}/'
  done
done
for f in "$IN"/W*.json; do
  id=$(basename "$f" .json)
  ( "$BIN" "$f" "$OUT/$id.wtns" >"$OUT/$id.log" 2>&1 ); rc=$?
  err=$(grep -m1 -o "Failed assert in template/function [A-Za-z0-9_]* line [0-9]*" "$OUT/$id.log" | tr -d '"')
  echo "{\"kind\":\"native_tampered\",\"id\":\"$id\",\"exit\":$rc,\"rejected\":$([ $rc -ne 0 ] && echo true || echo false),\"error\":\"$err\"}"
  rm -f "$OUT/$id.wtns" "$OUT/$id.log"
done
