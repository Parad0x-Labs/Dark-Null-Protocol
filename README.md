# 🌑 Dark Null Protocol v1.23 — 32B Lazy Verification (Optimistic ZK)

**Privacy transfers on Solana with a 32-byte on-chain claim.**

Happy path stays tiny. Verification stays permissionless when it matters.

---

## 📍 Live Devnet Transactions

| Instruction | TX Signature | Explorer |
|-------------|--------------|----------|
| **CommitUnshieldV20** (32B anchor) | `5c4K...` | [View on Solscan](https://solscan.io/tx/5c4K8M6JJqHBYzAXv9B3t7YL1xNwWnKzJkN8pFcM2qQxXvZ1tRvWnYbNmHs3vLxT?cluster=devnet) |
| **FinalizeUnshieldV20** | `2t6R...` | [View on Solscan](https://solscan.io/tx/2t6RCxXABDVRCumgMruhkt8T59bsxH6Rb44c1KwwTdHWjjeh2hVx4e4tV5aV7nCdzCqKixkt3bqyyc9QAfbZUSvB?cluster=devnet) |

---

## What "32B" Means (and What It Doesn't)

**The 32-byte claim:**
- `CommitUnshieldV20` posts a **32-byte commitment hash** as the withdraw anchor
- This is the **proof payload** on the happy path — not the full transaction size
- Full transaction includes accounts, headers, and instruction data (~400-600 bytes total)

**What it's NOT:**
- Not "entire transaction = 32 bytes" (that's impossible on Solana)
- Not proof compression (the full proof exists, just not posted unless challenged)

**Why it matters:**
- 32B anchor vs 256B full proof = **8x smaller happy-path payload**
- Challengers can still verify — permissionless security preserved

---

**Dark Null v1.23** is a Solana privacy transfer protocol that minimizes on-chain proof payload using a **lazy verification** model.

**Key idea:** the "happy path" posts only a **32-byte claim hash** on-chain. Full SNARK proof bytes are only required in a **permissionless challenge path** (rare).

> This repository is a **public interface + documentation shell**.  
> **Circuits, proving keys, relayer internals, and proprietary optimizations are intentionally not published.**

---

## Security Model

### Challenge Window + Bonds

1. **Commit Phase**: User posts 32B commitment + bond (anti-grief deposit)
2. **Challenge Window**: ~64 slots (~25 seconds) where anyone can challenge
3. **Challenge**: Challenger posts full proof + challenger bond
4. **Resolution**:
   - If proof invalid → commit rejected, challenger rewarded
   - If proof valid → commit confirmed early, challenger bond slashed
5. **Finalize**: After window expires (unchallenged), funds release

### What "Finalized = Safe" Means

- **Unchallenged finalize**: No one disputed during window → funds released
- **Challenged & confirmed**: Proof verified on-chain → funds released
- **Challenged & rejected**: Invalid proof → funds returned to vault

### Trust Assumptions

- Security does NOT depend on proprietary infrastructure
- Anyone can run a challenger node
- Bonds make griefing economically irrational

---

## What shipped (v1.23)

- ✅ **32B on-chain claim** (`commitment_hash`) for withdraw commits
- ✅ **Permissionless challenge**: anyone can submit a standard proof during the window
- ✅ **Finalize after window** (or early-confirmed) with low compute
- ✅ **Bond economics**: anti-grief + fraud incentives
- ✅ **Account binding**: recipient/relayer/submitter validated against commit state
- ✅ **Solvency & checked-math** protections in payout paths
- ✅ **Client-side verification**: Level 0/1/2 cryptographic checks in browser
- ✅ **Security hardening**: Root authorization, self-challenge prevention

---

## How it works (high level)

### Happy path (expected)
1) **Shield**: deposit creates a note commitment in the anonymity set  
2) **CommitUnshieldV20**: submit a **32B claim hash** + metadata, start challenge window  
3) Wait for challenge window to expire  
4) **FinalizeUnshieldV20**: release funds + mark nullifier spent

### Challenge path (rare)
- Any challenger can submit a proof during the challenge window.
- If the proof fails verification → commit is rejected and bonds are paid out per rules.
- If the proof passes → commit is confirmed (challenge bond is slashed).

> The protocol does **not** depend on proprietary proof compression for security.  
> Proprietary infrastructure optimizations (if any) are not required to challenge.

---

## What is public here

- Protocol overview + threat model
- Instruction interfaces (IDL)
- State/account semantics (PendingCommit)
- Fee model
- Security checklist & invariants
- Devnet E2E lab report + transaction links

## What's Intentionally NOT in This Repo

This is a **public documentation shell**. The following are private by design:

| Category | What's Private | Why |
|----------|----------------|-----|
| **ZK Circuits** | `.circom`, `.wasm`, `.zkey`, `.ptau`, verifying keys | Core IP |
| **Prover Pipeline** | Key generation, witness computation, proof serialization | Core IP |
| **Relayer Internals** | Job queue, anti-grief logic, rate limiting | Operational security |
| **Encoding Optimizations** | Point compression, endianness handling | Core IP |
| **Key Material** | Deployer wallets, trusted setup artifacts | Security |

**Want to verify? Challenge is permissionless.** You don't need our code to check if a commit is valid.

---

## Docs

- [Lab Report](docs/V1_22_LAB_REPORT.md)
- [Public Protocol Spec](docs/PROTOCOL_SPEC_PUBLIC.md)
- [Threat Model](docs/THREAT_MODEL.md)
- [Fee Model](docs/FEE_MODEL.md)
- [Instructions](docs/INSTRUCTIONS.md)
- [Security Checklist](docs/SECURITY_CHECKLIST.md)
- [FAQ](docs/FAQ.md)
- [Investor One-Pager](docs/ONE_PAGER_INVESTORS.md)

---

## Interfaces

- IDL: `interfaces/idl.dark_null_v1_22.json`
- Account notes: `interfaces/accounts.md`
- TS types: `interfaces/types.ts`

---

## Devnet Transactions

See [tx/devnet_links.md](tx/devnet_links.md) for verified E2E transaction links.

---

## Versioning

- Official version: **Dark Null Protocol v1.23**
- Current status: **Devnet verified (E2E)**
- Git tag: `v1.23`

---

## Part of Web0 Superstack

Dark Null Protocol is part of the **Parad0x Labs Web0 Superstack**:

| Product       | Purpose                   | Status        |
| ------------- | ------------------------- | ------------- |
| **Liquefy**   | Lossless data compression | Live          |
| **Nebula**    | Media compression         | Live          |
| **Dark Null** | Privacy payments          | Live (Devnet) |
| **.null**     | Sovereign naming          | Live          |

---

## Disclaimer

This repository does not provide a production-ready prover.  
It provides **public documentation and interfaces** for review and integration planning.

---

## Contact

- **Website**: [parad0xlabs.com](https://parad0xlabs.com)
- **Twitter**: [@Parad0x_Labs](https://x.com/Parad0x_Labs)
- **Discord**: [discord.gg/Q7SCJfMJtr](https://discord.gg/Q7SCJfMJtr)
- **Email**: hello@parad0xlabs.com

---

## License

Dark Null Protocol is proprietary software. © 2026 Parad0x Labs. All rights reserved.

The SDK and integration packages are licensed under MIT for ease of integration.

---

**Privacy you can defend. 🌑**
