#!/bin/bash

set -e

echo "Setting up canonical Dark Null circuit artifacts..."

if ! command -v circom >/dev/null 2>&1; then
  echo "Circom not found. Install it first."
  exit 1
fi

if ! command -v snarkjs >/dev/null 2>&1; then
  echo "SnarkJS not found. Install it first."
  exit 1
fi

circom null_proof.circom --r1cs --wasm --sym
snarkjs groth16 setup null_proof.r1cs pot12_final.ptau null_proof_final.zkey
snarkjs zkey export verificationkey null_proof_final.zkey vk.json

echo "Generated:"
echo "  - null_proof.r1cs"
echo "  - null_proof_js/"
echo "  - null_proof_final.zkey"
echo "  - vk.json"
