# Dark Null Auditor Handoff

This document is the single handoff packet for an external technical review of the current Dark Null public root. It is not an audit report, not a mainnet sign-off, and not a production readiness claim. It describes what is currently implemented, how the pieces fit together, what evidence exists, what remains blocked, and how an auditor should reproduce the current validation lane.

## Current Status

Dark Null is an evidence-first Solana private settlement prototype with:

- a canonical public devnet root program binding
- a Groth16 verifier path in Rust
- a Circom circuit and canonical proof artifacts
- a payout-bound withdraw v2 path
- SDK public-input encoders
- public manifest hash binding
- release checksum and SBOM generation
- an open-beta off-chain swarm surface
- private x402 receipt primitives
- explicit gates that keep mainnet and production claims blocked until evidence exists

The current repo must be treated as development/devnet evidence. The mainnet and production gates intentionally remain blocked until audited mainnet evidence exists.

## Repository And Commit Binding

Repository:

- `https://github.com/Parad0x-Labs/Dark-Null-Protocol`

Canonical repository used for this handoff:

- `https://github.com/Parad0x-Labs/Dark-Null-Protocol`

Auditors should record the exact commit they review:

```bash
git rev-parse HEAD
git status --short --branch
```

The reviewed commit must later match any release evidence fields, especially:

- `MAINNET_EVIDENCE.json.release_commit`
- `MAINNET_EVIDENCE.json.audit.scope_commit`
- release tag commit
- deployed mainnet source commit

If those do not match, the audit cannot be used as launch evidence.

## Scope Summary

The current review scope should include:

- on-chain program source: `src/lib.rs`
- Rust verifier constants: `src/verifying_key.rs`
- IDL: `idl/paradox.json`
- canonical manifest: `MANIFEST.json`
- network map: `NETWORKS.json`
- circuit source: `circuits/null_proof.circom`
- proof artifacts: `circuits/null_proof_final.zkey`, `circuits/null_proof_js/null_proof.wasm`, `circuits/vk.json`
- SDK proof encoders: `sdk/index.mjs`, `sdk/index.d.ts`
- Python helper client: `client/dark_client.py`, `client/proof_packer.py`
- proof and malformed-proof tests: `tests/canonical-proof-flow.test.mjs`, `tests/malformed-proof.test.mjs`, `tests/proof-encoding.test.mjs`
- Rust tests in `src/lib.rs` and `tests/smoke.rs`
- mainnet evidence gates: `scripts/check-mainnet-readiness.mjs`, `scripts/check-mainnet-evidence.mjs`, `scripts/check-mainnet-beta-evidence.mjs`
- public claim gate: `scripts/check-claims-evidence.mjs`
- release integrity scripts: `scripts/generate-checksums.mjs`, `scripts/generate-sbom.mjs`, `scripts/verify-release-artifacts.mjs`
- off-chain swarm config and server: `swarm/config.mjs`, `swarm/server.mjs`
- private x402 receipt surface: `swarm/x402.mjs`, `swarm/x402.d.ts`, `scripts/check-x402-receipts.mjs`

Historical folders are review context, not the current launch target:

- `historical/null-mint`
- `historical/root-toy-prototype`
- older result bundles such as `LIVE_TEST_RESULTS.md`, `full_cycle_results.json`, and `api_e2e_results.json`

## What The Repo Proves Today

The current repo proves these delivered claims:

- the canonical verifier ABI is documented as 256 bytes
- the compressed proof target is documented as 128 bytes
- the canonical public-input shape has eight signals
- the root circuit, verification key, zkey, wasm, manifest, SDK, IDL, and Rust verifier are published together
- local Groth16 proof generation and verification pass in the canonical artifact test
- malformed proof mutation is rejected by the proof test lane
- the legacy withdraw path is fail-closed
- withdraw v2 binds amount, receiver token account, and mint
- bounded root, leaf, and nullifier windows fail closed instead of silently wrapping
- root updates require the configured root authority signer
- release artifact hashes can be generated and verified
- an SBOM can be generated from the npm lockfile
- npm audit currently reports zero vulnerabilities for the checked dependency set
- the off-chain swarm health, readiness, metrics, and config validation surfaces exist
- private x402 receipt primitives exist and are tested

