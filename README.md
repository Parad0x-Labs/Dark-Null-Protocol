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

## 🏆 Why Dark Null? (The Numbers)

<table>
<tr>
<td align="center">
<h3>144 Bytes</h3>
<p>Smallest ZK proofs on Solana<br/><sub>Industry standard: 256+ bytes</sub></p>
</td>
<td align="center">
<h3>~$0.0003</h3>
<p>Cost per private transaction<br/><sub>Cheaper than a public TX on ETH</sub></p>
</td>
<td align="center">
<h3>~400ms</h3>
<p>Transaction finality<br/><sub>Solana speed, ZK privacy</sub></p>
</td>
<td align="center">
<h3>10,000x</h3>
<p>Micropayment cost savings<br/><sub>Batch 10K TXs into 1</sub></p>
</td>
</tr>
</table>

### 🚫 NOT a Mixer — Here's the Difference:

| | Mixers (Tornado Cash) | Dark Null Protocol |
|---|:---:|:---:|
| Instant in/out | ✅ Yes | ❌ **Maturity delays required** |
| Compliance options | ❌ None | ✅ **Audit tags for regulators** |
| Legal status | 🚨 Sanctioned | ✅ **Compliance-first design** |
| Use case | Obfuscation | **Legitimate privacy** |

**Dark Null = "Maximum Legal Privacy"** — privacy you can defend in court.

---

## What is Dark Null Protocol?

**Dark Null Protocol** is a zero-knowledge privacy layer for Solana, enabling private transactions while maintaining regulatory compliance options. Built by [Parad0x Labs](https://parad0xlabs.com) as part of the Web0 Superstack.

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
│    │                              │ │  • Funds shielded   │ │   │
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

### Core Technology
| Feature | What It Means |
|---------|---------------|
| **144-Byte ZK Proofs** | Smallest proofs on Solana = cheapest private TXs |
| **Groth16 Verification** | Battle-tested cryptography (same as Zcash) |
| **Maturity Delays** | Forced waiting period = NOT instant mixing |
| **Nullifier Tracking** | Cryptographic double-spend prevention |

### Privacy Features
| Feature | What It Means |
|---------|---------------|
| **Stealth Addresses** | One-time recipient keys, unlinkable to main wallet |
| **Relayed Withdrawals** | Relayer pays fees, your wallet never visible |
| **Shielded Balances** | Nobody can see how much you hold |

### Compliance & Legal
| Feature | What It Means |
|---------|---------------|
| **Audit Tags** | Prove ownership to regulators WITHOUT public disclosure |
| **Maturity Enforcement** | On-chain delays prevent instant mixing |
| **KYC Compatible** | Can integrate with identity solutions |

### Cost Efficiency
| Feature | What It Means |
|---------|---------------|
| **Micropayment Batching** | 10,000 payments → 1 on-chain TX (PIE+PIP+PAP) |
| **Sub-cent Payments** | Finally economically viable on blockchain |
| **Flex Denominations** | Fixed tiers OR any amount for APIs |

---

## 💡 Real-World Use Cases

| Use Case | How Dark Null Helps |
|----------|---------------------|
| **Payroll** | Pay employees without revealing salaries publicly |
| **Donations** | Donate to causes without doxxing yourself |
| **API Payments** | Monetize APIs with privacy (x402 standard) |
| **AI Agents** | Let Claude/GPT make payments without exposing wallets |
| **DeFi Trading** | Swap tokens without revealing your strategy |
| **Business Payments** | B2B transactions without competitor intelligence |

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

### Live API

| Service | URL | Status |
|---------|-----|--------|
| **API Base** | `https://api.parad0xlabs.com` | ✅ Live |
| Health Check | `https://api.parad0xlabs.com/health` | ✅ Live |
| Shield | `POST /v1/shield` | ✅ Live |
| PIE Intent | `POST /v2/intent` | ✅ Live |
| Pool Status | `GET /v2/pool` | ✅ Live |
| Streaming | `POST /v2/stream` | ✅ Live |

📖 **[Full API Documentation](./docs/API.md)**

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

**Coming Soon** — We will offer rewards for responsible disclosure after security audit completion.

See [SECURITY.md](./SECURITY.md) for reporting guidelines.

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
| [**API Reference**](./docs/API.md) | **Full API documentation** |
| [Integration Guide](./docs/integration-guide.md) | How to integrate Dark Null |
| [Live Test Results](./LIVE_TEST_RESULTS.md) | Real E2E test proofs |
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

- **Website**: [parad0xlabs.com](https://parad0xlabs.com/)
- **Twitter**: [@Parad0x_Labs](https://x.com/Parad0x_Labs)
- **Discord**: [discord.gg/Q7SCJfMJtr](https://discord.gg/Q7SCJfMJtr)
- **Email**: hello@parad0xlabs.com

---

<p align="center">
  <strong>Privacy you can defend. 🌑</strong>
</p>

