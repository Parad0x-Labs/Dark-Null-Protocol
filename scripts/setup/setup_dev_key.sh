#!/bin/sh
# dev-setup Groth16 key for transact_v2 on PPoT ppot_0080_16 (sandbox only; node container, network off).
#
# dev-setup = one phase-2 contribution by one operator, entropy from /dev/urandom, not recorded. The operator of
# such a phase 2 can forge proofs (DESIGN 8.1), so the key is devnet only and is labelled `dev-setup` in
# MANIFEST.json. It is not a ceremony.
#
# Usage: setup_dev_key.sh <repo_root> <build_dir> <ptau>
#   <build_dir> holds transact_v2.r1cs from build_circuit.sh; writes transact_v2_dev.zkey, vk.json and
#   <repo_root>/programs/dark-null-pool-v2/src/vk.rs.
set -eu
ROOT=$1; B=$2; PTAU=$3
SNARKJS="node --max-old-space-size=3000 $ROOT/circuits/v2/node_modules/snarkjs/build/cli.cjs"
PTAU_SHA=ed3622a7c79b0b49aadd134ebbc5b77df8c8c59bccebdfd0d9bf2c1a51561cf9

got=$(sha256sum "$PTAU" | cut -d' ' -f1)
[ "$got" = "$PTAU_SHA" ] || { echo "ptau hash $got != $PTAU_SHA" >&2; exit 1; }

$SNARKJS groth16 setup "$B/transact_v2.r1cs" "$PTAU" "$B/transact_v2_0000.zkey"
ENTROPY=$(head -c 64 /dev/urandom | od -An -tx1 | tr -d ' \n')
$SNARKJS zkey contribute "$B/transact_v2_0000.zkey" "$B/transact_v2_dev.zkey" \
  --name="dark-null transact_v2 dev-setup (single operator, devnet only)" -e="$ENTROPY" -v
unset ENTROPY
rm -f "$B/transact_v2_0000.zkey"
$SNARKJS zkey verify "$B/transact_v2.r1cs" "$PTAU" "$B/transact_v2_dev.zkey"
$SNARKJS zkey export verificationkey "$B/transact_v2_dev.zkey" "$B/vk.json"
mkdir -p "$ROOT/programs/dark-null-pool-v2/src"
node "$ROOT/scripts/setup/gen_vk_rs.mjs" "$B/vk.json" "$ROOT/programs/dark-null-pool-v2/src/vk.rs"
