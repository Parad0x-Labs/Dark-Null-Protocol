# 2030 Research Primitives

This page is the gated frontier map for Dark Null. It is a design and verification queue, not launch copy. A primitive becomes a public claim only after code, tests, manifest binding, release evidence, and review scope support it.

## Status Key

| Status | Meaning |
|---|---|
| `delivered` | Implemented, tested, and represented in the current manifest or public test lane. |
| `prototype` | A local primitive exists, but the full integration or production surface is not active. |
| `research` | Design direction only. No public delivered claim. |
| `blocked` | Requires external protocol availability, deployment evidence, or review before implementation can be marketed. |

## Primitive Matrix

| Primitive | Status | Repo evidence today | Public claim boundary |
|---|---|---|---|
| Dark Null x402 Privacy Extension | `prototype` | `swarm/x402.mjs`, `tests/x402-private-payments.test.mjs`, `npm run check:x402` | private receipt primitives until integration evidence exists |
| Compressed Anonymity / Nullifier State | `research` | bounded root/nullifier windows plus manifest evidence | not compressed state and not deployed ZK Compression |
| Receipt DAG / Append-Only Private Receipts | `prototype` | receipt hash plus optional previous receipt hash | no persistent append-only service yet |
| Proof-Carrying Relayer Swarm | `research` | swarm roles, health, readiness, metrics, caps | not a validator network and not BFT |
| Recursive Settlement Batches | `research` | current single-proof Groth16 lane | no recursive verifier or batch circuit |
| Ephemeral Private Payment Sessions | `research` | x402 receipt and swarm slot only | no MagicBlock integration |
| Finality-Aware / Alpenglow-Ready Receipts | `research` | receipt status fields can represent confirmation state | no Alpenglow-specific code path |
| Confidential Token-2022 Linkage Privacy | `blocked` | v2 binds amount, receiver token account, and mint | blocked while Solana confidential transfer availability is audit-gated |
| MPC Sealed Pricing / Private Auctions | `research` | no current MPC integration | not a private compute network |
| MEV-Aware Private Settlement Routes | `research` | relayer route concept only | no MEV-proof or BAM integration claim |
| x402 Bazaar Private Reputation Receipts | `research` | receipt hashes and x402 metadata boundary | no Bazaar integration |
| ZK Access Receipts | `research` | receipt hashes and request binding | no reusable access-token protocol yet |

## 1. Dark Null x402 Privacy Extension

status: prototype

What is already evidenced:

- `swarm/x402.mjs` fixes x402 V2 header names and builds private payment intent, request binding, receipt, and verification helpers.
- `scripts/check-x402-receipts.mjs` validates an offline receipt and can confirm a historical devnet Solana signature.
- `tests/x402-private-payments.test.mjs` checks metadata rejection, replay-key movement, receipt hash locking, previous receipt hash chaining, and Solana verifier behavior.
- `MANIFEST.json` includes x402 receipt metadata.

What is not claimed:

- no live x402 merchant gateway
- no completed `dna-x402` integration
- no facilitator integration
- no AP2/A2A production flow
- no mainnet payment gateway claim

Activation blockers:

- external `dna-x402` release commit
- integration test from real x402 payment intent to Dark Null settlement metadata
- runtime replay cache
- append-only receipt persistence
- service-level direct-submission fallback
- review of privacy metadata boundaries

Files/tests required before public claim:

- `swarm/x402.mjs`
- `scripts/check-x402-receipts.mjs`
- `tests/x402-private-payments.test.mjs`
- new integration test against `dna-x402`
- manifest update binding the integration evidence

Exact forbidden marketing language:

- blocked phrase: `live x402 merchant gateway`
- blocked phrase: `production ready x402`
- blocked phrase: `AP2 production gateway`
- blocked phrase: `mainnet ready x402`

## 2. Compressed Anonymity / Nullifier State

status: research

What is already evidenced:

- Dark Null stores bounded commitments, roots, and nullifiers.
- Overflow behavior fails closed.
- public-input encoders and proof tests bind the root and nullifier path.

What is not claimed:

- no compressed-account deployment
- no ZK Compression state tree
- no compressed nullifier index
- no million-user anonymity set claim

Activation blockers:

- state-tree design for commitments, roots, nullifiers, and receipt heads
- compressed account proof ingestion plan
- indexer consistency model
- wrong-root, stale-root, duplicate-nullifier, and missing-nullifier tests
- migration plan from bounded windows

Files/tests required before public claim:

- `docs/COMPRESSED_ANONYMITY_STATE.md`
- compressed-state adapter code
- compressed-state manifest metadata
- property tests over root/nullifier migration
- localnet integration test using a compressed-account backend

