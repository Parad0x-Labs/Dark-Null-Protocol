# Dark Null Protocol: Canonical Public Devnet Track

**Private settlement on Solana, built for AI agent payments — not a mixer.**

Send and receive value on Solana with on-chain unlinkability: withdrawals are cryptographically unlinkable to the deposits that funded them. The math proves a withdrawal is valid without revealing which deposit it came from. (Deposit amounts and depositors remain visible on-chain — see [`SECURITY_MODEL.md`](./SECURITY_MODEL.md) for the exact privacy boundary.)

![Status: Canonical Root](https://img.shields.io/badge/Status-Canonical_Root-00C2A8?style=flat-square)
![Proofs: Groth16](https://img.shields.io/badge/Proofs-Groth16-111827?style=flat-square)
![License: MIT](https://img.shields.io/badge/License-MIT-0F172A?style=flat-square)

<p align="center">
  <img src="./docs/assets/github-header-dark-null.png" alt="Parad0x Labs" width="100%" />
</p>

**Private settlement research on Solana, published without pretending more than the repo proves.**

Dark Null's public edge is evidence density: the root verifier, circuit artifacts, manifest, IDL, SDK, and reproducible proof tests are published together. The repo is built to make serious claims traceable to code and hashes, not launch theater.

This repo now has one canonical public root:

- one program ID: `2stas3cZYnBiWpndcTXQDGLXwfQ7kjEYYrW52DsUAcxF`
- one root manifest: [`MANIFEST.json`](./MANIFEST.json)
- one network map: [`NETWORKS.json`](./NETWORKS.json)
- one root IDL: [`idl/paradox.json`](./idl/paradox.json)
- one root circuit bundle: [`circuits/null_proof.circom`](./circuits/null_proof.circom), [`circuits/null_proof_final.zkey`](./circuits/null_proof_final.zkey), [`circuits/null_proof_js/null_proof.wasm`](./circuits/null_proof_js/null_proof.wasm), [`circuits/vk.json`](./circuits/vk.json)
- one root verifier path: [`src/lib.rs`](./src/lib.rs) + [`src/verifying_key.rs`](./src/verifying_key.rs)
- one published security model: [`SECURITY_MODEL.md`](./SECURITY_MODEL.md)
- one setup evidence file: [`CEREMONY.md`](./CEREMONY.md)
- one public claims ledger: [`docs/CLAIMS_LEDGER.md`](./docs/CLAIMS_LEDGER.md)

Historical branches and artifact bundles are still published, but they are no longer the main integration target.

**Search tags:** `solana`, `zk-snarks`, `zero-knowledge proofs`, `groth16`, `circom`, `bn254`, `privacy payments`, `anchor`, `snarkjs`, `solana program`

## 🕶️ Why it matters to you

Money on a blockchain is public by default — anyone can see who paid whom, and how much. Dark Null fixes that:

- 🧾 **Private receipts** — prove a payment happened without exposing the amount or the counterparty.
- 🏢 **Protect your edge** — keep suppliers, payroll, and trading flows off the public ledger.
- 🔍 **Still verifiable** — published proofs mean "private" never means "just trust us."

Built for apps and teams that need payments to settle privately, with proof. *(Pre-audit — see status below.)*

### How this fits the Parad0x stack

Parad0x Labs builds Web0 on Solana — money and agents that settle themselves. **You are here: 🕶️ Privacy — the cloak over the x402 rail: same settlement, no payer attached.**

| Layer | Repo | Does |
|---|---|---|
| 💸 Payments | [dna-x402](https://github.com/Parad0x-Labs/dna-x402) | x402 rail: quote → pay → verify → receipt → anchor |
| 🛠️ Build | [dna-x402-builders](https://github.com/Parad0x-Labs/dna-x402-builders) | Hosted kit: turn any API/bot into a paid agent |
| 🕶️ Privacy | **Dark-Null-Protocol** (this repo) | Groth16 privacy settlement, published proofs |
| 🗜️ Data | [liquefy](https://github.com/Parad0x-Labs/liquefy) | Columnar compression that beats Zstd |
| 🛡️ Audit | [liquefy-openclaw-integration](https://github.com/Parad0x-Labs/liquefy-openclaw-integration) | Flight recorder: 24 engines + Solana-anchored audit trails |
| 🎬 Media | [nebula-media](https://github.com/Parad0x-Labs/nebula-media) | Proof-carrying media compression — scene-aware + on-chain receipts |
| 🧠 Local AI | [nulla-local](https://github.com/Parad0x-Labs/nulla-local) | Local-first agent runtime — your machine, your memory |

**See it live** (a consumer app running on these rails): **[parad0xlabs.com](https://parad0xlabs.com)**

## Market Position

Dark Null is the compact, evidence-first Solana privacy settlement track:

- `256-byte` current `groth16-solana` verifier ABI
- `128-byte` compressed proof target
- canonical artifact manifest with stable hash checks
- reproducible Groth16 proof flow
- explicit trusted-setup evidence with a mainnet blocker until final setup evidence exists
- payout-bound v2 withdraw path proving amount, receiver token account, and mint
- public launch gate that blocks unsupported mainnet claims

For launch copy and positioning, read [`docs/LAUNCH_NARRATIVE.md`](./docs/LAUNCH_NARRATIVE.md). For the release gate, read [`docs/MAINNET_READINESS.md`](./docs/MAINNET_READINESS.md) and [`docs/MAINNET_RUNBOOK.md`](./docs/MAINNET_RUNBOOK.md).
For the delivered-vs-blocked claim boundary, read [`docs/CLAIMS_LEDGER.md`](./docs/CLAIMS_LEDGER.md).
For external review, use the single handoff packet in [`docs/AUDITOR_HANDOFF.md`](./docs/AUDITOR_HANDOFF.md).
For an explicitly unaudited, capped mainnet beta lane, read [`docs/MAINNET_OPEN_BETA.md`](./docs/MAINNET_OPEN_BETA.md).
For off-chain service operations and the x402 receipt boundary, read [`docs/OFFCHAIN_SWARM.md`](./docs/OFFCHAIN_SWARM.md), [`docs/DNA_X402_INTEGRATION.md`](./docs/DNA_X402_INTEGRATION.md), and [`docs/PRIVATE_X402_PAYMENTS.md`](./docs/PRIVATE_X402_PAYMENTS.md).
For the public DNA x402 workspace map, read [`docs/DNA_X402_PUBLIC_WORKSPACE_MAP.md`](./docs/DNA_X402_PUBLIC_WORKSPACE_MAP.md).
For frontier work, read [`docs/2030_PRIMITIVES.md`](./docs/2030_PRIMITIVES.md).

## One Command Bootstrap

```bash
sh scripts/bootstrap.sh
```

That installs npm dependencies and runs the public repo checks.

If you want the extended validation path:

```bash
FULL_VALIDATION=1 sh scripts/bootstrap.sh
```

## Canonical Network Selection

```bash
npm run config:devnet
npm run config:localnet
```

For machine-readable output:

```bash
npm run config:json:devnet
```

Canonical defaults also live in [`.env.example`](./.env.example).

## npm SDK

```bash
npm install @dark-null/protocol
```

For Anchor-based integrations:

```bash
npm install @dark-null/protocol @coral-xyz/anchor @solana/web3.js
```

## What Is Canonical

| Area | Root path |
|---|---|
| Program binding | [`MANIFEST.json`](./MANIFEST.json), [`Anchor.toml`](./Anchor.toml), [`src/lib.rs`](./src/lib.rs) |
| Network config | [`NETWORKS.json`](./NETWORKS.json), [`.env.example`](./.env.example), [`scripts/network-config.mjs`](./scripts/network-config.mjs) |
| Verifier | [`src/verifying_key.rs`](./src/verifying_key.rs), [`circuits/vk.json`](./circuits/vk.json) |
| Circuit artifacts | [`circuits/null_proof.circom`](./circuits/null_proof.circom), [`circuits/null_proof_final.zkey`](./circuits/null_proof_final.zkey), [`circuits/null_proof_js/null_proof.wasm`](./circuits/null_proof_js/null_proof.wasm) |
| Proof encoding | 256-byte current `groth16-solana` verifier ABI; 128-byte compressed proof target |
| Private x402 receipts | [`swarm/x402.mjs`](./swarm/x402.mjs), [`docs/PRIVATE_X402_PAYMENTS.md`](./docs/PRIVATE_X402_PAYMENTS.md), DNA signed-receipt wrapper |
| Auditor handoff | [`docs/AUDITOR_HANDOFF.md`](./docs/AUDITOR_HANDOFF.md) |
| Trusted setup evidence | [`CEREMONY.md`](./CEREMONY.md), [`scripts/check-ceremony-evidence.mjs`](./scripts/check-ceremony-evidence.mjs) |
| Public IDL | [`idl/paradox.json`](./idl/paradox.json) |
| JavaScript SDK | [`sdk/index.mjs`](./sdk/index.mjs), [`sdk/index.d.ts`](./sdk/index.d.ts) |
| Python helper client | [`client/dark_client.py`](./client/dark_client.py) |
| Canonical proof-flow test | [`tests/canonical-proof-flow.test.mjs`](./tests/canonical-proof-flow.test.mjs) |

## What Is Historical

| Area | Historical path |
|---|---|
| Promoted provenance branch | [`historical/null-mint`](./historical/null-mint) |
| Archived toy public root | [`historical/root-toy-prototype`](./historical/root-toy-prototype) |
| Older full-cycle artifact bundle | [`LIVE_TEST_RESULTS.md`](./LIVE_TEST_RESULTS.md), [`full_cycle_results.json`](./full_cycle_results.json) |

## What This Repo Does Prove

- a real Groth16 verifier path is published in the root
- the root circuit, zkey, wasm, and vk are internally consistent
- the full local validation lane is reproducible with `npm run test:all`
- the root devnet/localnet selection now resolves through one published config surface
- root updates are no longer open to any signer in the current root source
- bounded root, leaf, and nullifier storage now fail closed instead of overwriting silently
- the legacy `prepare_phantom_withdraw` path fails closed instead of paying against proof-unbound arguments
- `prepare_phantom_withdraw_v2` verifies the promoted eight-signal proof, binds amount/receiver token/mint, records the nullifier, and pays from the vault token account
- DNA x402 signed receipts can be wrapped into Dark Null private receipt envelopes without storing raw resource URLs or raw payment headers
- the repo has one canonical public root path instead of a placeholder root plus side branch
- a private x402 receipt DAG links each receipt hash to the previous node with no raw URL stored (6 tests pass)
- sequential Groth16 batch settlement verifies real proofs end-to-end and rejects duplicate nullifiers within the same batch (10 tests, real proofs generated via snarkjs/BN254)
- ZK access receipt prototype issues access only on a valid Groth16 proof without recording the payer's identity (20 tests pass)
- Piano PIR access pattern prototype retrieves an index entry without leaking which entry was queried (15 tests pass)
- BDHKE blind token issuance prototype produces tokens that cannot be linked back to the redeem call (19 tests pass)
- canonical devnet program `2stas3cZYnBiWpndcTXQDGLXwfQ7kjEYYrW52DsUAcxF` verified executable on devnet (slot 468,709,388); `npm run check:x402:devnet` passes

## What This Repo Does Not Prove

- third-party audit completion
- completed mainnet deployment evidence
- final trusted setup evidence accepted for mainnet
- that every historical deployment in the repo used the current root files
- that switching `devnet` to `mainnet` is enough to ship
- append-only root derivation on-chain; the current source still trusts a privileged root updater
- append-only Merkle root derivation in-program; the current source still trusts a privileged root updater

## Verification Flow

1. Run `sh scripts/bootstrap.sh`.
2. Run `npm run config:devnet` or `npm run config:localnet`.
3. Read [`MANIFEST.json`](./MANIFEST.json), [`NETWORKS.json`](./NETWORKS.json), and [`docs/PROGRAM_IDS.md`](./docs/PROGRAM_IDS.md).
4. Run `npm run check:claims`.
5. Run `npm run check:swarm`.
6. Run `npm run check:x402`.
7. Run `npm run check:ceremony`.
8. Run `npm run test:all`.
9. Run `npm run check:x402:devnet` when RPC access is available.
10. Run `npm run check:mainnet:evidence` and expect it to fail until `MAINNET_EVIDENCE.json` is real.
11. Run `npm run check:mainnet:beta` and expect it to fail until `MAINNET_BETA_EVIDENCE.json` is real.
12. Run `npm run check:mainnet` and expect it to fail until the blockers in [`docs/MAINNET_READINESS.md`](./docs/MAINNET_READINESS.md) are cleared.

## Frontier Primitives (20 Total)

Dark Null's research lane covers proof-carrying private settlement for machine and human payments. Twenty primitives across three tiers — these are gated research primitives, not launch claims — none are production claims until the corresponding evidence gates in [`docs/2030_PRIMITIVES.md`](./docs/2030_PRIMITIVES.md) are cleared.

### Prototype code shipped (6)

Running tests; not deployed to production.

| Primitive | What the tests prove |
|---|---|
| Dark Null x402 Privacy Extension | Private x402 intent → receipt → receipt-DAG flow; no raw URL or payer identity in any stored field |
| Receipt DAG / Append-Only Private Receipts | SHA256-linked receipt chains where each node hashes the previous; 6 tests |
| Recursive Settlement Batches | End-to-end Groth16 batch verify with real proofs; duplicate-nullifier rejection; 10 tests |
| ZK Access Receipts | Proof-gated access: present a Groth16 proof, get the resource; identity not recorded; 20 tests |
| Access Pattern Privacy (Piano PIR) | Private Information Retrieval: fetch an index entry without revealing which entry; 15 tests |
| BDHKE Blind Receipt Tokens | Blind Diffie-Hellman Key Exchange token issuance; token is unlinkable to the redeem call; 19 tests |

### Research stage (13)

Design and specification only — no production code.

| Primitive | What it would deliver |
|---|---|
| Compressed Anonymity / Nullifier State | On-chain anonymity-set storage shrinks from O(N) to O(log N) using sparse commitments |
| Proof-Carrying Relayer Swarm | Off-chain prover and indexer nodes carry verifiable execution receipts anyone can audit |
| Ephemeral Private Payment Sessions | One shared secret, many private payments — no persistent payment channel on-chain |
| Finality-Aware / Alpenglow-Ready Receipts | Receipt incorporates the final confirmed slot hash rather than an estimated slot |
| MPC Sealed Pricing / Private Auctions | Prices negotiated off-chain with multi-party computation; only settlement touches the chain |
| MEV-Aware Private Settlement Routes | Route around front-running without disclosing the payment path or amount |
| x402 Bazaar Private Reputation Receipts | Rate a paid API after settling — without linking the reviewer's identity to the rating |
| **Silent Payment Rails** | Stealth-address scanning: sender derives a fresh ephemeral key per payment from the recipient's scan key. Each payment lands at a fresh address; nothing links it to your wallet across time. Think of it as a new disposable mailbox for every wire transfer — but it all reaches the same person and no one outside can connect the dots |
| **ZK Fiat Settlement Proof** | zkTLS attestation from a Stripe/Visa/Mastercard settlement webhook produces a ZK proof on-chain. Card data never leaves the processor. An agent can prove "I paid $20 via Stripe" without revealing the card, the merchant, or the payer — just a cryptographic receipt that the payment settled |
| **Threshold Blind Mint Federation** | FROST k-of-n threshold Schnorr: no single server can issue NULL tokens. A quorum of independent signers each hold a key share; k of them must cooperate, and even if k-1 servers are compromised the token supply stays intact. Users get tokens that are cryptographically blind — the issuer cannot link a token to who requested it |
| **Nova / Folding Scheme Accumulation** | Nova + HyperNova folding schemes give O(1) amortized proof accumulation — beyond SnarkPack's O(log N). A stream of 10,000 agent micropayments accumulates into a single proof the same size as a proof for 1 payment |
| **ZKML Verifiable Inference Receipts** | ZK proof that model M ran on input I and produced output O — without revealing I or the model weights. An AI agent that charges per inference can prove it ran the correct model without leaking your query or its training data |
| **Private Streaming Micropayments** | Continuous hidden-rate payment stream for per-token AI billing. One on-chain anchor opens the channel; individual payment ticks are private off-chain commitments settled in bulk. Pay for 10,000 LLM tokens over 60 seconds; the chain sees one open and one close, not 10,000 transactions |

### Blocked (1)

| Primitive | Blocker |
|---|---|
| Confidential Token-2022 Linkage Privacy | Token-2022 Confidential Transfer extension audit completion and SIMD stabilization |

Full specification, activation blockers, and forbidden marketing language for all 20: [`docs/2030_PRIMITIVES.md`](./docs/2030_PRIMITIVES.md).

```yaml
frontier_primitives:
  status: 6_prototype_code_13_research_1_blocked
  base_delivered:
    - groth16_verifier_path
    - payout_bound_withdraw_v2
    - manifest_locked_artifacts
    - private_x402_receipt_primitives
  prototypes:
    - dark_null_x402_privacy_extension
    - receipt_dag_append_only
    - recursive_settlement_batches
    - zk_access_receipts
    - piano_pir_access_pattern_privacy
    - bdhke_blind_receipt_tokens
  research:
    - compressed_anonymity_state
    - proof_carrying_relayer_swarm
    - ephemeral_private_sessions
    - finality_aware_alpenglow_receipts
    - mpc_sealed_pricing
    - mev_aware_routes
    - x402_bazaar_private_reputation
    - silent_payment_rails
    - zk_fiat_settlement_proof
    - threshold_blind_mint_federation
    - nova_folding_accumulation
    - zkml_verifiable_inference_receipts
    - private_streaming_micropayments
  blocked:
    - confidential_token2022_linkage
```

## For Integrators and Agent Builders

| If you need... | Use Dark Null for... |
|---|---|
| privacy-oriented settlement research | deposit flows, root updates, proof artifact verification, and source/security review |
| public code review | root Rust program, circuits, client helpers, SDK, IDL, and historical evidence |
| machine-speed per-request API payments | use `dna-x402` for HTTP negotiation and this repo's private x402 receipt primitives for Dark Null settlement binding |

The large agent-commerce workspace lives in [`Parad0x-Labs/dna-x402`](https://github.com/Parad0x-Labs/dna-x402): 346 Cargo workspace members, 17 Solana program entries, the TypeScript x402 package, NULL Miner SDK, builder surfaces, and Dark Null integration crates. The repo map is in [`docs/DNA_X402_PUBLIC_WORKSPACE_MAP.md`](./docs/DNA_X402_PUBLIC_WORKSPACE_MAP.md).

## Review Status

- No third-party audit has been completed yet.
- The repo includes an internal technical review summary in [`INTERNAL_REVIEW.md`](./INTERNAL_REVIEW.md).
- The canonical root is now bound by [`MANIFEST.json`](./MANIFEST.json).
- The current source security model is documented in [`SECURITY_MODEL.md`](./SECURITY_MODEL.md).
- Historical program IDs are cataloged in [`docs/PROGRAM_IDS.md`](./docs/PROGRAM_IDS.md) instead of being implied as one release.

<p align="center">
  <img src="./docs/assets/github-footer-parad0xlabs.png" alt="NULL — Parad0x Labs open source systems" width="100%" />
</p>

## License

Everything currently in this repository is released under the MIT License. See [`LICENSE`](./LICENSE).
