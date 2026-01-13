# 🌑 Dark Null Protocol v1.22 (Devnet) — 32B Lazy Verification

Dark Null Protocol v1.22 — Solana privacy with a 32-byte on-chain claim (lazy verification).
Happy path stays tiny. Verification stays permissionless when it matters.

---

**Dark Null v1.22** is a Solana privacy transfer protocol that minimizes on-chain proof payload using a **lazy verification** model.

**Key idea:** the "happy path" posts only a **32-byte claim hash** on-chain. Full SNARK proof bytes are only required in a **permissionless challenge path** (rare).

> This repository is a **public interface + documentation shell**.  
> **Circuits, proving keys, relayer internals, and proprietary optimizations are intentionally not published.**

---

## What shipped (v1.22)

- ✅ **32B on-chain claim** (`commitment_hash`) for withdraw commits
- ✅ **Permissionless challenge**: anyone can submit a standard proof during the window
- ✅ **Finalize after window** (or early-confirmed) with low compute
- ✅ **Bond economics**: anti-grief + fraud incentives
- ✅ **Account binding**: recipient/relayer/submitter validated against commit state
- ✅ **Solvency & checked-math** protections in payout paths

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

## What is NOT public (by design)

- ZK circuits / wasm / zkey / ptau / verifying-key generation pipeline
- Prover/relayer internal job logic & anti-grief heuristics
- Any compression/encoding optimizations
- Key material, wallets, or deployment secrets
- Historical private engine code

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

- Official version: **Dark Null Protocol v1.22**
- Current status: **Devnet verified (E2E)**
- Git tag: `v1.22`

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
