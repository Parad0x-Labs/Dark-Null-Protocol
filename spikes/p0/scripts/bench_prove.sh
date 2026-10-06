#!/bin/sh
# S-PROVER benchmark loops as run on 2026-10-06 (sandbox only; fresh process per run).
# snarkjs: run from the circuit work dir (build/, keys/, out/ from gen_inputs.mjs and snarkjs setup).
# arkworks: ARK=<path to dark-null-p0-tools>; pk files from `dark-null-p0-tools setup <r1cs> <pk.bin>`.
set -e
mkdir -p bench
snark() { # proto circuit zkey vk runs
  for i in $(seq 1 "$5"); do
    node --max-old-space-size=3500 scripts/prove_once.mjs "$1" "build/${2}_js/$2.wasm" "$3" "out/$2.input.json" "$4" \
      | sed "s/^{/{\"circuit\":\"$2\",/" >> bench/prover_snarkjs.jsonl
  done
}
snark groth16 transact_v2_skeleton keys/transact_v2_skeleton_g16.zkey keys/transact_v2_skeleton_g16_vk.json 10
snark groth16 transact_v2_fullsize keys/transact_v2_fullsize_g16.zkey keys/transact_v2_fullsize_g16_vk.json 10
snark groth16 pi_hash keys/pi_hash_g16.zkey keys/pi_hash_g16_vk.json 5
snark plonk pi_hash keys/pi_plonk.zkey keys/pi_hash_plonk_vk.json 5
snark fflonk pi_hash keys/pi_fflonk.zkey keys/pi_hash_fflonk_vk.json 3
snark plonk transact_v2_skeleton keys/skel_plonk.zkey keys/transact_v2_skeleton_plonk_vk.json 3

if [ -n "$ARK" ]; then
  for c in skeleton:skel fullsize:full; do
    n=${c%%:*}; k=${c#*:}
    for th in 4 1; do
      for i in $(seq 1 15); do
        RAYON_NUM_THREADS=$th "$ARK" prove "build/transact_v2_$n.r1cs" "out/transact_v2_$n.wtns" "${k}_pk.bin" \
          | sed "s/^{/{\"circuit\":\"$n\",\"rayon_threads\":$th,/" >> bench/prover_arkworks.jsonl
      done
    done
  done
fi
