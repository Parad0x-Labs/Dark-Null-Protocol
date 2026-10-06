#!/bin/bash
# B1 native prover runs (PLAN_2027 gate B1): native C++ witness + arkworks Groth16 with the dev-setup zkey.
# Fresh processes per run; 5 runs per V-E2E step per thread count. Prints one JSON line per run.
# Usage: b1_native.sh <dir with transact_v2 (+ .dat)> <dark-null-circuit-tools> <zkey> <inputs dir> [runs per step]
set -eu
WDIR=$1; TOOL=$2; ZKEY=$3; IN=$4; RUNS=${5:-5}
TMP=$(mktemp -d)
for th in 4 1; do
  for s in deposit transfer withdraw; do
    for r in $(seq 1 "$RUNS"); do
      t0=$(date +%s%N)
      ( cd "$WDIR" && ./transact_v2 "$IN/e2e_$s.json" "$TMP/w.wtns" >/dev/null )
      t1=$(date +%s%N)
      p=$(RAYON_NUM_THREADS=$th "$TOOL" prove "$ZKEY" "$TMP/w.wtns")
      t2=$(date +%s%N)
      wit_ms=$(( (t1 - t0) / 1000 )); tot_ms=$(( (t2 - t0) / 1000 ))
      echo "{\"step\":\"$s\",\"rayon_threads\":$th,\"run\":$r,\"witness_us\":$wit_ms,\"end_to_end_us\":$tot_ms,${p#\{}"
    done
  done
done
rm -rf "$TMP"
