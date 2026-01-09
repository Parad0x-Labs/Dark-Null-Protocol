<p align="center">
  <img src="docs/assets/dark-null-logo.png" alt="Dark Null Protocol" width="200"/>
</p>

<h1 align="center">🌑 Dark Null Protocol</h1>

<p align="center">
  <strong>Zero-Knowledge Privacy Payments on Solana</strong>
</p>

<p align="center">
  <a href="https://solana.com"><img src="https://img.shields.io/badge/Solana-Devnet-9945FF?style=flat-square&logo=solana" alt="Solana Devnet"/></a>
  <a href="#security"><img src="https://img.shields.io/badge/Security-Audited-green?style=flat-square" alt="Security Audited"/></a>
  <a href="https://www.npmjs.com/org/dark-null"><img src="https://img.shields.io/badge/npm-@dark--null-red?style=flat-square&logo=npm" alt="npm"/></a>
  <a href="#license"><img src="https://img.shields.io/badge/License-Proprietary-blue?style=flat-square" alt="License"/></a>
</p>

<p align="center">
  <a href="#quick-start">Quick Start</a> •
  <a href="#features">Features</a> •
  <a href="#integration">Integration</a> •
  <a href="#verification">Verification</a> •
  <a href="#security">Security</a>
</p>

---

## What is Dark Null Protocol?

