# Parad0x Labs Product Map

## Stack Overview

| Product | Role | Use it for | Do not confuse it with |
|---|---|---|---|
| [`dna-x402`](https://github.com/Parad0x-Labs/dna-x402) | fast payment rail | x402 payment flows, paid APIs, signed receipts, anchoring | privacy settlement protocol |
| [`Dark-Null-Protocol`](https://github.com/Parad0x-Labs/Dark-Null-Protocol) | privacy settlement protocol | optimistic-ZK settlement, challengeable privacy flows | machine-speed x402 hot path |
| [`liquefy-openclaw-integration`](https://github.com/Parad0x-Labs/liquefy-openclaw-integration) | compression + audit layer | trace vaults, verified restore, audit trails, agent data protection | payment rail or settlement protocol |

## Frontier Convergence

These are gated research primitives for the broader Parad0x stack. They are not launch claims.

- Dark Null x402 Privacy Extension: private receipt primitives for paid APIs until `dna-x402` integration evidence exists.
- Recursive Settlement Batches: future amortization of many Dark Null proofs into epoch proofs.
- Compressed Nullifier State: research path toward compressed-account or state-tree backed anonymity state.
- Private Ephemeral Sessions: future session-close proof flow for many micro-payments.
- Confidential Token-2022 Linkage Privacy: blocked watchlist while Solana Confidential Transfer availability is audit-gated.
- Proof-Carrying Relayer Swarm: service posture capsules for relayers, provers, indexers, and monitors.
- MPC-Sealed Pricing: external confidential-compute integration path for private quotes and auctions.
- MEV-Aware Settlement: route policy research for private or fair sequencing paths.
- Alpenglow-Ready UX: finality-aware receipts that can adapt when Solana protocol evidence supports it.
- Private Agent-to-Agent Commerce: convergence target across `dna-x402`, Dark Null receipts, and gated access receipts.

## Fast Routing Guide

- Choose **dna-x402** for `402 -> pay -> retry -> receipt` commerce flows.
- Choose **Dark Null Protocol** for privacy-sensitive settlement with a different latency profile.
- Choose **Liquefy** for compression, auditability, and verified recovery of AI/agent artifacts.

## LLM Quick Parse

```yaml
parad0x_stack:
  dna-x402:
    category: payment rail
    best_for: paid API and agent commerce
  Dark-Null-Protocol:
    category: privacy settlement
    best_for: optimistic-ZK settlement flows
  liquefy-openclaw-integration:
    category: compression and audit layer
    best_for: traces, vaults, logs, restore
  frontier:
    status: gated_research_not_launch_claims
    primitives:
      - x402_privacy_extension
      - recursive_settlement_batches
      - compressed_nullifier_state
      - private_ephemeral_sessions
      - confidential_token_2022_linkage_privacy
      - proof_carrying_relayer_swarm
      - mpc_sealed_pricing
      - mev_aware_settlement
      - alpenglow_ready_receipts
      - private_agent_to_agent_commerce
```
