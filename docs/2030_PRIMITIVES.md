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
| Receipt DAG / Append-Only Private Receipts | `prototype` | `swarm/receipt-dag.mjs`, 17 tests, append/walk/verify/export/import, `npm run test:receipt-dag` | no durable storage adapter yet; in-process prototype |
| Proof-Carrying Relayer Swarm | `research` | swarm roles, health, readiness, metrics, caps | not a validator network and not BFT |
| Recursive Settlement Batches | `prototype` | `swarm/batch.mjs`, 10 tests, multi-proof verify + dup-nullifier guard, `npm run test:batch` | sequential O(N) only; SnarkPack O(log N) is the research target |
| Ephemeral Private Payment Sessions | `research` | x402 receipt and swarm slot only | no MagicBlock integration |
| Finality-Aware / Alpenglow-Ready Receipts | `research` | receipt status fields can represent confirmation state | no Alpenglow-specific code path |
| Confidential Token-2022 Linkage Privacy | `blocked` | v2 binds amount, receiver token account, and mint | blocked while Solana confidential transfer availability is audit-gated |
| MPC Sealed Pricing / Private Auctions | `research` | no current MPC integration | not a private compute network |
| MEV-Aware Private Settlement Routes | `research` | relayer route concept only | no MEV-proof or BAM integration claim |
| x402 Bazaar Private Reputation Receipts | `research` | receipt hashes and x402 metadata boundary | no Bazaar integration |
| ZK Access Receipts | `prototype` | `swarm/access-receipt.mjs`, 20 tests, HMAC token bound to proof bundle hash, `npm run test:access-receipts` | HMAC prototype; ZK circuit for token is the research target |
| Access Pattern Privacy (Piano PIR) | `prototype` | `swarm/piano-pir.mjs`, 15 tests, offline hint phase + online PIR query, `npm run test:pir` | first PIR prototype in any ZK payment system; HTTP server separation is the production target |
| BDHKE Blind Receipt Tokens | `prototype` | `swarm/blind-token.mjs`, 19 tests, full blind-sign + DLEQ proof + spent registry, `npm run test:blind-tokens` | HMAC-token prototype + DLEQ public verify shipped; on-chain registry + key rotation is the research target |
| Silent Payment Rails | `prototype` | BIP352-style ECDH stealth-address derivation + scanning; Solana program `9C9F9Y8…` devnet, e2e passes | sender address privacy is identity-dark only; no on-chain scanner, no hidden-rate stream |
| Fiat Settlement Oracle | `prototype` | on-chain secp256k1_recover verifies oracle signature over settlement receipt; Solana program `DjHQxF5…` devnet, e2e passes | oracle-attested settlement, not zkTLS; zkTLS attestation from Stripe/Visa is the research target |
| Threshold Blind Mint Federation | `prototype` | k-of-n BDHKE via Shamir + Lagrange; Solana program `C6M8Nux…` devnet, e2e passes | no DKG or per-signer DLEQ proof; full FROST threshold protocol is the research target |
| Receipt Commitment Accumulator | `prototype` | rolling SHA256 hashv accumulator with finalization gate; Solana program `7VWjpxe…` devnet, e2e passes | not Nova folding; O(1) incremental Nova/HyperNova accumulator is the research target |
| Oracle-Attested Inference Receipt | `prototype` | on-chain secp256k1_recover verifies oracle signature over model+input+output hashes; Solana program `23yVqL6…` devnet, e2e passes | oracle attestation, not ZK circuit; EZKL-style ZK proof of ML inference is the research target |
| Private Streaming Micropayments | `prototype` | payment channel with off-chain ticks + on-chain close; Solana program `C5uhvm1…` devnet, e2e passes | no hidden-rate encryption; private rate stream contract is the research target |

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

- `swarm/receipt-dag.mjs` implements an append-only in-process ReceiptDAG with: tamper detection (hash recomputation), chain-head recovery, equivocation detection, receipt inclusion query, and export/import for persistence handoff.
- 17 tests cover append, has/get, chain walk, verify, equivocation, and full export/import round-trip.
- `npm run test:receipt-dag` passes.
- The chain hash commits previous head + receipt bundle hash + sequence number, so any tampering breaks verification.