Exact forbidden marketing language:

- blocked phrase: `compressed anonymity state is live`
- blocked phrase: `millions of deposits supported`
- blocked phrase: `mainnet compressed nullifier state`

## 3. Receipt DAG / Append-Only Private Receipts

status: prototype

What is already evidenced:

- x402 receipts can include `previousReceiptHash`.
- receipt verification recomputes the current receipt hash.
- tests reject wrong previous receipt hash.

What is not claimed:

- no persistent receipt DAG service
- no public append-only receipt index
- no service-level anti-equivocation proof

Activation blockers:

- durable receipt storage
- append-only log proof
- chain-head recovery
- receipt inclusion query API
- replay-cache persistence

Files/tests required before public claim:

- receipt log module
- storage adapter tests
- tamper/equivocation tests
- manifest metadata for receipt log hash policy

Exact forbidden marketing language:

- blocked phrase: `append-only receipt DAG is deployed`
- blocked phrase: `public receipt network`

## 4. Proof-Carrying Relayer Swarm

status: research

What is already evidenced:

- `config/swarm.open-beta.example.json` defines roles, caps, endpoints, and key-custody constraints.
- `swarm/server.mjs` exposes health, readiness, and metrics.
- `tests/swarm-config.test.mjs` checks fail-closed config behavior.

What is not claimed:

- not a validator network
- not a BFT layer
- not decentralized consensus
- not a private compute network

Activation blockers:

- signed attestation capsule format
- service key management policy
- config hash derivation
- manifest hash binding
- liveness proof format
- no-root-key and no-upgrade-key enforcement evidence

Files/tests required before public claim:

- `docs/PROOF_CARRYING_SWARM.md`
- attestation capsule module
- role capsule tests
- config digest tests
- operational runbook update

Exact forbidden marketing language:

- blocked phrase: `validator network`
- blocked phrase: `BFT layer`
- blocked phrase: `decentralized consensus`
- blocked phrase: `private compute network`

## 5. Recursive Settlement Batches

status: research

What is already evidenced:

- current proof flow verifies one canonical Groth16 proof bundle.
- malformed proof mutation is rejected.
- public inputs are stable and manifest-bound.

What is not claimed:

- no recursive verifier
- no recursive batch circuit
- no epoch proof artifact
- no aggregated settlement proof

Activation blockers:

- recursive proof system selection
- epoch public-input accumulator design
- nullifier uniqueness across sub-batches
- batch manifest format
- batch circuit and verifier review

Files/tests required before public claim:

- `docs/RECURSIVE_BATCHING.md`
- recursive circuit/prover prototype
- deterministic batch vector tests
- wrong-sub-batch and duplicate-nullifier tests
- manifest binding for recursive artifacts

Exact forbidden marketing language:

- blocked phrase: `recursive batching is live`
- blocked phrase: `epoch proofs shipped`
- blocked phrase: `one proof settles all payments`

## 6. Ephemeral Private Payment Sessions

status: research

What is already evidenced:

- x402 receipts can hash requests and bind settlement evidence.
- swarm roles reserve operational surfaces for relayer/prover/indexer behavior.

What is not claimed:

- no MagicBlock integration
- no delegated-state session runtime
- no gasless session settlement claim

Activation blockers:

- session open/close protocol
- session receipt accumulator
- state-delegation trust model
- timeout and rollback handling
- localnet or devnet integration harness

Files/tests required before public claim:

- session protocol doc
- session receipt tests
- delegated-state failure tests
- integration evidence with an ephemeral-session backend

Exact forbidden marketing language:

- blocked phrase: `MagicBlock integration shipped`
- blocked phrase: `gasless private sessions are live`

## 7. Finality-Aware / Alpenglow-Ready Receipts

status: research

What is already evidenced:

- x402 receipts bind Solana confirmation status and slot.
- the devnet checker validates finalized signature status through RPC.

What is not claimed:

- no Alpenglow-specific runtime path
- no automatic maturity-window reduction
- no finality-latency guarantee

Activation blockers:

- finality policy module
- maturity-window config tests
- receipt-state transition tests
- Solana protocol upgrade status review at implementation time

Files/tests required before public claim:

- finality policy module
- confirmation-status transition tests
- docs update after Solana protocol evidence changes

Exact forbidden marketing language:

- blocked phrase: `Alpenglow support shipped`
- blocked phrase: `150ms private settlement`
- blocked phrase: `no code change finality upgrade`

## 8. Confidential Token-2022 Linkage Privacy

status: blocked

What is already evidenced:

- Dark Null v2 public inputs bind amount, receiver token account, and mint.
- current docs describe Token-2022 confidential transfer as a future compatibility direction only.

What is not claimed:

