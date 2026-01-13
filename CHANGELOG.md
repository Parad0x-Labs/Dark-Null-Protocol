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
| 1.0.0 | Dark Null v1 | ✅ Live | Devnet |
| 0.17.0 | Paradox | ✅ Live | Devnet |
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

[Unreleased]: https://github.com/parad0x-labs/dark-null/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/parad0x-labs/dark-null/releases/tag/v1.0.0
[0.17.0]: https://github.com/parad0x-labs/dark-null/releases/tag/v0.17.0