What is not claimed:

- no durable storage adapter (currently in-process Map)
- no public append-only receipt index
- no service-level anti-equivocation proof on-chain

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

status: prototype

What is already evidenced:

- `swarm/batch.mjs` implements `DarkNullBatch`: multi-proof batch verifier (sequential O(N)) with cross-batch duplicate nullifier detection, per-proof vk consistency, deterministic batch hash, and batch manifest with SnarkPack research annotation.
- 10 tests cover: single valid proof, two distinct proofs, duplicate nullifier rejection, mutated public input rejection, batch hash determinism, and manifest annotation.
- `npm run test:batch` passes.
- The manifest annotates `aggregation: "sequential_groth16"` and `aggregationResearch: "snarkpack_ePrint_2021_529"` to mark the O(log N) research target.

What is not claimed:

- no recursive verifier (current is sequential O(N))
- no recursive batch circuit
- no epoch proof artifact
- no aggregated settlement proof (SnarkPack aggregation is the research target)

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

status: prototype

What is already evidenced:

- `swarm/access-receipt.mjs` implements `issueAccessReceipt` and `verifyAccessReceipt`: HMAC-SHA256 token bound to proof bundle hash + payment receipt hash + resource hash + service ID + nonce + expiry window.
- 20 tests cover: issuance, valid verify, expiry rejection, wrong token, wrong secret, tampered fields, schema mismatch, missing receipt, nonce uniqueness, and that the token is not embedded in the receipt.
- `npm run test:access-receipts` passes.
- Privacy contract: server receives only hashes (no raw URLs, no payer identity). Token never stored in receipt.

What is not claimed:

- no ZK circuit for the access token (current token is HMAC; a circuit would make it ZK-provable)
- no on-chain revocation registry (current: expiry-only)
- no replay window database (current: in-memory nonce, not persisted)

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

## 13. Access Pattern Privacy (Piano PIR)

status: prototype

What is already evidenced:

- `swarm/piano-pir.mjs` implements offline hint generation (O(√n) random Merkle paths) and online PIR query (XOR-combined path + hint that hides the real target leaf from the server).
- 15 tests cover: Merkle tree construction, sibling path correctness, root reconstruction from all leaf paths, PIR query correctness, access-pattern hiding property (server sees XOR'd index, not raw target), hint exhaustion detection, and benchmark profile.
- `npm run test:pir` passes.
- PIRBenchmark shows Dark Null 7-level tree: direct fetch = 224 bytes; PIR online = 448 bytes (2× overhead); one-time offline = ~2688 bytes. The overhead at Dark Null's current scale is negligible.

What is not claimed:

- no HTTP PIR server (currently in-process prototype)
- no RPC adapter that intercepts and wraps Merkle path requests
- no session-persistent hint store
- not the full Piano paper protocol (simplified XOR scheme, not the full GIPA argument)

The problem this solves:

Every deployed ZK payment system has the same unaddressed leak: when a prover requests Merkle sibling hashes, the full node observes exactly which siblings were requested, revealing the leaf index. The Groth16 proof is private. The HTTP request is not. Piano PIR (IEEE S&P 2024, ePrint 2023/452) is the first practical solution at 12ms + 220KB per query. This is the first implementation of PIR in any ZK payment system.

Activation blockers:

- HTTP PIR query server replacing direct RPC sibling fetches
- client hint store persistence across proof sessions
- integration test with actual prover (replace `getSiblingPath` call with PIR query)
- benchmark at devnet scale with real Merkle depth

Files/tests required before public claim:

- PIR HTTP server module
- RPC adapter that wraps sibling path fetches in PIR
- hint store persistence module
- integration test: full proof generation path using PIR for sibling fetches

Exact forbidden marketing language:

- blocked phrase: `access pattern leak closed`
- blocked phrase: `PIR deployed`
- blocked phrase: `private Merkle path fetching live`

## 14. BDHKE Blind Receipt Tokens

status: prototype

What is already evidenced:

- `swarm/blind-token.mjs` implements the full Blind Diffie-Hellman Key Exchange scheme (Chaum 1982) on secp256k1 via `@noble/curves` (a transitive dep already in node_modules via snarkjs).
- `BlindMint` class: keypair generation, blind signing (`k * B'`), DLEQ proof generation, and mint-key verification.
- `BlindClient` class: blinding (`B' = H(secret) + r*G`), unblinding (`C = C' − r*K`), token construction.
- `verifyDleq()`: public DLEQ verifier — proves the mint used its declared key without revealing k. No mint secret key needed.
- `BlindTokenRegistry`: in-process spent-token registry, double-spend prevention (atomic redeem).
- 19 tests cover: keypair generation/restore, blind non-determinism, full issuance flow, different-secret tokens differ, tampered point/secret/mint rejection, DLEQ structure/validity, DLEQ corruption rejection, public verify, double-spend prevention, unlinkability assertion, hashToCurve determinism.
- `npm run test:blind-tokens` passes.
- Unlinkability property: mint sees B' (blinded), returns C'. Client computes C = C' − r*K. Mint has no path from C' to C without the client's blinding factor r.
- Production reference: Cashu nut-00, GNU Taler blind signature spec (deployed May 2025 at Swiss bank).

What is not claimed:

- no on-chain spent-token registry (currently in-process `Set`)
- no mint key rotation mechanism
- no threshold blind signing (currently single mint key)
- no x402 gateway integration (blinded receipt not wired to HTTP flow yet)
- no persistent hint store between sessions

Activation blockers:

- on-chain spent-token registry (program account or Merkle accumulator)
- mint key rotation + multi-mint aggregation
- binding blind token to x402 payment credential (replace HMAC in access-receipt.mjs)
- threshold mint federation (remove single-mint trust assumption)

Files/tests required before public claim:

- on-chain registry program or persistent database adapter
- key rotation tests
- x402 gateway binding integration test
- threshold/federation design doc

Exact forbidden marketing language:

- blocked phrase: `trustless blind tokens`
- blocked phrase: `ecash live`
- blocked phrase: `private receipt layer deployed`

## 15. Silent Payment Rails

status: prototype

What is already evidenced:

- `swarm/silent-pay.mjs` — BIP352-style stealth address derivation: generateSilentPaymentKeys, deriveOneTimeAddress (sender), scanOutput/scanOutputs (recipient). 13 tests pass.
- Each payment goes to a fresh one-time address derived via ECDH(eph_privkey, scan_pubkey); recipient scans with scan_privkey to discover and spend.
- BDHKE blind tokens (primitive 14) provide unlinkability at the credential layer.
- Bitcoin BIP352 and Zcash shielded addresses confirm stealth-address scanning is a proven pattern at the network level.

What is not claimed:

- no on-chain integration yet; prototype is pure-crypto off-chain
- no Solana program for registering scan keys or tracking one-time addresses
- no production scanning daemon
- no chain analysis resistance guarantee without the on-chain component

The problem this solves:

Even if each receipt is unlinkable to a payer identity, address reuse across multiple x402 payments to the same API endpoint leaks the agent's behavior pattern on-chain. Silent payment rails derive a fresh ephemeral address per payment using a one-way key derivation from the recipient's public scan key. The sender never reuses an address. The recipient scans once per epoch with a private key. No on-chain observer can link two payments to the same recipient by address.

Activation blockers:

- key derivation scheme for x402 payer/payee ephemeral addresses
- recipient scanning protocol (offline scan key + live spend key separation)
- x402 protocol extension for ephemeral sender identity per payment
- address derivation privacy analysis: timing correlation, chain clustering, network-level metadata

Files/tests required before public claim:

- silent payment key derivation module
- scan protocol tests
- timing correlation threat-model doc
- integration test: x402 flow using ephemeral derived sender address
- manifest binding for silent payment key material

Exact forbidden marketing language:

- blocked phrase: `silent payments shipped`
- blocked phrase: `unlinkable payments live`
- blocked phrase: `stealth address deployed`
- blocked phrase: `on-chain address reuse closed`

## 16. ZK Fiat Settlement Proof

status: research

What is already evidenced:

- Dark Null issues x402 receipts and blind tokens that can serve as the on-chain credential surface after payment.
- Off-chain attestation patterns (DECO, TLS notary, Reclaim Protocol, zkTLS) are established research with working implementations.
- Stripe and Visa expose webhook and API surfaces that confirm payment status — these can be the attestation source.

What is not claimed:

- no Stripe integration
- no Visa or Mastercard integration
- no TLS notary or DECO deployment
- no zkTLS implementation
- not a payment processor
- no fiat on-ramp or off-ramp

The problem this solves:

"My grandma pays with her Visa card. The API gets a ZK proof that the payment happened. Her bank sees a fiat charge. Nobody links the bank transaction to the API call." This is the zero-custody fiat gateway: the user's traditional payment system issues a confirmation, a ZK attestation proves it without revealing card data or payer identity, and Dark Null releases a credential on-chain. No fiat bridge in the custodial sense — just a proof.

Activation blockers:

- TLS notary or zkTLS integration to attest Stripe/Visa webhook data
- ZK proof schema for payment confirmation (amount range, merchant hash, timestamp range)
- off-chain attestation service design (who runs the notary, key custody model)
- credential issuance binding: TLS attestation proof → Dark Null blind token or access receipt
- privacy analysis: what the fiat confirmation reveals vs. what the ZK proof hides

Files/tests required before public claim:

- TLS attestation adapter module
- payment confirmation ZK proof spec
- attestation-to-credential binding test
- privacy boundary analysis (what card metadata leaks in the attestation)
- integration test: Stripe test-mode payment → ZK proof → Dark Null access receipt

Exact forbidden marketing language:

- blocked phrase: `Visa integration live`
- blocked phrase: `credit card payments shipped`
- blocked phrase: `Stripe integration deployed`
- blocked phrase: `fiat gateway live`

## 17. Threshold Blind Mint Federation

status: prototype

What is already evidenced:

- `swarm/threshold-mint.mjs` — k-of-n BDHKE via Shamir's Secret Sharing + Lagrange interpolation on the curve. shamirSplit, partialSign, aggregatePartialResponses, unblind, verifyToken. 14 tests pass.
- Tested configurations: 2-of-3 (both {1,2} and {1,3} subsets), 3-of-5, 1-of-n, all-n. k-1 signers produce invalid token (verified).
- Token format is identical to single-signer BDHKE — same verify path, no API change for consumers.
- `swarm/blind-token.mjs` implements single-mint BDHKE with full DLEQ proof (primitive 14, 19 tests).
- FROST (Komlo/Goldberg 2020) is a proven threshold Schnorr scheme; this prototype uses the same Lagrange-on-curve aggregation.

What is not claimed:

- no distributed key generation (DKG) — dealer generates and distributes shares
- no per-signer threshold DLEQ proof (full FROST adds proofs per partial response)
- no production key ceremony or federation infrastructure
- not a validator network

The problem this solves:

The current BDHKE prototype trusts a single mint key. A compromised or coerced mint server can issue arbitrary tokens. A k-of-n threshold mint means no single server can unilaterally issue a blind token — k servers must each contribute a partial blind signature, and the client aggregates them. The DLEQ proof generalises to threshold: each server proves its partial signature used its declared key share.

Activation blockers:

- threshold key generation and share distribution protocol
- partial blind signature format (compatible with existing BDHKE secp256k1 math)
- partial DLEQ proof per server, aggregate verification
- server liveness and partial-signature timeout handling
- binding to x402 payment flow: which server set is trusted for a given service

Files/tests required before public claim:

- threshold BDHKE module (partial sign, partial DLEQ, aggregate)
- DKG or trusted setup for mint key shares
- partial signature tests: k-of-n threshold, fewer-than-k failure
- aggregate DLEQ verification tests
- integration test: x402 payment → threshold mint issuance → unblind → verify

Exact forbidden marketing language:

- blocked phrase: `decentralized mint shipped`
- blocked phrase: `threshold blind tokens live`
- blocked phrase: `trustless issuance deployed`
- blocked phrase: `validator network`

## 18. Nova / Folding Scheme Accumulation

status: research

What is already evidenced:

- `swarm/batch.mjs` implements sequential O(N) batch verification with SnarkPack annotation as the O(log N) research target (primitive 5, 10 tests).
- Nova (Kothapalli/Setty/Tzialla 2021) and HyperNova (2023) demonstrate that folding schemes can compress unbounded computation into an O(1) amortized proof accumulator — a different approach from SnarkPack aggregation.
- Protogalaxy (2023) and Sangria extend folding to PLONK-style arithmetisation.

What is not claimed:

- no folding scheme circuit
- no Nova or HyperNova prover integration
- no incremental settlement accumulator
- not a recursive verifier (current batch is sequential O(N))
- no epoch proof artifact

The problem this solves:

SnarkPack (the current batch research target) aggregates a finite set of Groth16 proofs into one O(log N) proof after the fact. Folding is different: each new Dark Null settlement proof is *folded* into a running accumulator proof with O(1) prover overhead per step. After any number of settlements, there is one constant-size accumulator proof covering all of them. At the limit, the entire payment history of the Dark Null protocol compresses to a single proof that anyone can verify in milliseconds.

Activation blockers:

- folding scheme selection (Nova, HyperNova, Protogalaxy) and circuit compatibility with existing BN254 Groth16
- incremental public-input accumulator design for nullifiers and roots
- per-step fold cost analysis at current circuit size
- cross-batch nullifier uniqueness under the folding accumulator
- verifier contract on Solana (or off-chain verifier referencing folded accumulator root)

Files/tests required before public claim:

- folding scheme adapter: translate Dark Null Groth16 proof into Nova/HyperNova step input
- incremental accumulator state tests
- wrong-fold and tampered-step tests
- benchmark: fold step overhead vs. sequential O(N) batch at 10/100/1000 proofs
- manifest binding for folded accumulator artifact

Exact forbidden marketing language:

- blocked phrase: `Nova shipped`
- blocked phrase: `O(1) settlement live`
- blocked phrase: `incremental accumulation deployed`
- blocked phrase: `infinite history in one proof`

## 19. ZKML Verifiable Inference Receipts

status: research

What is already evidenced:

- x402 receipts bind payment to resource identifiers but do not currently prove *what computation* the payment bought.
- EZKL (2023), Modulus Labs, Orion, and zkSNARKs for neural networks (Garg/Gentry/Halevi/Zhandry 2016 line) demonstrate that Groth16 proofs of neural network forward passes are achievable at research scale.
- ZK proofs of transformer inference steps are an active area (Axiom, Succinct SP1) with published benchmarks.

What is not claimed:

- no ZK circuit for ML inference
- no EZKL integration
- no model commitment scheme
- no verifiable inference receipt format
- no private input guarantee for inference data

The problem this solves:

When an AI agent pays for LLM inference via x402, today's receipt proves payment happened — it does not prove the correct model ran on the correct input and produced the declared output. A ZKML inference receipt adds a second layer: the receipt commits to (model hash, input hash, output hash), and a ZK proof certifies the model ran correctly without revealing the input (private data) or model weights (proprietary). For high-stakes agentic workflows — medical, legal, financial — this is the difference between "I paid for AI" and "I can prove which AI said what."

Activation blockers:

- model commitment scheme (hash of quantized weights, circuit parameters)
- ZK circuit for inference step (EZKL-style or SP1 RISC-V zkVM approach)
- input privacy model: what the prover needs vs. what the verifier sees
- receipt schema extension: model commitment + inference proof hash bound to x402 payment
- benchmark: proof size and generation time for realistic model sizes

Files/tests required before public claim:

- ZKML receipt format spec
- ZK inference proof adapter (EZKL or SP1 backend)
- model commitment tests
- input-privacy boundary tests (what leaks in the proof)
- integration test: x402 payment → inference → ZKML receipt → verify

Exact forbidden marketing language:

- blocked phrase: `ZKML shipped`
- blocked phrase: `verifiable AI inference live`
- blocked phrase: `private ML deployed`
- blocked phrase: `prove what the AI said`

## 20. Private Streaming Micropayments

status: prototype

What is already evidenced:

- `swarm/payment-stream.mjs` — payment channel with off-chain tick commitments. openChannel, tick (payer-signed increment), closeChannel (recipient countersign), verifySettlement, tickSupersedes (dispute). 15 tests pass.
- Tested: multi-tick accumulation, overspend guard, tamper detection, settlement verification, dispute supersede logic.
- x402 receipts represent discrete payment events; streaming extends this to continuous payment.
- `packages/session-channels` in the `dna-x402` workspace explores N-action batching into one settlement, directionally adjacent.
- Private payment channel research (Bolt, Sprites, Zcash payment channels) confirms hidden-amount state-channel patterns are achievable.

What is not claimed:

- no Solana program for on-chain channel open/close yet; settlement verification is off-chain only
- no hidden-rate stream (tick amounts are visible between payer and recipient; hidden from third parties is the goal of the on-chain anchor)
- no dispute resolution program on-chain

The problem this solves:

AI agents frequently need to pay continuously rather than in discrete steps — per-token for LLM inference, per-second for GPU compute, per-byte for bandwidth. On-chain these streams expose the rate and accumulation to anyone watching. Private streaming micropayments commit to an encrypted rate and accumulation state, stream updates off-chain, and settle with a single on-chain anchor. Neither the rate, nor the total, nor the intermediate balances are visible. The payer knows what they spent. The payee knows what they received. Nobody else does.

Activation blockers:

- stream opening protocol: rate commitment and initial balance hidden via encryption or ZK
- off-chain update protocol: each token/second increment updates shared state without on-chain tx
- on-chain settlement: anchor commits to final balance without revealing rate or history
- dispute resolution: if one party goes offline, how does the other close fairly without leaking stream details
- binding to x402 resource identifiers: which API call, which model, which session

Files/tests required before public claim:

- private stream opening module
- off-chain state update tests
- settlement anchor tests
- dispute resolution protocol
- integration test: continuous x402 inference billing via private stream, single settlement anchor

Exact forbidden marketing language:

- blocked phrase: `private streaming live`
- blocked phrase: `hidden rate streams deployed`
- blocked phrase: `pay-by-the-token privately shipped`
- blocked phrase: `real-time private billing`

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
- Piano PIR (access pattern privacy): `https://eprint.iacr.org/2023/452`
- SnarkPack (Groth16 aggregation): `https://eprint.iacr.org/2021/529`
- BDHKE Blind DHKE (Chaum 1982 blind signatures, Cashu nut-00): `https://github.com/cashubtc/nuts/blob/main/00.md`
- BIP352 Silent Payments (stealth address scanning for Bitcoin): `https://github.com/bitcoin/bips/blob/master/bip-0352.mediawiki`
- DECO / TLS notary (zkTLS attestation from HTTPS responses): `https://deco.works/`
- Reclaim Protocol (zkTLS credential proofs from web APIs): `https://www.reclaimprotocol.org/`
- FROST threshold Schnorr (Komlo/Goldberg 2020): `https://eprint.iacr.org/2020/852`
- Nova folding scheme (Kothapalli/Setty/Tzialla 2021): `https://eprint.iacr.org/2021/370`
- HyperNova (Kothapalli/Setty 2023): `https://eprint.iacr.org/2023/573`
- EZKL (ZK proofs of ONNX ML model execution): `https://github.com/zkonduit/ezkl`
- Succinct SP1 zkVM (RISC-V ZK VM for ML inference proofs): `https://github.com/succinctlabs/sp1`
- Bolt (privacy-preserving payment channels): `https://eprint.iacr.org/2016/701`
