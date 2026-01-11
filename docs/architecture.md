# Architecture Overview

## Dark Null Protocol — Technical Architecture

---

## High-Level Architecture

```
╔═══════════════════════════════════════════════════════════════════════════════╗
║  LAYER 4: DISTRIBUTION                                                        ║
║  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐             ║
║  │ npm/SDK     │ │ MCP Tools   │ │ Extension   │ │ PWA         │             ║
║  │ @dark-null/ │ │ AI Agents   │ │ Chrome/Edge │ │ Mobile      │             ║
║  └─────────────┘ └─────────────┘ └─────────────┘ └─────────────┘             ║
╠═══════════════════════════════════════════════════════════════════════════════╣
║  LAYER 3: INTEGRATIONS                                                        ║
║  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐                             ║
║  │ x402        │ │ Jupiter     │ │ Wallet      │                             ║
║  │ Middleware  │ │ Hook        │ │ Adapters    │                             ║
║  └─────────────┘ └─────────────┘ └─────────────┘                             ║
╠═══════════════════════════════════════════════════════════════════════════════╣
║  LAYER 2: INFRASTRUCTURE                                                      ║
║  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐             ║
║  │ Relayer     │ │ Receipt API │ │ Indexer     │ │ Micropay    │             ║
║  │ (Fly.io)    │ │ (IPFS)      │ │ (Events)    │ │ Batching    │             ║
║  └─────────────┘ └─────────────┘ └─────────────┘ └─────────────┘             ║
╠═══════════════════════════════════════════════════════════════════════════════╣
║  LAYER 1: CORE PROTOCOL (Solana On-Chain)                                     ║
║  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐             ║
║  │ Shield      │ │ Merkle Tree │ │ Groth16     │ │ Unshield    │             ║
║  │ Instruction │ │ Management  │ │ Verifier    │ │ Instruction │             ║
║  └─────────────┘ └─────────────┘ └─────────────┘ └─────────────┘             ║
║                                                                               ║
║  Program: 7niGgy3EBVZtFjY1Gjx2hoeNHzeiJER76sEVhd4S5p6w                       ║
╚═══════════════════════════════════════════════════════════════════════════════╝
```

---

## Core Protocol (Layer 1)

### Shield (Deposit)

```
User                    Program                 Vault
  │                        │                      │
  │─── shield(amount) ────▶│                      │
  │    + commitment        │                      │
  │                        │─── transfer ────────▶│
  │                        │                      │
  │                        │◀── store deposit ────│
  │◀── signature ──────────│                      │
```

1. User generates secret: `secret = random(32 bytes)`
2. Compute commitment: `commitment = Poseidon(secret, 0)`
3. Send shield instruction with commitment + SOL
4. Program stores commitment in Merkle tree

### Merkle Tree

```
                    ROOT
                   /    \
                  /      \
                H01      H23
               /  \     /   \
              H0  H1   H2   H3
              │   │    │    │
             C0  C1   C2   C3  ← Commitments (leaves)
```

- **Depth**: 20 levels
- **Capacity**: 2²⁰ = 1,048,576 deposits
- **Hash**: Poseidon (ZK-friendly)

### ZK Proof Generation

```
┌──────────────────────────────────────────────────────────────┐
│  CIRCUIT INPUTS                                              │
├──────────────────────────────────────────────────────────────┤
│  Private:                    Public:                         │
│  • secret                    • root (Merkle)                 │
│  • pathElements[20]          • nullifierHash                 │
│  • pathIndices[20]           • amount                        │
│                              • blindedRecipient              │
│                              • salt1, salt2, salt3           │
└──────────────────────────────────────────────────────────────┘
                         │
                         ▼
┌──────────────────────────────────────────────────────────────┐
│  GROTH16 PROOF                                               │
│  • proofA (G1): 32 bytes (compressed)                        │
│  • proofB (G2): 64 bytes (compressed)                        │
│  • proofC (G1): 32 bytes (compressed)                        │
│  Total: 128 bytes (industry-leading compression)             │
└──────────────────────────────────────────────────────────────┘
```

### Unshield (Withdraw)

```
User                    Program                 Vault
  │                        │                      │
  │─── unshield ──────────▶│                      │
  │    + proof             │                      │
  │    + nullifier         │─── verify proof ────▶│
  │    + recipient         │                      │
  │                        │─── check nullifier ─▶│
  │                        │    (not spent)       │
  │                        │                      │
  │                        │─── mark spent ──────▶│
  │                        │                      │
  │                        │─── transfer ────────▶│ → Recipient
  │◀── signature ──────────│                      │
```

---

## Infrastructure (Layer 2)

### Relayer Service

The relayer enables privacy by paying transaction fees on behalf of users:

```
┌──────────────────────────────────────────────────────────────┐
│  RELAYER SERVICE                                             │
├──────────────────────────────────────────────────────────────┤
│  Endpoints:                                                  │
│  • POST /v1/pay     → Full payment (shield+unshield)         │
│  • POST /v1/shield  → Shield only                            │
│  • POST /v1/unshield → Unshield only                         │
│  • GET  /v1/job/:id → Check job status                       │
│  • GET  /health     → Service health                         │
├──────────────────────────────────────────────────────────────┤
│  Job Processing:                                             │
│  1. Receive request                                          │
│  2. Execute shield (relayer pays fees)                       │
│  3. Wait for maturity                                        │
│  4. Generate ZK proof (snarkjs)                              │
│  5. Upload proof to IPFS                                     │
│  6. Execute unshield (relayer pays fees)                     │
│  7. Upload receipt to IPFS                                   │
│  8. Return result                                            │
└──────────────────────────────────────────────────────────────┘
```

