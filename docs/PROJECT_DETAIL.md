# Dark Null Protocol: project detail

This page holds the detail that used to live in the top-level [`README.md`](../README.md). Nothing here changes a status: where any doc differs, [`MANIFEST.json`](../MANIFEST.json) and [`PROGRAM_IDS.md`](./PROGRAM_IDS.md) are authoritative.

## Proven on devnet, reproducible against the deployed program

The payout below is a landed devnet transaction on the canonical program `35GMe13…`. The two rejections are reproduced by the script further down against the same deployed program; they are rejected at preflight, so no failed transaction is recorded on-chain.

- **Working on-chain withdraw.** A real snarkjs Groth16 proof against the published circuit was verified by the on-chain BN254 verifier and the vault paid out: tx [`3wXv6wGS5t7fu2F18ZVGPiSkbJcGA16mftZec7LDHq5wTvZBc4ezb44kuUw97BPXrwYXyoSF42MPKrbuJJM6n2nU`](https://explorer.solana.com/tx/3wXv6wGS5t7fu2F18ZVGPiSkbJcGA16mftZec7LDHq5wTvZBc4ezb44kuUw97BPXrwYXyoSF42MPKrbuJJM6n2nU?cluster=devnet).
- **The vault rejects an over-claim.** An over-claim withdrawal (proof over 2x the funded amount) was submitted against the deployed program; the solvency guard reverted it with custom error 6013 `InsufficientCommittedDeposit`.
- **Replay is dead.** Re-submitting the spent note fails with error 6000 `DoubleSpend`.
- **Seven programs deployed on devnet**: all devnet-scoped until the mainnet gates clear: the root program plus six integration programs (silent-pay, payment-stream, threshold-fed, fiat-oracle, accumulator, inference), all deployed from this exact source tree.

Reproduce the whole cycle yourself:

```bash
node scripts/ox_atomic.mjs withdraw attack    # expect REJECTED 6013
node scripts/ox_atomic.mjs withdraw payout    # expect WITHDRAW_OK + payout
```

## What makes it different

- **Payout-bound proofs.** `prepare_phantom_withdraw_v2` binds amount, receiver token account, and mint into the proof's public signals. A valid proof for someone else's destination is worthless to you.
- **Solvency enforced on-chain.** Every commitment carries its funded amount; withdrawals above what was actually deposited revert. No trust required.
- **Privacy boundary stated and tested.** Amount, receiver token account, mint and note commitment are public, so a withdrawal is linkable to its deposit in the current construction; [`PRIVACY_PROPERTIES.md`](./PRIVACY_PROPERTIES.md) lists each property with the test that checks it.
- **Evidence density.** Root verifier, circuit artifacts, zkey, wasm, vk, manifest, IDL, SDK, and reproducible proof tests are published together, hash-bound through [`MANIFEST.json`](../MANIFEST.json).

**Search tags:** `solana`, `zk-snarks`, `zero-knowledge proofs`, `groth16`, `circom`, `bn254`, `privacy payments`, `anchor`, `snarkjs`, `solana program`

## Why it matters

Money on a blockchain is public by default: anyone can see who paid whom, and how much. Dark Null is research toward private settlement on Solana. Its root program is a devnet prototype for proof-verified withdrawals; the payout fields (amount, receiver token account, mint) and the note commitment are public, so a withdrawal is linkable to its deposit in the current construction. Unlinkable withdrawals are planned protocol work.

- **Proof-verified payouts.** The vault pays only after an on-chain Groth16 verifier accepts the withdrawal proof.
- **Private receipt primitives.** [`swarm/x402.mjs`](../swarm/x402.mjs) wraps DNA x402 signed receipts without storing raw resource URLs or payment headers (local prototype).
- **Still verifiable.** Circuits, keys, tests and the privacy property matrix are published, so each claim can be checked.

## How this fits the Parad0x stack

Parad0x Labs builds Web0 on Solana: money and agents that settle themselves. Dark Null is the privacy research layer next to the x402 rail; its root program verifies Groth16 withdrawal proofs on devnet, with the payout fields public.

| Layer | Repo | Does |
|---|---|---|
| Payments | [dna-x402](https://github.com/Parad0x-Labs/dna-x402) | x402 rail: quote, pay, verify, receipt, anchor |
| Build | dna-x402-builders (private repository) | Hosted kit: turn any API/bot into a paid agent |
| Privacy | **Dark-Null-Protocol** (this repo) | Groth16 proof-verified withdrawals (devnet prototype), published proofs |
| Data | liquefy (private repository) | Columnar compression |
| Audit trail | [liquefy-openclaw-integration](https://github.com/Parad0x-Labs/liquefy-openclaw-integration) | Flight recorder: 24 engines + Solana-anchored audit trails |
| Media | nebula-media (private repository) | Proof-carrying media compression, scene-aware, with on-chain receipts |
| Runtime | [VOOL](https://github.com/Parad0x-Labs/vool) | Daily-user AI runtime, local-first, cloud when you choose |

Project site: **[parad0xlabs.com](https://parad0xlabs.com)**. The canonical deployment inventory for the Parad0x Labs program set is available to reviewers on request.

## Market position

Dark Null is the compact, evidence-first Solana privacy research track:

- `256-byte` current `groth16-solana` verifier ABI
- `128-byte` compressed proof target
- canonical artifact manifest with stable hash checks
- reproducible Groth16 proof flow
- explicit trusted-setup evidence with a mainnet blocker until final setup evidence exists
- payout-bound v2 withdraw path proving amount, receiver token account, and mint
- public launch gate that blocks unsupported mainnet claims
- stated privacy boundary: withdrawals are linkable to deposits in the current construction ([`PRIVACY_PROPERTIES.md`](./PRIVACY_PROPERTIES.md))

For launch copy and positioning, read [`LAUNCH_NARRATIVE.md`](./LAUNCH_NARRATIVE.md). For the release gate, read [`MAINNET_READINESS.md`](./MAINNET_READINESS.md) and [`MAINNET_RUNBOOK.md`](./MAINNET_RUNBOOK.md).
For the delivered-vs-blocked claim boundary, read [`CLAIMS_LEDGER.md`](./CLAIMS_LEDGER.md).
For external review, use the single handoff packet in [`AUDITOR_HANDOFF.md`](./AUDITOR_HANDOFF.md).
For the gated mainnet beta procedure, read [`MAINNET_OPEN_BETA.md`](./MAINNET_OPEN_BETA.md). No Dark Null program is deployed on mainnet today; the canonical program is on devnet.
For off-chain service operations and the x402 receipt boundary, read [`OFFCHAIN_SWARM.md`](./OFFCHAIN_SWARM.md), [`DNA_X402_INTEGRATION.md`](./DNA_X402_INTEGRATION.md), and [`PRIVATE_X402_PAYMENTS.md`](./PRIVATE_X402_PAYMENTS.md).
For the public DNA x402 workspace map, read [`DNA_X402_PUBLIC_WORKSPACE_MAP.md`](./DNA_X402_PUBLIC_WORKSPACE_MAP.md).
For frontier work, read [`2030_PRIMITIVES.md`](./2030_PRIMITIVES.md).

## Bootstrap and network selection

```bash
sh scripts/bootstrap.sh
```

That installs npm dependencies and runs the public repo checks. For the extended validation path:

```bash
FULL_VALIDATION=1 sh scripts/bootstrap.sh
```

Canonical network selection:

```bash
npm run config:devnet
npm run config:localnet
npm run config:json:devnet   # machine-readable output
```

Canonical defaults also live in [`.env.example`](../.env.example).

## JavaScript SDK

The SDK (package name `@dark-null/protocol`) is used from a clone of this repository; it is not published to the npm registry. Entry points: [`sdk/index.mjs`](../sdk/index.mjs) and [`sdk/index.d.ts`](../sdk/index.d.ts).

```bash
git clone https://github.com/Parad0x-Labs/Dark-Null-Protocol
cd Dark-Null-Protocol
sh scripts/bootstrap.sh
```

For Anchor-based integrations, add `@coral-xyz/anchor` and `@solana/web3.js` to your own project.

## What is canonical

| Area | Root path |
|---|---|
| Program binding | [`MANIFEST.json`](../MANIFEST.json), [`Anchor.toml`](../Anchor.toml), [`src/lib.rs`](../src/lib.rs) |
| Network config | [`NETWORKS.json`](../NETWORKS.json), [`.env.example`](../.env.example), [`scripts/network-config.mjs`](../scripts/network-config.mjs) |
| Verifier | [`src/verifying_key.rs`](../src/verifying_key.rs), [`circuits/vk.json`](../circuits/vk.json) |
| Circuit artifacts | [`circuits/null_proof.circom`](../circuits/null_proof.circom), [`circuits/null_proof_final.zkey`](../circuits/null_proof_final.zkey), [`circuits/null_proof_js/null_proof.wasm`](../circuits/null_proof_js/null_proof.wasm) |
| Proof encoding | 256-byte current `groth16-solana` verifier ABI; 128-byte compressed proof target |
| Private x402 receipts | [`swarm/x402.mjs`](../swarm/x402.mjs), [`PRIVATE_X402_PAYMENTS.md`](./PRIVATE_X402_PAYMENTS.md), DNA signed-receipt wrapper |
| Auditor handoff | [`AUDITOR_HANDOFF.md`](./AUDITOR_HANDOFF.md) |
| Trusted setup evidence | [`CEREMONY.md`](../CEREMONY.md), [`scripts/check-ceremony-evidence.mjs`](../scripts/check-ceremony-evidence.mjs) |
| Public IDL | [`idl/paradox.json`](../idl/paradox.json) |
| JavaScript SDK | [`sdk/index.mjs`](../sdk/index.mjs), [`sdk/index.d.ts`](../sdk/index.d.ts) |
| Python helper client | [`client/dark_client.py`](../client/dark_client.py) |
| Canonical proof-flow test | [`tests/canonical-proof-flow.test.mjs`](../tests/canonical-proof-flow.test.mjs) |

### Devnet deployment

Integrate against this devnet program set:

| Generation | Root program | Integration programs | Status |
|---|---|---|---|
| Current (since 2026-08-25) | `35GMe13ExGB1JGp1wZGrEvHfQnENKADroDQApeziKuwV`, matches `declare_id!` in [`src/lib.rs`](../src/lib.rs), [`MANIFEST.json`](../MANIFEST.json), [`NETWORKS.json`](../NETWORKS.json), [`Anchor.toml`](../Anchor.toml); upgrade authority `4cTBfB8v…` | silent-pay `2FvaRhp…`, payment-stream `EduZQkG…`, threshold-fed `CjcnLYP1…`, fiat-oracle `3VQsCtr…`, accumulator `FX2YSq6…`, inference `GSkQrJ8…` | Canonical devnet root; integration target |

Where any doc differs, `MANIFEST.json` and [`PROGRAM_IDS.md`](./PROGRAM_IDS.md) are authoritative.

## What is historical

| Area | Historical path |
|---|---|
| Archived toy public root | [`historical/root-toy-prototype`](../historical/root-toy-prototype) |

## What this repo does prove

- a real Groth16 verifier path is published in the root
- the root circuit, zkey, wasm, and vk are internally consistent
- the full local validation lane is reproducible with `npm run test:all`
- the root devnet/localnet selection now resolves through one published config surface
- root updates are no longer open to any signer in the current root source
- bounded root, leaf, and nullifier storage now fail closed instead of overwriting silently
- the legacy `prepare_phantom_withdraw` path fails closed instead of paying against proof-unbound arguments
- `prepare_phantom_withdraw_v2` verifies the promoted eight-signal proof, binds amount/receiver token/mint, records the nullifier, and pays from the vault token account
- DNA x402 signed receipts can be wrapped into Dark Null private receipt envelopes without storing raw resource URLs or raw payment headers
- the repo has one canonical public root path instead of a toy root plus side branch
- a private x402 receipt DAG links each receipt hash to the previous node with no raw URL stored (6 tests pass)
- sequential Groth16 batch settlement verifies real proofs end-to-end and rejects duplicate nullifiers within the same batch (10 tests, real proofs generated via snarkjs/BN254)
- ZK access receipt prototype issues access only on a valid Groth16 proof without recording the payer's identity (20 tests pass)
- Piano PIR access pattern prototype retrieves an index entry without leaking which entry was queried (15 tests pass)
- BDHKE blind token issuance prototype produces tokens that cannot be linked back to the redeem call (19 tests pass)
- a public observer links each withdrawal to its deposit by commitment equality; amount, receiver token account and mint are public (`tests/privacy_linkage.rs`, `tests/privacy-linkage.test.mjs`)
- canonical devnet root program `35GMe13ExGB1JGp1wZGrEvHfQnENKADroDQApeziKuwV` verified executable on devnet, including a Groth16 withdraw payout on devnet; `npm run check:x402:devnet` passes
- six x402 integration programs deployed on devnet from this source tree: silent-pay (`2FvaRhp…`), payment-stream (`EduZQkG…`), threshold-fed (`CjcnLYP1…`), fiat-oracle (`3VQsCtr…`), accumulator (`FX2YSq6…`), inference (`GSkQrJ8…`); redeployed under fresh keys on 2026-10-06, Devnet (2026-10-06): 34/34 e2e checks ([evidence](../evidence/devnet-2026-10-06/README.md))
- each of the six programs passed its own e2e script (`scripts/e2e-*.mjs`) on devnet on 2026-10-06 at the new ids, 34/34 checks ([evidence](../evidence/devnet-2026-10-06/README.md)); the combined demo (`node scripts/demo-x402-dark-null.mjs`) was not run against the new ids

## Mainnet gates

All programs above are devnet. Clearing these gates unlocks a mainnet deployment claim:

- third-party audit of the root ZK program and the `prepare_phantom_withdraw_v2` payout path
- mainnet deployment evidence committed to `MAINNET_EVIDENCE.json`
- accepted trusted setup evidence for the BN254 circuit
- defined key custody model for the privileged root updater (`RootAuthorityConfig` PDA)
- confirmation that all historical program IDs map to the current published root files

Switching `devnet` to `mainnet` in config alone is not sufficient.

## Verification flow

1. Run `sh scripts/bootstrap.sh`.
2. Run `npm run config:devnet` or `npm run config:localnet`.
3. Read [`MANIFEST.json`](../MANIFEST.json), [`NETWORKS.json`](../NETWORKS.json), and [`PROGRAM_IDS.md`](./PROGRAM_IDS.md).
4. Run `npm run check:claims`.
5. Run `npm run check:swarm`.
6. Run `npm run check:x402`.
7. Run `npm run check:ceremony`.
8. Run `npm run test:all`.
9. Run `npm run check:x402:devnet` when RPC access is available.
10. Run `npm run check:mainnet:evidence` and expect it to fail until `MAINNET_EVIDENCE.json` is real.
11. Run `npm run check:mainnet:beta` and expect it to fail until `MAINNET_BETA_EVIDENCE.json` is real.
12. Run `npm run check:mainnet` and expect it to fail until the blockers in [`MAINNET_READINESS.md`](./MAINNET_READINESS.md) are cleared.

## Frontier primitives (20 total)

Dark Null's research lane covers proof-carrying private settlement for machine and human payments. Twenty primitives across four tiers. These are gated research primitives, not launch claims: none are production claims until the corresponding evidence gates in [`2030_PRIMITIVES.md`](./2030_PRIMITIVES.md) are cleared.

### Prototype code (6)

Running tests; not deployed to production.

| Primitive | What the tests prove |
|---|---|
| Dark Null x402 Privacy Extension | Private x402 intent, receipt, receipt-DAG flow; no raw URL or payer identity in any stored field |
| Receipt DAG / Append-Only Private Receipts | SHA256-linked receipt chains where each node hashes the previous; 6 tests |
| Recursive Settlement Batches | End-to-end Groth16 batch verify with real proofs; duplicate-nullifier rejection; 10 tests |
| ZK Access Receipts | Proof-gated access: present a Groth16 proof, get the resource; identity not recorded; 20 tests |
| Access Pattern Privacy (Piano PIR) | Private Information Retrieval: fetch an index entry without revealing which entry; 15 tests |
| BDHKE Blind Receipt Tokens | Blind Diffie-Hellman Key Exchange token issuance; token is unlinkable to the redeem call; 19 tests |

### Devnet programs (6), wired into x402

Native Solana programs deployed on devnet from this source tree (redeployed under fresh keys on 2026-10-06; Devnet (2026-10-06): 34/34 e2e checks, [evidence](../evidence/devnet-2026-10-06/README.md)); each has an e2e script in [`scripts/`](../scripts) and is wired into the x402 payment stack via [`integration/programs.mjs`](../integration/programs.mjs) + [`integration/x402-hooks.mjs`](../integration/x402-hooks.mjs). Run [`scripts/demo-x402-dark-null.mjs`](../scripts/demo-x402-dark-null.mjs) to see all six fire in one agent session.

| Primitive | Program ID (devnet) | What the on-chain program does |
|---|---|---|
| Silent Payment Rails | `2FvaRhpwX2okeeV4fGuMo6Y3DxEXMZWJYYJBCknJbbED` | BIP352-style ECDH stealth-address derive + scan; payer address not re-used across calls; not full BIP352; no on-chain scanner |
| Fiat Settlement Oracle | `3VQsCtrq8kgdbUvSqHBqzbRqjuQuFkPYxrZTCBrNB8rw` | `secp256k1_recover` verifies oracle sig over `SHA256(payment_id ‖ amount ‖ recipient)`; replay-protected receipt PDA; oracle-attested, not zkTLS |
| Threshold Blind Mint Federation | `CjcnLYP1wxfgFPjcBVuEQHTb36UnjNydfngGvYjLUPPZ` | k-of-n BDHKE via Shamir + Lagrange; records federation issuance with replay protection; no DKG or per-signer DLEQ proof |
| Receipt Commitment Accumulator | `FX2YSq6jjk49m18dJpQYd7Dw9nLWYxRTDqpdodde1v2Y` | Rolling `SHA256(prev_commitment ‖ receipt_hash)` with finalization gate; one root proves all receipts in a session; SHA256 accumulator, not Nova folding |
| Oracle-Attested Inference Receipt | `GSkQrJ8hrMW6XLDh4dUv5jCFxdbczeGdm6iX7NvYPLrB` | `secp256k1_recover` verifies oracle sig over `SHA256(model_hash ‖ input_hash ‖ output_hash)`; binds compute to x402 payment; oracle attestation, not EZKL ZK circuit |
| Private Streaming Micropayments | `EduZQkGvwLGXQPVNp64BPnwCkfeVJghZr2nFKTcXBMTP` | Payment channel: `OpenChannel` funds a PDA, off-chain ticks track per-call spend, `CloseChannel` settles exact accumulated amount; no hidden-rate encryption |

**x402 integration** ([`integration/x402-hooks.mjs`](../integration/x402-hooks.mjs)):

- `makeAccumulatorHook`: drop-in `onReceiptFinalized` that commits every x402 receipt hash to the on-chain rolling root; one root proves the entire session
- `makeInferenceHook`: after each AI API call, records oracle-attested inference receipt on-chain; client can verify which model ran
- `StreamingSession`: wraps the streaming channel into per-call tick billing; session `settle()` does a single on-chain close

### Research stage (7)

Design and specification only, no production code.

| Primitive | What it would deliver |
|---|---|
| Compressed Anonymity / Nullifier State | On-chain anonymity-set storage shrinks from O(N) to O(log N) using sparse commitments |
| Proof-Carrying Relayer Swarm | Off-chain prover and indexer nodes carry verifiable execution receipts anyone can audit |
| Ephemeral Private Payment Sessions | One shared secret, many private payments, no persistent payment channel on-chain |
| Finality-Aware / Alpenglow-Ready Receipts | Receipt incorporates the final confirmed slot hash rather than an estimated slot |
| MPC Sealed Pricing / Private Auctions | Prices negotiated off-chain with multi-party computation; only settlement touches the chain |
| MEV-Aware Private Settlement Routes | Route around front-running without disclosing the payment path or amount |
| x402 Bazaar Private Reputation Receipts | Rate a paid API after settling, without linking the reviewer's identity to the rating |

### Blocked (1)

| Primitive | Blocker |
|---|---|
| Confidential Token-2022 Linkage Privacy | Token-2022 Confidential Transfer extension audit completion and SIMD stabilization |

Full specification, activation blockers, and forbidden marketing language for all 20: [`2030_PRIMITIVES.md`](./2030_PRIMITIVES.md).

## For integrators and agent builders

| If you need... | Use Dark Null for... |
|---|---|
| privacy-oriented settlement research | deposit flows, root updates, proof artifact verification, and source/security review |
| public code review | root Rust program, circuits, client helpers, SDK, IDL, and historical evidence |
| machine-speed per-request API payments | use `dna-x402` for HTTP negotiation and this repo's private x402 receipt primitives for Dark Null settlement binding |

The large agent-commerce workspace lives in [`Parad0x-Labs/dna-x402`](https://github.com/Parad0x-Labs/dna-x402): 362 Cargo workspace members (334 crates, 28 Solana program crates), the TypeScript x402 package, NULL Miner SDK, builder surfaces, and Dark Null integration crates. The repo map is in [`DNA_X402_PUBLIC_WORKSPACE_MAP.md`](./DNA_X402_PUBLIC_WORKSPACE_MAP.md).

## Review status

- No third-party audit has been completed yet.
- The repo includes an internal technical review summary in [`INTERNAL_REVIEW.md`](../INTERNAL_REVIEW.md).
- The canonical root is now bound by [`MANIFEST.json`](../MANIFEST.json).
- The current source security model is documented in [`SECURITY_MODEL.md`](../SECURITY_MODEL.md).
- Historical program IDs are cataloged in [`PROGRAM_IDS.md`](./PROGRAM_IDS.md) instead of being implied as one release.

## License

Everything currently in this repository is released under the MIT License. See [`LICENSE`](../LICENSE).