- no Confidential Transfer integration
- no encrypted amount bridge
- no ElGamal commitment opened inside the Dark Null circuit

Activation blockers:

- Solana Confidential Transfer availability returns on devnet/mainnet
- audit-gated ZK ElGamal Proof Program status clears
- circuit design for amount commitment linkage
- token account address leakage analysis
- wrong-opening and wrong-token-account tests

Files/tests required before public claim:

- Token-2022 integration design
- circuit change proposal
- confidential amount test vectors
- Solana runtime availability evidence

Exact forbidden marketing language:

- blocked phrase: `Confidential Token-2022 bridge`
- blocked phrase: `confidential amount support shipped`
- blocked phrase: `private Token-2022 production path`

## 9. MPC Sealed Pricing / Private Auctions

status: research

What is already evidenced:

- no MPC module exists in this repo.
- x402 receipts can bind a hashed price/intent surface once an external compute layer produces it.

What is not claimed:

- not a private compute network
- no Arcium integration
- no sealed auction runtime

Activation blockers:

- external confidential-compute integration
- price commitment format
- bid/floor proof boundary
- settlement binding between MPC output and Dark Null receipt

Files/tests required before public claim:

- sealed pricing design doc
- external integration adapter
- price commitment tests
- wrong-price and stale-quote tests

Exact forbidden marketing language:

- blocked phrase: `private compute network`
- blocked phrase: `sealed auctions live`
- blocked phrase: `Arcium integration shipped`

## 10. MEV-Aware Private Settlement Routes

status: research

What is already evidenced:

- relayer use is optional and direct submission remains possible.
- no route policy exists yet.

What is not claimed:

- no MEV-proof settlement
- no Jito BAM integration
- no private sequencing guarantee

Activation blockers:

- route policy module
- fair/private route availability checks
- failure fallback policy
- timing-correlation threat model

Files/tests required before public claim:

- route policy module
- settlement route tests
- fallback tests
- route-specific disclosure in runbook

Exact forbidden marketing language:

- blocked phrase: `MEV-proof`
- blocked phrase: `BAM integration shipped`
- blocked phrase: `private sequencing guaranteed`

## 11. x402 Bazaar Private Reputation Receipts

status: research

What is already evidenced:

- x402 receipt hashes can prove payment and settlement fields without storing raw buyer metadata.
- request/resource values are hashed.

What is not claimed:

- no x402 Bazaar indexing integration
- no public reputation graph
- no API discovery integration

Activation blockers:

- Bazaar metadata mapping
- private reputation receipt schema
- service proof-of-delivery binding
- buyer privacy review

Files/tests required before public claim:

- reputation receipt schema
- Bazaar adapter tests
- proof-of-service delivery tests
- metadata leakage tests

Exact forbidden marketing language:

- blocked phrase: `Bazaar integration live`
- blocked phrase: `private reputation network`

## 12. ZK Access Receipts

status: research

What is already evidenced:

- current receipts bind payment intent, request hash, response hash, settlement signature, and proof hash.

What is not claimed:

- no reusable access receipt protocol
- no access-token circuit
- no revocation mechanism

Activation blockers:

- access receipt public inputs
- replay window and revocation design
- holder privacy model
- service authorization tests

Files/tests required before public claim:

- access receipt design doc
- verifier/circuit prototype
- replay/revocation tests
- service middleware integration test

Exact forbidden marketing language:

- blocked phrase: `ZK access receipts shipped`
- blocked phrase: `private API auth live`

## External Watchlist

These are inputs for design work, not evidence that Dark Null has shipped integrations:

- x402 HTTP 402 and V2 payment headers: `https://docs.x402.org/core-concepts/http-402`
- x402 Solana/SVM support and settlement cache behavior: `https://docs.x402.org/core-concepts/network-and-token-support`, `https://docs.x402.org/core-concepts/facilitator`
- x402 AP2/A2A extension direction: `https://ap2-protocol.net/en/topics/ap2-and-x402`
- ZK Compression validity proofs: `https://www.zkcompression.com/learn/core-concepts/validity-proofs`
- Solana Confidential Transfer availability boundary: `https://solana.com/docs/tokens/extensions/confidential-transfer`
- MagicBlock Ephemeral Rollups: `https://docs.magicblock.gg/pages/get-started/introduction/ephemeral-rollup`
- Alpenglow SIMD-0326: `https://github.com/solana-foundation/solana-improvement-documents/blob/main/proposals/0326-alpenglow.md`
- Arcium MPC confidential compute: `https://docs.arcium.com/`
- Jito BAM: `https://bam.dev/docs/`
- Recursive proof systems: `https://risc0-risc0.mintlify.app/examples/groth16-verifier`
