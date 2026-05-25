# Claims Ledger

This ledger separates delivered claims from blocked claims and roadmap ideas. It exists to prevent public documentation from drifting into the same trap as larger privacy repos: impressive labels without matching artifacts.

## Delivered Claims

| Claim | Status | Evidence |
|---|---|---|
| Current verifier ABI is 256 bytes | Delivered | `MANIFEST.json` proof encoding plus SDK metadata/tests |
| Compressed proof target is 128 bytes | Delivered | `MANIFEST.json` proof encoding plus SDK metadata/tests |
| Canonical public-input shape has eight signals | Delivered | `MANIFEST.json`, `circuits/vk.json`, SDK encoders, Rust source, IDL, proof-flow tests |
| Legacy withdraw fails closed | Delivered | `src/lib.rs`, IDL, Rust tests |
| Payout v2 binds amount, receiver token account, and mint | Delivered | `src/lib.rs`, SDK encoders, IDL, proof-flow tests |
| Public artifact hashes are stable across platforms | Delivered | `.gitattributes`, `MANIFEST.json`, release verification scripts |
| Full local validation lane exists | Delivered | `npm run test:all` |
| Open-beta swarm health surface exists | Delivered | `swarm/server.mjs`, `config/swarm.open-beta.example.json`, `npm run test:swarm` |
| Private x402 receipt primitives exist | Delivered | `swarm/x402.mjs`, `docs/PRIVATE_X402_PAYMENTS.md`, `npm run test:x402`, `npm run check:x402` |

## Blocked Claims

| Claim | Status | Required evidence |
|---|---|---|
| Mainnet ready | Blocked | `MAINNET_EVIDENCE.json`, mainnet manifest, deployment transaction, audit report hash, setup evidence |
| Mainnet open beta | Blocked | `MAINNET_BETA_EVIDENCE.json`, capped deployment evidence, pause authority, beta disclosure, release checksums, SBOM, and audit-pending boundary |
| Completed third-party audit | Blocked | external audit report with scope, commit, findings, fixes, residual risk, and auditor identity |
| Final trusted setup evidence | Blocked | public ceremony transcript or explicit audit acceptance of the setup path |
| Production release | Blocked | mainnet gate passing on the audited release commit |

## Roadmap Or Not Claimed

| Label | Current status |
|---|---|
| Generic L2 | Not a current claim |
| Validator network | Not a current claim |
| BFT consensus layer | Not a current claim |
| Private compute | Not a current claim |
| Separate bridge product | Not a current claim |
| Sigstore-signed public release | Not a current claim until tagged release evidence exists |
| x402 merchant gateway | Not a current claim until `dna-x402` evidence exists |

## Gated Research Primitives

| Primitive | Status | Claim gate |
|---|---|---|
| Dark Null x402 Privacy Extension | Prototype | private receipt primitives only until `dna-x402` integration evidence exists |
| Compressed Anonymity / Nullifier State | Research | requires compressed-state code, tests, and manifest binding |
| Receipt DAG / Append-Only Private Receipts | Prototype | requires persistent append-only storage before public service claim |
| Proof-Carrying Relayer Swarm | Research | not a validator network, not BFT, and not decentralized consensus |
| Recursive Settlement Batches | Research | requires recursive artifacts, verifier, manifest, and duplicate-nullifier tests |
| Ephemeral Private Payment Sessions | Research | requires real session backend integration evidence |
| Finality-Aware / Alpenglow-Ready Receipts | Research | requires finality policy code and Solana protocol evidence at implementation time |
| Confidential Token-2022 Linkage Privacy | Blocked | blocked while Confidential Transfer availability is audit-gated |
| MPC Sealed Pricing / Private Auctions | Research | not a private compute network; requires external compute integration |
| MEV-Aware Private Settlement Routes | Research | no MEV-proof or BAM integration claim |
| x402 Bazaar Private Reputation Receipts | Research | requires Bazaar adapter and metadata-leakage tests |
| ZK Access Receipts | Research | requires access-receipt protocol, replay policy, and revocation tests |

## Rule

If a claim is not in the delivered table, public docs must either mark it as blocked/roadmap or omit it.