The current repo does not prove:

- no completed third-party audit
- production readiness
- final trusted setup evidence accepted for mainnet
- current mainnet deployment
- live x402 merchant gateway integration
- no validator network
- BFT consensus layer
- no private compute network
- bridge product
- permissionless root updates
- append-only Merkle root derivation on-chain

## Canonical Program Model

The canonical program is an Anchor/Solana program represented by:

- `src/lib.rs`
- `src/verifying_key.rs`
- `idl/paradox.json`
- `MANIFEST.json`
- `NETWORKS.json`

The current canonical devnet program id is:

- `2stas3cZYnBiWpndcTXQDGLXwfQ7kjEYYrW52DsUAcxF`

The network default remains devnet by design. That is not a mainnet shortcut. `NETWORKS.json` keeps devnet/localnet as the current canonical networks, and the mainnet evidence gates remain blocked.

Primary account concepts:

- Merkle vault state stores commitments, accepted roots, used nullifiers, authority data, and bounded windows.
- Root authority config stores the signer allowed to publish roots.
- Vault token account is expected to be owned by the vault PDA for v2 payout.
- Receiver token account and mint are bound through v2 public inputs.

Core instructions that require review:

- `initialize`
- `update_root`
- `deposit`
- `prepare_phantom_withdraw`
- `prepare_phantom_withdraw_v2`
- `rotate_root_authority`

The old `prepare_phantom_withdraw` path is intentionally fail-closed. It must remain closed because the older three-signal proof shape does not bind payout amount, receiver token account, or mint.

The promoted payout path is `prepare_phantom_withdraw_v2`.

## Withdraw V2 Public Inputs

The promoted public-input shape is:

```text
[
  commitment,
  nullifier,
  root,
  amount,
  receiver_token_part_0,
  receiver_token_part_1,
  mint_part_0,
  mint_part_1
]
```

Encoding rules:

- `commitment`, `nullifier`, and `root` are 32-byte big-endian field elements and must be less than the BN254 scalar field modulus.
- `amount` is encoded as 24 zero bytes plus `u64_be`.
- each 32-byte pubkey is split into two 16-byte chunks.
- each 16-byte chunk is left-padded to 32 bytes.
- every derived scalar must be less than the BN254 scalar field modulus.

SDK functions to review:

- `encodeU64PublicInput`
- `encodeBytes32PublicInputParts`
- `encodeWithdrawV2PublicInputs`
- `getProofEncoding`
- `proofBundleSha256`

Tests to review:

- `sdk/index.test.mjs`
- `tests/proof-encoding.test.mjs`
- `tests/canonical-proof-flow.test.mjs`
- `tests/malformed-proof.test.mjs`

## Groth16 And Trusted Setup Boundary

The current proof system is Groth16 over BN254 with Circom artifacts.

Canonical files:

- circuit: `circuits/null_proof.circom`
- zkey: `circuits/null_proof_final.zkey`
- wasm: `circuits/null_proof_js/null_proof.wasm`
- verification key JSON: `circuits/vk.json`
- Rust verifying key: `src/verifying_key.rs`
- manifest binding: `MANIFEST.json`

The setup evidence is documented in `CEREMONY.md`. It is development-grade evidence, not final mainnet evidence. Mainnet launch requires either:

- final public ceremony transcript, or
- explicit third-party audit acceptance of the setup path, contribution process, artifact binding, and residual risk

This acceptance must be recorded in `MAINNET_EVIDENCE.json` with report path and SHA-256 hash.

## Root Authority And State Trust Boundary

The current root evolution model is not fully trustless. Deposits append commitments, but Merkle root computation is still off-chain and then published through `update_root`.

The key trust assumption:

- an attacker cannot sign as the configured root authority

The key operational requirement:

- the root authority key must not live on a public server, relayer, x402 adapter, prover node, or monitoring node

Auditors should focus on:

