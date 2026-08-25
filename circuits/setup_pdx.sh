#!/bin/bash

set -euo pipefail

# Canonical Dark Null circuit setup (audit H2 hardened).
#
# SECURITY: a single-party `groth16 setup` leaves toxic waste in
# null_proof_final.zkey — whoever ran it can forge proofs forever. This script
# therefore (a) verifies the powers-of-tau file against a pinned SHA-256, and
# (b) applies at least one phase-2 contribution plus the beacon so the final
# zkey is safe as long as ONE contributor deleted their secret. For mainnet,
# run a real multi-party ceremony per CEREMONY.md.

PTAU="${PTAU:-pot12_final.ptau}"
# Pin the expected SHA-256 of the ptau here once downloaded from the official
# snarkjs ceremony distribution. Leave empty to skip verification (dev only).
EXPECTED_PTAU_SHA256="${EXPECTED_PTAU_SHA256:-}"

echo "Setting up canonical Dark Null circuit artifacts..."

for tool in circom snarkjs; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "$tool not found. Install it first."
    exit 1
  fi
done

if [ -n "$EXPECTED_PTAU_SHA256" ]; then
  echo "Verifying $PTAU against pinned SHA-256..."
  echo "$EXPECTED_PTAU_SHA256  $PTAU" | shasum -a 256 -c -
else
  echo "WARNING: EXPECTED_PTAU_SHA256 not set — skipping ptau integrity check."
fi

circom null_proof.circom --r1cs --wasm --sym

echo "Phase 1: groth16 setup (produces toxic waste)..."
snarkjs groth16 setup null_proof.r1cs "$PTAU" null_proof_0.zkey

echo "Phase 2: applying deterministic beacon + local contribution..."
snarkjs zkey beacon null_proof_0.zkey null_proof_1.zkey 0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f 10
snarkjs zkey contribute null_proof_1.zkey null_proof_final.zkey \
  --name="local contributor" -v -e="$(head -c 64 /dev/urandom | xxd -p -c 64)"

echo "Verifying final zkey..."
snarkjs zkey verify null_proof.r1cs "$PTAU" null_proof_final.zkey

rm -f null_proof_0.zkey null_proof_1.zkey

snarkjs zkey export verificationkey null_proof_final.zkey vk.json

echo "Generated:"
echo "  - null_proof.r1cs"
echo "  - null_proof_js/"
echo "  - null_proof_final.zkey"
echo "  - vk.json"
echo ""
echo "NOTE: after regenerating the zkey/vk you MUST regenerate src/verifying_key.rs"
echo "(npm run vk:sync or scripts/generate-verifying-key.mjs) and redeploy — the"
echo "on-chain verifier pins the old key."
