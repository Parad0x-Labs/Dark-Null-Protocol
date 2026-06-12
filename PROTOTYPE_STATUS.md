# Status

Dark Null Protocol is now a **coherent public devnet repo**, not a split between a toy root and a working side branch.

It is still **not** a finished mainnet product from the public materials alone.

## Devnet Programs (6) — x402 Integration

Six native Solana programs are deployed on devnet and wired into the x402 payment stack:

| Program | Devnet ID | x402 hook |
|---|---|---|
| silent-pay | `9C9F9Y8icd7tsnet4HtQU4LTkQMuAWWXAT97rR2eG6wV` | stealth address per payment |
| fiat-oracle | `DjHQxF5pcZBqZtXX9niFpJsGuAUBs77v4dssuAdyFR4b` | oracle-attested fiat settlement |
| threshold-fed | `C6M8Nuxo1hj9QjPGAfYSXNwkDQEeRVuGZS4FqtjAQuVJ` | k-of-n NULL mint gate |
| accumulator | `7VWjpxe2bBHChzMsqvPS8ZFJBRLaGkWTzM3Wrm36tnBd` | rolling receipt commitment per session |
| inference | `23yVqL6UopoXLv3UihSKQ6EEpuxztWSKcHyKwdC9gM3v` | oracle-attested AI inference receipt |
| payment-stream | `C5uhvm1SUxrZdzKAc3ZDHkVJbmrt7ntjhai6F7QHK6uP` | per-call billing channel for sessions |

Integration layer: [`integration/programs.mjs`](./integration/programs.mjs) (typed JS helpers for all 6), [`integration/x402-hooks.mjs`](./integration/x402-hooks.mjs) (drop-in `onReceiptFinalized` callbacks).

Live demo (all 6 in one agent session): `node scripts/demo-x402-dark-null.mjs`

---

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
- `prepare_phantom_withdraw_v2` is **LIVE and UNAUDITED**: it binds all 8 payout-bound public inputs, verifies the 8-signal NullProofV2 (`circuits/vk.json` `nPublic=8`), and transfers funds on a valid proof — there is no `WithdrawV2CircuitNotPromoted` gate in the current code

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
- the payout-bound v2 circuit (`circuits/vk.json` `nPublic=8`) and its `prepare_phantom_withdraw_v2` payout path are **LIVE but UNAUDITED** — no completed third-party audit covers this money-moving path

## Safe Public Claims

- the root repo now publishes one canonical Groth16 path
- the canonical root artifact set is reproducible and locally verifiable
- historical material is still published, but it is no longer the main integration target
- the repo still does **not** prove audit completion or mainnet release readiness
- the legacy `prepare_phantom_withdraw` (v1) path is fail-closed and does not pay out; the v2 `prepare_phantom_withdraw_v2` path is LIVE and UNAUDITED — it authorizes amount and recipient via the 8-signal proof and pays out, so it must not be described as fail-closed or safely gated

## Unsafe Public Claims

- "audited"
- "safe for mainnet"
- "just switch devnet to mainnet"
- "all historical program IDs are the same deployment"
- "the repo alone proves production security"