- whether `update_root` rejects unauthorized signers
- whether root windows fail closed on overflow
- whether stale roots and reused nullifiers are rejected
- whether authority rotation is safe and auditable
- whether root update events and state transitions are sufficient for monitoring

Known limitation:

- on-chain append-only Merkle root derivation is not currently implemented

This limitation must remain visible in public docs and cannot be marketed away.

## Payout Safety Model

The payout-bound withdraw v2 path is designed to prevent proof-unbound payout arguments.

The intended invariant:

- the proof verifies the same amount, receiver token account, and mint that the transfer uses

The critical failure modes to audit:

- valid proof with wrong amount
- valid proof with wrong receiver token account
- valid proof with wrong mint
- valid proof with stale root
- valid proof with reused nullifier
- malformed proof accepted
- legacy withdraw path paying funds
- vault token account spoofing
- receiver token account mismatch
- token program or account owner assumptions
- nullifier insertion before/after transfer failure behavior

The legacy path must remain fail-closed. Any future attempt to re-enable it is a blocker unless its proof shape also binds payout semantics.

## Off-Chain Swarm

The off-chain swarm is an operations layer around the Solana program. It is not a validator network, not a BFT layer, not a bridge, and not private compute.

Roles:

- `indexer`: follows deposits, roots, nullifiers, and payout events
- `relayer`: submits user transactions and pays transaction fees with a small SOL float only
- `prover`: generates proof jobs or routes client-side proving
- `monitor`: watches liveness, caps, vault exposure, and anomalous events
- `root_coordinator`: prepares root-update material for an external signer; must not hold the root authority key
- `x402_adapter`: reserved adapter for `dna-x402`; disabled until integration evidence exists

Security requirements:

- no root authority key on a server
- no upgrade authority key on a server
- no user spending secrets on service nodes
- relayer use must remain optional
- direct user submission must remain possible
- health, readiness, and metrics endpoints must be present
- production claims must stay disabled during open beta

Files:

- `config/swarm.open-beta.example.json`
- `swarm/config.mjs`
- `swarm/server.mjs`
- `tests/swarm-config.test.mjs`

Validation:

```bash
npm run check:swarm
npm run test:swarm
```

## Private x402 Receipt Layer

Dark Null now has a local private x402 receipt surface. This is not a live merchant gateway and not a completed integration with `dna-x402`.

The delivered Dark Null-side contract:

- x402 V2 payment header names are fixed
- payment requirement payload can be encoded as Base64 JSON
- raw buyer identity is rejected from Dark Null receipt metadata
- raw resource URLs and query strings are rejected from the intent surface
- raw payment headers are not stored in receipts
- payment headers are stored as hashes
- replay key is derived from intent hash, method, resource hash, body hash, and payment header hashes
- receipt hash locks x402 header hashes, request hash fields, proof hash fields, Solana transaction fields, repository commit, manifest hash, and optional previous receipt hash
- structural verifier recomputes receipt hash and rejects tampering
- Solana verifier hook can confirm a settled receipt signature through RPC

Files:

- `swarm/x402.mjs`
- `swarm/x402.d.ts`
- `scripts/check-x402-receipts.mjs`
- `tests/x402-private-payments.test.mjs`
- `docs/PRIVATE_X402_PAYMENTS.md`

Validation:

```bash
npm run check:x402
npm run test:x402
npm run check:x402:devnet
```

The devnet check verifies a historical devnet signature through Solana RPC and confirms the canonical devnet program account is executable. During local validation, the historical result bundle recorded slot `434395918`, while chain RPC reported slot `434395917`. The checker now reports both and uses chain state for receipt verification.

Activation blockers for a real x402 adapter:

- external `dna-x402` release commit
- integration test mapping a real x402 payment intent to Dark Null settlement metadata
- replay cache in runtime
- append-only receipt persistence
- no custody of user secrets
- direct submission fallback preserved
- external audit review of the full integration path

## Release And Manifest Locking

`MANIFEST.json` is the canonical public artifact lock. It binds:

- label and status
- program id and cluster
- source provenance
- Groth16 metadata
- proof encoding metadata
- x402 receipt metadata
- artifact paths
- SHA-256 hashes
- stable byte sizes

