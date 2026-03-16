# Dark Null Canonical Circuits

This directory now holds the **canonical root artifact set** for the promoted public root.

## Published Files

- `null_proof.circom`
- `null_proof.r1cs`
- `null_proof.sym`
- `null_proof_final.zkey`
- `null_proof_js/null_proof.wasm`
- `null_proof_js/witness_calculator.js`
- `null_proof_js/generate_witness.js`
- `vk.json`
- `vk.bin`
- `package.json`
- `package-lock.json`

## What These Files Prove

- the root repo carries one concrete Groth16 circuit/artifact set
- the root verifier material in [`../src/verifying_key.rs`](../src/verifying_key.rs) is generated from `vk.json`
- the root proof flow is locally reproducible via [`../tests/canonical-proof-flow.test.mjs`](../tests/canonical-proof-flow.test.mjs)

## What They Do Not Prove

- a completed audit
- mainnet readiness
- that every historical result bundle in this repo used this exact artifact set

## Archived Toy Root

The earlier toy public-root artifacts were moved to [`../historical/root-toy-prototype/circuits`](../historical/root-toy-prototype/circuits) so they stop competing with the canonical root path.
