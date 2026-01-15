# Changelog

All notable changes to Dark Null Protocol will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

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
- **Level 1** — Commitment derivation (Poseidon hash in browser)
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
- **Recipient Binding** — Cryptographic binding via domain-separated Poseidon hash
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

### 🎉 Initial Production Release (Devnet)

**Dark Null Protocol V18 (Dark Null v1)** — First production-ready release on Solana Devnet.

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
- **@dark-null/x402-middleware** — HTTP 402 paywall middleware
- **@dark-null/jupiter-hook** — Private DEX swaps
- **@dark-null/mcp-tools** — AI agent native payments

#### Documentation
- Full API documentation
- Integration guides
- Security policy & bug bounty
- Verification guide

### Security
- Internal security review completed
- External audit scheduled Q1 2026
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

### Q1 2026
- [ ] Security audit completion
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