Line endings are normalized for stable hashing through the repo release tooling. The release verifier recalculates stable SHA-256 hashes and sizes from the working tree.

Release scripts:

- `scripts/generate-checksums.mjs`
- `scripts/generate-sbom.mjs`
- `scripts/verify-release-artifacts.mjs`
- `scripts/release-artifacts.mjs`

Validation:

```bash
npm run release:sbom
npm run release:checksums
npm run release:verify
```

Generated release outputs:

- `dist/release/sbom.cdx.json`
- `dist/release/SHA256SUMS`

These generated files are release outputs, not source-of-truth replacements for `MANIFEST.json`.

## Mainnet And Open Beta Gates

There are two separate gates:

- production mainnet gate: `npm run check:mainnet`
- unaudited capped open beta gate: `npm run check:mainnet:beta`

The production mainnet gate remains blocked until:

- `MAINNET_EVIDENCE.json` exists
- manifest is promoted to mainnet
- default network is intentionally changed from devnet only after evidence exists
- mainnet deployment transaction is published
- upgrade authority policy is published
- final trusted setup evidence or audit acceptance exists
- blocked until a completed third-party audit report is published
- audit report hash is bound into evidence
- v2 payout artifacts are the promoted mainnet artifacts
- release checksums, SBOM, and attestations exist for the release commit

The open beta lane is not production readiness. It can only be used with explicit caps, unaudited disclosure, pause/upgrade controls, incident response, and evidence in `MAINNET_BETA_EVIDENCE.json`.

Current blocker expectation:

- `npm run check:mainnet` is expected to fail until production evidence exists.
- `npm run check:mainnet:beta` is expected to fail until open beta evidence exists.

Auditors should treat any passing mainnet gate without complete evidence as a critical issue.

## Cumulative Validation Commands

Install dependencies:

```bash
npm ci
```

Primary public validation:

```bash
npm test
```

Full local validation:

```bash
npm run test:all
```

Devnet x402 receipt verification:

```bash
npm run check:x402:devnet
```

Optional trusted setup verification with external PTAU:

```bash
DARK_NULL_PTAU_PATH=/path/to/pot14_final.ptau npm run check:ceremony
```

Windows PowerShell equivalent:

```powershell
$env:DARK_NULL_PTAU_PATH='G:\null_mim\circuits\pot14_final.ptau'
npm run check:ceremony
```

Expected current behavior:

- `npm test` passes
- `npm run test:all` passes
- `npm run check:x402:devnet` passes when Solana devnet RPC can look up historical signatures
- `npm run check:mainnet` remains blocked without production evidence
- `npm run check:mainnet:beta` remains blocked without beta evidence

## Test Coverage Map

Key test lanes:

- SDK metadata and encoders: `sdk/index.test.mjs`
- network config: `tests/network-config.test.mjs`
- canonical manifest binding: `tests/canonical-manifest.test.mjs`
- canonical proof flow: `tests/canonical-proof-flow.test.mjs`
- malformed proof rejection: `tests/malformed-proof.test.mjs`
- proof encoding: `tests/proof-encoding.test.mjs`
- mainnet readiness gate regression: `tests/mainnet-readiness.test.mjs`
- mainnet evidence gate regression: `tests/mainnet-evidence.test.mjs`
- open beta evidence gate regression: `tests/mainnet-beta-evidence.test.mjs`
- swarm config and endpoints: `tests/swarm-config.test.mjs`
- x402 private receipt primitives: `tests/x402-private-payments.test.mjs`
- Python client tests: `client/test_dark_protocol.py`
- Rust program tests: `src/lib.rs`, `tests/smoke.rs`

Audit priority test gaps:

- property tests over wrong receiver token, wrong mint, wrong amount, stale root, and duplicate nullifier combinations
- adversarial token account ownership tests
- transaction composition tests for unexpected CPI/account routing
- root authority rotation integration tests with real Anchor harness
- end-to-end v2 withdraw test against a fresh local validator
- live x402 integration test once `dna-x402` evidence exists
- append-only receipt persistence test for real service storage

