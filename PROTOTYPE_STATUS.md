# Status

Dark Null Protocol is now a **coherent public devnet repo**, not a split between a toy root and a working side branch.

It is still **not** a finished mainnet product from the public materials alone.

## What Is Canonical Now

- [`src/lib.rs`](./src/lib.rs) is the promoted root program and contains a real `Groth16Verifier::new(...).verify()` path
- [`src/verifying_key.rs`](./src/verifying_key.rs) is generated from the canonical [`circuits/vk.json`](./circuits/vk.json), not placeholder metadata
- [`circuits/null_proof.circom`](./circuits/null_proof.circom), [`circuits/null_proof_final.zkey`](./circuits/null_proof_final.zkey), and [`circuits/null_proof_js/null_proof.wasm`](./circuits/null_proof_js/null_proof.wasm) are the root artifact set
- [`idl/paradox.json`](./idl/paradox.json) is the canonical public IDL
- [`MANIFEST.json`](./MANIFEST.json) binds the root program ID, source, and proving artifacts into one manifest
- [`tests/canonical-proof-flow.test.mjs`](./tests/canonical-proof-flow.test.mjs) proves the root circuit, zkey, and vk hang together locally
- root updates are now restricted by a dedicated `RootAuthorityConfig` PDA instead of any signer
- leaves, roots, and nullifiers now hard-fail on window exhaustion instead of silently overwriting old entries
- the public root now fails closed on payout instead of minting from proof-unbound `amount` / recipient instruction args

## What Is Still Historical

- [`historical/null-mint`](./historical/null-mint) is the sanitized provenance branch the root was promoted from
- [`historical/root-toy-prototype`](./historical/root-toy-prototype) preserves the earlier public toy-root materials so they stop polluting the main path
- [`LIVE_TEST_RESULTS.md`](./LIVE_TEST_RESULTS.md) and the older full-cycle harnesses remain historical evidence, not the canonical root release story

## What Still Blocks Mainnet-Grade Claims

- no completed third-party audit
- no mainnet deployment manifest
- no public ops/relayer package with production controls
- no proof in this repo that every historical deployment maps to the canonical root files now published
- Merkle root evolution is still computed off-chain and then published by a trusted updater
- the canonical circuit does not yet publish payout-bound public inputs for withdrawal amount and recipient

## Safe Public Claims

- the root repo now publishes one canonical Groth16 path
- the canonical root artifact set is reproducible and locally verifiable
- historical material is still published, but it is no longer the main integration target
- the repo still does **not** prove audit completion or mainnet readiness
- the public root prefers fail-closed payout behavior over pretending the current proof bundle safely authorizes mint amount or recipient

## Unsafe Public Claims

- "audited"
- "mainnet-ready"
- "just switch devnet to mainnet"
- "all historical program IDs are the same deployment"
- "the repo alone proves production security"
