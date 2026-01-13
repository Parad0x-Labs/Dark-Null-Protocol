# 🌑 Dark Null Protocol v1.22 — 32B Lazy Verification Lab Report (Devnet)

**Parad0x Labs** | January 12–13, 2026 | Devnet E2E Test

## Executive Summary

End-to-end shield → commit → finalize completed using a **lazy verification** withdraw flow.
The happy path posts a **32-byte claim hash** on-chain and finalizes after a challenge window.

## Devnet Transaction Links

| Step | Transaction | Explorer |
|------|-------------|----------|
| Shield (Deposit) | `gcsnJM4wYvPMWnUpAq53UVU8CdNnXmsfSkBdwpEv9KVFydqvY8Nf4JN5TRH4uxyrhjgZgpT9mNeGbm63Bn9HBY1` | [View](https://solscan.io/tx/gcsnJM4wYvPMWnUpAq53UVU8CdNnXmsfSkBdwpEv9KVFydqvY8Nf4JN5TRH4uxyrhjgZgpT9mNeGbm63Bn9HBY1?cluster=devnet) |
| Commit (V20) | See devnet_links.md | — |
| Finalize (V20) | See devnet_links.md | — |

## Speed Metrics (sample run)

| Operation | Compute Units | Notes |
|-----------|---------------|-------|
| Shield | ~17k CU | Initial deposit |
| Commit (V20) | ~30k CU | 32B claim hash |
| Finalize (V20) | ~15k CU | After challenge window |

Total flow time depends on root update batching + challenge window configuration.

## Size Summary

- **On-chain proof payload in happy path: 32 bytes**
- Full proof bytes are only required in challenge path (rare)
- Explorers show full instruction data and account metas; "32B" refers to the **claim hash**, not total tx size

## Architecture Verified

- ✅ Shield creates commitment in anonymity set
- ✅ Commit posts 32B claim hash + starts challenge window
- ✅ Finalize releases funds after window expiry
- ✅ Nullifier marked spent (prevents double-spend)
- ✅ Recipient binding validated
- ✅ Fee distribution correct (protocol + relayer)

## Security Properties Tested

- ✅ Commitment uniqueness enforced
- ✅ Nullifier double-spend prevention
- ✅ Bond economics in place
- ✅ Checked arithmetic on all payout paths
- ✅ Account binding validation

## Notes

This lab report documents internal testing. Production deployment pending security audit.