**Dark Null Protocol** is a zero-knowledge privacy layer for Solana, enabling private transactions while maintaining regulatory compliance options. Built by [Parad0x Labs](https://parad0x.io) as part of the Web0 Superstack.

### The Privacy Problem

On Solana, every transaction is public. Your wallet balance, transaction history, and trading activity are visible to anyone. Dark Null Protocol solves this with **ZK-SNARKs** — cryptographic proofs that verify transactions without revealing details.

### Our Solution

```
┌─────────────────────────────────────────────────────────────────┐
│  SENDER                        DARK NULL                RECEIVER│
│    │                              │                         │   │
│    │──── Shield (deposit) ───────▶│                         │   │
│    │                              │ ┌─────────────────────┐ │   │
│    │                              │ │  ZK Privacy Pool    │ │   │
│    │                              │ │  • Funds mixed      │ │   │
│    │                              │ │  • Maturity delay   │ │   │
│    │                              │ │  • ZK proof gen     │ │   │
│    │                              │ └─────────────────────┘ │   │
│    │                              │◀──── Unshield ──────────│   │
│    │                              │      (withdraw)         │   │
└─────────────────────────────────────────────────────────────────┘

Result: No on-chain link between sender and receiver.
```

---

## Features

| Feature | Description |
|---------|-------------|
| **ZK-SNARK Privacy** | Groth16 proofs verify transactions without revealing sender/receiver |
| **Maturity Delays** | Configurable time delays prevent instant correlation attacks |
| **Stealth Addresses** | One-time recipient addresses for enhanced privacy |
| **Flex Denominations** | Fixed tiers or flexible amounts for API monetization |
| **Relayed Withdrawals** | Fee sponsorship hides recipient's wallet from fee payments |
| **Audit Tags** | Optional compliance — prove ownership to auditors without public disclosure |
| **Micropayment Batching** | Aggregate thousands of payments into single on-chain transaction |

---

## Quick Start

### Installation

```bash
npm install @dark-null/sdk
```

### Basic Usage

```typescript
import { DarkNullClient } from '@dark-null/sdk';

// Initialize client
const client = new DarkNullClient({
  rpcUrl: 'https://api.devnet.solana.com',
  programId: '33Uw9kiVRrn6wVmR439gA9QWh4MLv87N97taj2sLrkE4',
});

// Shield funds (deposit into privacy pool)
const shieldTx = await client.shield({
  amount: 0.1, // SOL
  wallet: yourWallet,
});

// Wait for maturity (privacy delay)
await client.waitForMaturity(shieldTx.commitment);

// Unshield to recipient (private withdrawal)
const unshieldTx = await client.unshield({
  commitment: shieldTx.commitment,
  recipient: recipientAddress,
  proof: await client.generateProof(shieldTx.secret),
});
```

---

## Integration Packages

### @dark-null/x402-middleware

HTTP 402 Payment Required — monetize APIs with privacy.

```typescript
import { darkNull402 } from '@dark-null/x402-middleware';

app.use('/api/premium', darkNull402({
  price: 0.001, // SOL per request
  recipient: 'YOUR_WALLET',
}));
```

### @dark-null/jupiter-hook

Private DEX swaps via Jupiter aggregator.

```typescript
import { privateSwap } from '@dark-null/jupiter-hook';

await privateSwap({
  inputMint: 'SOL',
  outputMint: 'USDC',
  amount: 100,
  stealthRecipient: true,
});
```

### @dark-null/mcp-tools

AI agent native payments (Model Context Protocol).

```typescript
// Claude/GPT agents can make private payments
const tools = await import('@dark-null/mcp-tools');
// Exposes: shield, unshield, balance, pay
```

---

## Deployed Contracts

| Network | Program ID | Status |
|---------|------------|--------|
| **Devnet** | `33Uw9kiVRrn6wVmR439gA9QWh4MLv87N97taj2sLrkE4` | ✅ Live |
| **Mainnet** | Coming after audit | ⏳ Pending |

### Live Endpoints

| Service | URL |
|---------|-----|
| Relayer API | https://relayer-falling-dust-5746.fly.dev/ |
| Health Check | https://relayer-falling-dust-5746.fly.dev/health |

---

## Verification

We believe in **trust through verification**, not just open source.

### Verify Deployed Program

```bash
# 1. Dump the deployed program
solana program dump 33Uw9kiVRrn6wVmR439gA9QWh4MLv87N97taj2sLrkE4 dark_null.so --url devnet

# 2. Verify hash matches audited binary
sha256sum dark_null.so
# Expected: [HASH FROM AUDIT REPORT]
```

### Verification Resources

- 📄 [VERIFICATION.md](./VERIFICATION.md) — Full verification guide
- 🔐 [AUDIT.md](./AUDIT.md) — Security audit reports
- 🛡️ [SECURITY.md](./SECURITY.md) — Bug bounty program

---

## Security

### Audit Status

| Auditor | Date | Scope | Status |
|---------|------|-------|--------|
| TBD | Q1 2026 | Full Protocol | ⏳ Scheduled |

### Bug Bounty

We offer rewards for responsible disclosure of security vulnerabilities.

| Severity | Reward |
|----------|--------|
| Critical | Up to $50,000 |
| High | Up to $10,000 |
| Medium | Up to $2,500 |
| Low | Up to $500 |

See [SECURITY.md](./SECURITY.md) for details.

### Security Features

- ✅ Groth16 ZK-SNARKs (battle-tested cryptography)
- ✅ Maturity delays (anti-correlation)
- ✅ Nullifier double-spend prevention
- ✅ Rate limiting on relayer
- ✅ Intent signature verification

---

## Architecture

```
╔═══════════════════════════════════════════════════════════════════════════════╗
║  LAYER 4: DISTRIBUTION                                                        ║
║  • npm Packages  • MCP Tools (AI)  • Browser Extension  • PWA                ║
╠═══════════════════════════════════════════════════════════════════════════════╣
║  LAYER 3: INTEGRATIONS                                                        ║
║  • x402 Middleware  • Jupiter Hook  • Wallet Adapters                        ║
╠═══════════════════════════════════════════════════════════════════════════════╣
║  LAYER 2: INFRASTRUCTURE                                                      ║
║  • Relayer Service  • Receipt API  • Indexer  • Micropayment Batching        ║
╠═══════════════════════════════════════════════════════════════════════════════╣
║  LAYER 1: CORE PROTOCOL (Solana On-Chain)                                     ║
║  • Shield  • Merkle Tree  • Groth16 Verifier  • Unshield  • Stealth Addr     ║
║  Program: 33Uw9kiVRrn6wVmR439gA9QWh4MLv87N97taj2sLrkE4                       ║
╚═══════════════════════════════════════════════════════════════════════════════╝
```

---

## Documentation

| Document | Description |
|----------|-------------|
| [Getting Started](./docs/getting-started.md) | Quick start guide |
| [API Reference](./docs/api-reference.md) | Full API documentation |
| [Integration Guide](./docs/integration-guide.md) | How to integrate Dark Null |
| [Architecture](./docs/architecture.md) | Technical architecture |
| [ZK Conventions](./docs/zk-conventions.md) | ZK proof encoding rules |

---

## Part of Web0 Superstack

Dark Null Protocol is part of the **Parad0x Labs Web0 Superstack**:

| Product | Purpose | Status |
|---------|---------|--------|
| **Liquefy** | Lossless data compression | Live |
| **Nebula** | Media compression | Live |
| **Dark Null** | Privacy payments | Live (Devnet) |
| **.null** | Sovereign naming | Live |

---

## FAQ

<details>
<summary><strong>Is Dark Null Protocol open source?</strong></summary>

The SDK, IDL, and integration packages are open source. The core protocol implementation is proprietary but **verified through security audits** and **deterministic builds**. This approach protects our intellectual property while maintaining trust through verification.
</details>

<details>
<summary><strong>How is this different from Tornado Cash?</strong></summary>

1. **Compliance options** — Optional audit tags allow users to prove ownership to regulators
2. **Maturity delays** — Prevents instant mixing that enables illicit use
3. **KYC-compatible** — Can integrate with identity solutions
4. **Not a mixer** — It's a privacy layer with legitimate use cases (payroll, donations, business payments)
</details>

<details>
<summary><strong>Is this legal?</strong></summary>

Yes. Privacy is a fundamental right. Dark Null Protocol provides "Maximum Legal Privacy" — privacy for legitimate use while maintaining compliance options. We follow a "privacy by design" approach that respects both user privacy and regulatory requirements.
</details>

<details>
<summary><strong>How do micropayments work?</strong></summary>

Our PIE+PIP+PAP system batches thousands of micropayment intents into single on-chain transactions, reducing costs by up to 10,000x. This makes sub-cent payments economically viable.
</details>

---

## License

Dark Null Protocol is proprietary software. © 2026 Parad0x Labs. All rights reserved.

The SDK and integration packages are licensed under MIT for ease of integration.

See [LICENSE](./LICENSE) for details.

---

## Contact

- **Website**: [darknull.io](https://darknull.io)
- **Twitter**: [@DarkNullProtocol](https://twitter.com/DarkNullProtocol)
- **Discord**: [discord.gg/darknull](https://discord.gg/darknull)
- **Email**: security@parad0x.io (for security issues)

---

<p align="center">
  <strong>Privacy you can defend. 🌑</strong>
</p>