## Known Weaknesses And Risk Register

Known weaknesses:

- no completed third-party audit
- no final mainnet trusted setup evidence
- no current mainnet deployment evidence
- root computation remains off-chain and trusted through the root updater
- bounded live state windows are used instead of unbounded append-only state
- current devnet evidence includes historical artifacts, not one fully fresh launch transcript
- x402 merchant gateway integration is not live
- swarm is operational scaffolding, not decentralized consensus
- mainnet beta would still be unaudited unless external audit is completed first

These weaknesses do not make the delivered code fake. They define the boundary of what can safely be claimed.

## Auditor Questions To Answer

Auditors should explicitly answer:

- Does withdraw v2 fully bind payout amount, receiver token account, and mint?
- Can any legacy path still move value without v2 payout-bound proof semantics?
- Can a valid proof be replayed through any state or transaction ordering edge case?
- Are nullifiers written at the correct point relative to transfer behavior?
- Can bounded root, leaf, or nullifier windows be exhausted in a way that causes unsafe behavior?
- Is root authority enforcement correct?
- Is authority rotation safe?
- Are token account ownership and mint assumptions sufficient?
- Are proof public inputs encoded consistently across circuit, SDK, IDL, and Rust verifier?
- Does `MANIFEST.json` bind all release-critical artifacts?
- Are release checksums and SBOM sufficient for reproducibility claims?
- Is the trusted setup path acceptable for any mainnet beta, or must final ceremony evidence be produced first?
- Does the x402 receipt layer avoid storing sensitive metadata?
- Is the x402 replay key sufficient once connected to real `dna-x402` traffic?
- What residual risks must be disclosed before any public beta?

## Required Auditor Deliverables

A real audit report must include:

- auditor identity
- audit dates
- audited commit hash
- exact files and artifacts reviewed
- methodology
- threat model assumptions
- findings with severity
- proof/circuit review notes
- Solana program review notes
- release artifact review notes
- x402 receipt review notes if included in scope
- fix validation results
- remaining risks
- final report hash
- explicit statement on whether trusted setup evidence is accepted or rejected for the reviewed launch scope

The report must not be summarized into a marketing claim unless the report itself supports that claim.

## Launch Language Rules

Allowed current language:

- "canonical public devnet track"
- "private settlement research"
- "payout-bound withdraw v2 path"
- "private x402 receipt primitives"
- "open-beta evidence gate"
- "not externally audited yet"

Blocked language until evidence exists:

- blocked: "mainnet ready"
- blocked: "production ready"
- blocked: "third-party audited"
- blocked: "validator network"
- "BFT layer"
- blocked: "private compute network"
- "bridge"
- "live x402 merchant gateway"

The claims ledger is the source of truth for public wording:

- `docs/CLAIMS_LEDGER.md`

## Recommended Audit Order

1. Confirm the reviewed commit and clean working tree.
2. Run `npm ci`.
3. Run `npm test`.
4. Run `npm run test:all`.
5. Run `npm run check:x402:devnet`.
6. Review `MANIFEST.json` artifact hashes and release verification scripts.
7. Review the circuit and proof public-input encoding.
8. Review `src/lib.rs` withdraw v2 and legacy fail-closed behavior.
9. Review root authority and bounded state behavior.
10. Review token payout safety.
11. Review x402 receipt metadata and replay-key design.
12. Review mainnet evidence gates and ensure blocked claims stay blocked.
13. Produce findings and fix validation against the exact commit.

## Bottom Line

Dark Null currently has a stronger public proof and evidence foundation than a typical roadmap-heavy privacy repo, but it is not a completed mainnet release. The strongest delivered pieces are the canonical artifact binding, payout-bound v2 public-input design, fail-closed legacy withdraw path, cumulative validation lane, release integrity scripts, and private x402 receipt lock.

The biggest unresolved risks are external audit, final setup evidence, off-chain root trust, mainnet deployment evidence, and full end-to-end runtime integration. Those must be treated as blockers, not footnotes.
