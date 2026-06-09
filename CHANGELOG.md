# Changelog

All notable changes to Dark Null Protocol will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

Historical note: older entries below describe devnet milestones and historical release framing. They are not the same thing as the current public-root assurance level described in [`README.md`](./README.md), [`PROTOTYPE_STATUS.md`](./PROTOTYPE_STATUS.md), and [`SECURITY_MODEL.md`](./SECURITY_MODEL.md).

### Cross-repo devnet milestone — `dna-x402` Poseidon shielded pool

The sibling `dna-x402` implementation landed a working BN254 shielded-pool path on **devnet** ([Parad0x-Labs/dna-x402#29](https://github.com/Parad0x-Labs/dna-x402/pull/29)):

- a circomlib-matching BN254 **Poseidon** (via the native `sol_poseidon` syscall) now byte-matches the circuit hashing in that implementation, replacing an earlier SHA-256 stub on its on-chain path
- deposit → real Groth16 withdraw proof → withdraw to a fresh address verifies **on-chain** end-to-end; double-spend, wrong-root, and wrong-recipient all revert with the correct error codes
- devnet program `8iZFKnKTReSvhKrmrVoZ8fk2H1g3avCPZt9YVtoCkZuA`; evidence committed in that repo

Scope and posture: this is the **Poseidon-hashed `dna-x402` implementation**, distinct from this repo's canonical MiMCSponge root. **Single-party trusted setup (not trustless), unaudited, devnet only.** No mainnet deployment and no audit completion is claimed.

### Planned
- Mainnet deployment (pending audit)
- Multi-region relayer deployment
- Mobile SDK

---

## [1.23.0] - 2026-01-15

### 🔒 Security Hardening Release

**Dark Null Protocol v1.23** — Critical security fixes and client-side verification.

### Security Fixes

- **Root Authorization** — Merkle root updates now require authorized indexer
- **Challenge Protection** — Self-challenge exploit prevented
- **Verification Enforcement** — ZK proofs always verified (no bypass)
- **Accounting Fix** — Correct amount tracking in telemetry

### Added

#### Client-Side Verification
- **Level 0** — Server lookup confirmation
- **Level 1** — Commitment derivation (MiMCSponge hash in browser)
- **Level 2** — Full Groth16 proof verification (snarkjs in browser)

#### Receipt Format
- `zkReceipt` now includes cryptographic inputs for client verification
- Supports offline verification without trusting server

### Changed

- Frontend fallback to V18 now requires explicit user confirmation
- Receipt format extended with `blindedRecipient` field
- Improved fee display precision for small transfers

### Devnet Status
- ✅ Full V20 flow operational (commit → finalize)
- ✅ Client-side verification working
- ✅ E2E tested on devnet

---

## [1.22.0] - 2026-01-13

### 🌑 V20 Lazy Verification (32B Claim Hash)

**Dark Null Protocol v1.22** — Optimistic ZK with 32-byte on-chain claim.

### Added

#### Core Protocol
- **CommitUnshieldV20** — 32B commitment hash anchor (lazy verification)
- **ChallengeCommitV20** — Permissionless challenge with full proof submission
- **FinalizeUnshieldV20** — Low-compute finalization after challenge window
- **Bond Economics** — Commit bond + challenger bond for anti-grief

#### Security
- **Recipient Binding** — Cryptographic binding via domain-separated MiMCSponge hash
- **Account Validation** — Submitter/relayer/treasury binding checks
- **Solvency Checks** — Vault balance validation before all payouts
- **Checked Arithmetic** — All fee/amount math uses overflow-safe operations

#### Verification
- **On-chain Nullifier Probing** — Exact nullifier match in bitmap
- **TX Confirmation** — RPC-verified transaction finality
- **Crypto Verification** — Off-chain snarkjs.groth16.verify() support

### Changed
- Proof payload: 256B → 32B on happy path (8x reduction)
- Challenge window: 64 slots (~25 seconds)
- Public inputs: 6 → 4 (salts now private)

### Devnet Transactions
- CommitUnshieldV20: [View](https://solscan.io/tx/5c4K8M6JJqHBYzAXv9B3t7YL1xNwWnKzJkN8pFcM2qQxXvZ1tRvWnYbNmHs3vLxT?cluster=devnet)
- FinalizeUnshieldV20: [View](https://solscan.io/tx/2t6RCxXABDVRCumgMruhkt8T59bsxH6Rb44c1KwwTdHWjjeh2hVx4e4tV5aV7nCdzCqKixkt3bqyyc9QAfbZUSvB?cluster=devnet)

---

## [1.0.0] - 2026-01-09

### 🎉 Initial Public Devnet Milestone

**Dark Null Protocol V18 (Dark Null v1)** — Historical devnet milestone later superseded by the current canonical public-root track.

### Added

#### Core Protocol
- **Shield/Unshield** — Deposit and withdraw with ZK privacy
- **Groth16 Verification** — On-chain ZK-SNARK verification
- **Maturity Delays** — Configurable anti-correlation timing (40 slots default)
- **Stealth Addresses** — One-time unlinkable recipient addresses
- **Flex Denominations** — Fixed tiers with optional flex mode for APIs
- **Audit Tags** — Optional compliance layer for regulated use

#### Infrastructure
- **Relayer Service** — Deployed to Fly.io (Frankfurt)
- **Pinata IPFS** — Decentralized proof/receipt storage
- **Micropayment Batching** — PIE+PIP+PAP+QIL system (10,000x cost reduction)

#### Integrations
- **HTTP 402 middleware concept** — historical paywall integration direction
- **Private DEX swap concept** — historical integration direction
- **AI agent payment tooling concept** — historical integration direction

#### Documentation
- Full API documentation
- Integration guides
- Security policy & bug bounty
- Verification guide

### Security
- Internal security review completed
- External audit: not yet audited (none scheduled)
- Bug bounty program launched

### Deployment
- **Program ID**: `AeinEiBRodoCLJwdiXNd2fWXM49cByxhCsLW8DyRqCVe`
- **Network**: Solana Devnet
- **Relayer**: https://relayer-falling-dust-5746.fly.dev/

---

## [0.17.0] - 2025-12-XX

### V17 (Paradox) — Foundation Release

- Initial ZK verification implementation
- Basic shield/unshield functionality
- Merkle tree management
- Fixed denominations

**Program ID**: `Ajdw9GaNN39P9mj6uqiAxAnYRS4wC1rQh2C7wguvJArB`

---

## Version History

| Version | Codename | Status | Network |
|---------|----------|--------|---------|
| 1.23.0 | Security Hardening | ✅ Live | Devnet |
| 1.22.0 | 32B Lazy Verification | Superseded | Devnet |
| 1.0.0 | Dark Null v1 | Superseded | Devnet |
| 0.17.0 | Paradox | Deprecated | Devnet |
| 0.13.0 | Legacy | Deprecated | - |

---

## Upgrade Path

### From V17 to V18

V18 is a new program deployment, not an upgrade. Users on V17 can:
1. Unshield all funds from V17
2. Re-shield into V18

No automatic migration — this preserves privacy by not linking old/new deposits.

---

## Roadmap

### Near-term
- [ ] Security audit (currently unaudited — none scheduled)
- [ ] Mainnet deployment
- [ ] npm package publication

### Q2 2026
- [ ] Mobile SDK (React Native)
- [ ] Browser extension (Chrome/Firefox)
- [ ] Multi-chain expansion

### Q3 2026
- [ ] Institutional features
- [ ] Advanced compliance tools
- [ ] DAO governance

---

[Unreleased]: https://github.com/Parad0x-Labs/Dark-Null-Protocol/compare/v1.23...HEAD
[1.23.0]: https://github.com/Parad0x-Labs/Dark-Null-Protocol/releases/tag/v1.23
[1.22.0]: https://github.com/Parad0x-Labs/Dark-Null-Protocol/releases/tag/v1.22
[1.0.0]: https://github.com/Parad0x-Labs/Dark-Null-Protocol/releases/tag/v1.0.0
[0.17.0]: https://github.com/Parad0x-Labs/Dark-Null-Protocol/releases/tag/v0.17.0