### Micropayment Batching (PIE+PIP+PAP)

For sub-cent payments, batching reduces costs by 10,000x:

```
┌──────────────────────────────────────────────────────────────┐
│  PIE (Payment Intent Envelope)                               │
│  • User signs intent off-chain                               │
│  • No blockchain interaction                                 │
│  • Instant, free                                             │
└───────────────────────┬──────────────────────────────────────┘
                        │
                        ▼
┌──────────────────────────────────────────────────────────────┐
│  PIP (Payment Intent Pool)                                   │
│  • Collects PIEs in time windows (60s)                       │
│  • Computes netting between parties                          │
│  • Aggregates into batch                                     │
└───────────────────────┬──────────────────────────────────────┘
                        │
                        ▼
┌──────────────────────────────────────────────────────────────┐
│  PAP (Payment Aggregation Proof)                             │
│  • ONE ZK proof for ALL intents                              │
│  • SINGLE on-chain transaction                               │
│  • 10,000 payments → 1 TX fee                                │
└──────────────────────────────────────────────────────────────┘
```

### IPFS Storage (Pinata)

```
┌──────────────────────────────────────────────────────────────┐
│  IPFS STORAGE                                                │
├──────────────────────────────────────────────────────────────┤
│  Stored Items:                                               │
│  • ZK Proofs      → ipfs://Qm... (before on-chain)           │
│  • Receipts       → ipfs://Qm... (after unshield)            │
│  • Batch Proofs   → ipfs://Qm... (micropayment batches)      │
├──────────────────────────────────────────────────────────────┤
│  Benefits:                                                   │
│  • Immutable (can't be altered)                              │
│  • Decentralized (not just our servers)                      │
│  • Auditable (anyone can verify)                             │
│  • Permanent (with Pinata pinning)                           │
└──────────────────────────────────────────────────────────────┘
```

---

## Privacy Model

### What's Hidden

| Information | Hidden From |
|-------------|-------------|
| Sender identity | Public blockchain |
| Recipient identity | Public blockchain (without stealth addr) |
| Amount (with denominations) | Pattern analysis |
| Timing (with maturity) | Correlation attacks |

### What's Visible

| Information | Who Can See |
|-------------|-------------|
| Total pool balance | Public |
| Number of deposits | Public |
| Shield/unshield events | Public |
| Commitment hashes | Public (but unlinkable) |

### Anonymity Set

```
Anonymity Set Size = Number of deposits with same denomination

Example (0.1 SOL tier):
- 1,000 deposits of 0.1 SOL
- Anonymity set = 1,000
- Probability of correct guess = 0.1%
```

---

## Security Model

### Trust Assumptions

| Component | Trust Level | Failure Mode |
|-----------|-------------|--------------|
| Solana | Consensus | Network halt |
| ZK Proofs | Cryptographic | None (if math holds) |
| Relayer | Operational | Censorship (not theft) |
| IPFS | Availability | Data unavailable |

### What Relayer CAN'T Do

- ❌ Steal user funds
- ❌ Create fake proofs
- ❌ Link sender to recipient
- ❌ Reverse transactions

### What Relayer CAN Do

- ✅ Refuse to process transactions (censorship)
- ✅ See transaction amounts
- ✅ See recipient addresses

**Solution**: Users can run their own relayer or submit directly.

---

## Data Flow

### Complete Payment Flow

```
1. User → SDK
   "Pay 0.1 SOL to Bob privately"

2. SDK → Relayer
   POST /v1/pay { amount: 0.1, recipient: "Bob" }

3. Relayer → Solana
   shield(0.1 SOL, commitment)
   
4. Relayer (waits)
   Wait for maturity (40 slots)

5. Relayer → Circuit
   Generate ZK proof (snarkjs)

6. Relayer → IPFS
   Upload proof to Pinata

7. Relayer → Solana
   unshield(proof, nullifier, recipient)

8. Relayer → IPFS
   Upload receipt to Pinata

9. Relayer → SDK
   { status: "completed", txSig: "...", receipt: "ipfs://..." }

10. Bob receives 0.1 SOL
    No visible link to original sender!
```

---

## Performance Characteristics

| Metric | Value |
|--------|-------|
| Shield latency | ~400ms (1 TX) |
| Maturity wait | ~20s (devnet), ~10min (mainnet recommended) |
| Proof generation | ~2-5s (client), ~1s (server) |
| Unshield latency | ~400ms (1 TX) |
| Total (via relayer) | ~25s (devnet) |
| Proof size | 128 bytes (compressed) |
| On-chain storage | ~200 bytes per deposit |

---

## Scaling Considerations

### Current Limits

- Merkle tree: 1M deposits
- Nullifier pages: Paginated (unlimited)
- Relayer: Single instance (can scale horizontally)

### Future Scaling

- Multiple Merkle trees (sharding)
- Multi-region relayers
- L2 integration (for higher throughput)

---

## See Also

- [ZK Conventions](./zk-conventions.md) — Proof encoding details
- [API Reference](./api-reference.md) — SDK documentation
- [Integration Guide](./integration-guide.md) — How to integrate


