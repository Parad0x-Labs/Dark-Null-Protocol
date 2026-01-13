# 🌑 Dark Null Protocol v1.22 — One-Pager (Investor / Partner)

**What it is**  
Dark Null is a Solana privacy transfer protocol that makes ZK-based privacy usable by pushing the **on-chain proof footprint** down to a **32-byte claim** on the happy path.  
Instead of posting full proof bytes every time, the protocol uses a **lazy verification** model: most transactions finalize cheaply, while correctness remains enforceable through a permissionless challenge path.

---

## Why this matters

### The problem
Privacy on public chains usually comes with one or more "deal breakers":
- heavy on-chain verification cost (compute + fees),
- large transaction payloads (network + account constraints),
- complex UX that scares normal users away,
- centralization risk (if "only the team can verify").

### The approach
Dark Null v1.22 separates the UX path from the fraud-proof path:

- **Happy path (expected):** publish a **32B claim hash**, wait a short window, finalize cheaply.
- **Fraud path (rare):** anyone can challenge by submitting a standard proof; the program verifies and enforces outcomes.

This structure makes privacy fast and cheap **without making correctness trust-based**.

---

## What makes "32 bytes" huge

"32B" is the size of the on-chain **claim hash** used for withdraw commits in the happy path.
That creates real wins:
- **Lower network overhead** (smaller instruction payload)
- **Lower compute** on the frequent path
- **Higher throughput** (more privacy actions per block)
- **Better UX** (faster confirmations, fewer failure points)
- **Cleaner integration** for agents/micropayments (small, programmable commitments)

Important clarification: total transaction size includes accounts and headers—"32B" refers to the **proof/claim payload**, not the entire tx.

---

## Security model (high level)

**Permissionless challenge design**
- Anyone can challenge during a short window.
- If the claim is invalid, bonds and incentives punish the attacker and reward challengers.
- If the claim is valid, the system finalizes normally and discourages spam challenges.

**Bond economics**
- Commit bond: deters commit spam / griefing
- Challenger bond: deters frivolous challenges
- On-chain checks include: destination binding, solvency checks, and checked arithmetic.

**Trust boundary**
- Security does *not* depend on proprietary compression or private infrastructure.
- Proprietary optimizations are used for internal efficiency only.

---

## What's live today (Devnet)

- v1.22 devnet E2E: shield → commit (32B) → finalize
- Clean state machine + binding checks
- Solvency + fee safety checks
- Challenge path supported (permissionless)

(Devnet tx links available in the lab report.)

---

## Market fit (where this wins)

Dark Null is not "privacy for everyone" on day one; it's privacy that is **cheap enough** and **simple enough** to ship into real products:
- **AI agents / x402-style payments** (micropayments, budgets, automation)
- **Consumer apps** that need private value transfer without insane fees
- **Trading / gaming / creator economy** where privacy is a feature, not an ideology

---

## Roadmap (pragmatic)

**Near term**
- Mainnet hardening + audits
- Stress tests + adversarial test suite expansion
- UX wrappers: payment links, QR flows, "one-click private send"

**Medium term**
- Aggregation / batching optimizations (where appropriate)
- Multi-tenant relayer support + reliability tooling
- Compliance-ready toggles for product integrations (policy layers above the protocol)

---

## The ask (how partners can engage)

- Integrate as a **private payout rail**
- Integrate as an **agent payment rail**
- Run a relayer / challenger infrastructure node (future)
- Support audit / formal review

---

**Parad0x Labs — Dark Null Protocol v1.22**  
*"Minimal on-chain footprint. Permissionless accountability."*
