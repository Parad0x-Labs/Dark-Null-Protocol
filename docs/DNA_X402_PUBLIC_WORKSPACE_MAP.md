# DNA x402 Public Workspace Map

Dark Null Protocol and DNA x402 are one stack with separate public repositories.

Dark Null Protocol owns the privacy-settlement proof nucleus:

- canonical Groth16 circuit artifacts
- verifier and verifying-key path
- payout-bound withdraw v2
- private x402 receipt envelope
- manifest and release integrity gates
- devnet/localnet network map
- claim and mainnet evidence gates

DNA x402 owns the agent-commerce workspace:

- x402 seller and buyer SDKs
- payment verification, signed receipts, and optional receipt anchoring
- builder and agent launch surfaces
- degen-native paid signal and monetization primitives
- route, fee, receipt, nullifier, and no-custody Rust primitives
- Solana program workspace around receipt anchoring, proof gates, transfer hooks, chaff, and nullifier records

The split prevents two drifting copies of the same code. Dark Null links into DNA for agent commerce; DNA links into Dark Null for private settlement.

## Public DNA x402 Inventory

`Parad0x-Labs/dna-x402` currently publishes:

| Surface | Public path | Count |
|---|---:|---:|
| Cargo workspace members | `Cargo.toml` | 343 |
| Cargo crate entries | `crates/*` entries in `Cargo.toml` | 311 |
| tracked crate directories | `crates/` | 309 |
| Solana program entries | `programs/*` entries in `Cargo.toml` | 10 |
| tracked program directories | `programs/` | 10 |
| TypeScript x402 package | `x402/` | 1 |
| public builder site | `site/` | 1 |
| local agent/admin UI | `site-agent/` | 1 |

## Modules Verified Public In DNA x402

The following local frontier modules are on GitHub under `Parad0x-Labs/dna-x402`:

| Module | Public path |
|---|---|
| `alt-fog-router` | `crates/alt-fog-router/` |
| `dark-poseidon-tree` | `crates/dark-poseidon-tree/` |
| `receipt-spend` | `crates/receipt-spend/` |
| `dark-relay-router` | `crates/dark-relay-router/` |
| `dark-bundle-cloak` | `crates/dark-bundle-cloak/` |
| `swarm-capsule` | `crates/swarm-capsule/` |
| `sealed-fee-quotes` | `crates/sealed-fee-quotes/` |
| `agent-permission-notes` | `crates/agent-permission-notes/` |
| `session-note-channel` | `crates/session-note-channel/` |
| `ritual-memo-capsule` | `crates/ritual-memo-capsule/` |
| `ritual-precompile-braid` | `crates/ritual-precompile-braid/` |
| `spend-shadows` | `crates/spend-shadows/` |
| `receipt-souls` | `crates/receipt-souls/` |
| `no-custody-attestation` | `crates/no-custody-attestation/` |
| `alpha-capsules` | `crates/alpha-capsules/` |
| `chaff-economy` | `crates/chaff-economy/` |
| `dark-x402-nullifier-bridge` | `crates/dark-x402-nullifier-bridge/` |
| `onchain-puzzle-compiler` | `crates/onchain-puzzle-compiler/` |
| `roadmap-commitments` | `crates/roadmap-commitments/` |
| `sealed-pick-x402-wall` | `crates/sealed-pick-x402-wall/` |
| `true-frontier-devnet-demo` | `crates/true-frontier-devnet-demo/` |
| `dark-zk-complete-demo` | `crates/dark-zk-complete-demo/` |
| `agent-flight-recorder` | `crates/agent-flight-recorder/` |
| `dark-stealth-note` | `crates/dark-stealth-note/` |
| `dark_chaff` | `programs/dark_chaff/` |

## Integration Paths

Dark Null to DNA x402:

- `docs/DNA_X402_INTEGRATION.md`
- `docs/PRIVATE_X402_PAYMENTS.md`
- `swarm/x402.mjs`
- `tests/x402-private-payments.test.mjs`

DNA x402 to Dark Null:

- `docs/DARK_NULL_PRIVACY_PATH.md`
- `docs/DARK_NULL_FRONTIER.md`
- `docs/DARK_NULL_FRONTIER_RESEARCH.md`
- `crates/dark-x402-nullifier-bridge/`
- `crates/dark-private-x402/`
- `crates/dark-x402-core/`
- `crates/dark-x402-devnet-verify/`

## Validation Snapshot

Local validation on 2026-05-27:

- Dark Null `npm run test:all` passed.
- DNA x402 `npm run check:style` passed.
- DNA x402 `npm --prefix x402 run security:scan` passed.
- DNA x402 `npm --prefix x402 run build` passed.
- DNA x402 `npm --prefix x402 test` passed: 264 files passed, 5 skipped; 1429 tests passed, 8 skipped.
- DNA x402 `npm run acceptance:builder` passed.
- DNA x402 `npm run acceptance:agents` passed.
- DNA x402 `npm run acceptance:degen-mode` passed.
- DNA x402 `cargo test --workspace --locked` passed through the local `G:` Rust toolchain.
