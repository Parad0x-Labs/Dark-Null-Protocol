# Dark Null v1.22 — Threat Model

## Threats Considered

| Threat | Description |
|--------|-------------|
| **Double spend** | Reusing nullifier to withdraw same funds twice |
| **Commit griefing** | Spamming invalid commits to bloat state |
| **Challenge griefing** | Spamming frivolous challenges |
| **Account substitution** | Swapping recipient/relayer/treasury at finalize |
| **Vault drain** | Arithmetic underflow/overflow exploits |
| **Replay attacks** | Cross-protocol or cross-chain confusion |
| **Censorship** | Blocking legitimate challengers |

## Mitigations

### Double Spend Prevention
- Nullifier is marked spent **only at finalize**
- Duplicate finalize attempts are rejected
- Nullifier uniqueness enforced at PDA level

### Anti-Griefing
- **Commit bond** required to create PendingCommit
- **Challenger bond** required to submit challenge
- Economic cost deters spam attacks

### Account Binding
- Recipient, relayer, submitter, treasury validated against stored commit state
- Cannot substitute destination accounts at finalize

### Solvency Protection
- Vault balance checked before any payout
- `vault >= bond + amount` verified before finalize
- `vault >= reward` verified before challenge payout

### Arithmetic Safety
- All fee calculations use checked operations
- `total_fee <= amount` enforced
- No underflow/overflow possible on payout paths

### Replay / Confusion Prevention
- Domain separation in cryptographic operations
- Protocol-specific binding in all commitments

### Censorship Resistance
- Challenge path is **permissionless**
- Anyone with valid proof can challenge
- No trusted party required for verification

## Out of Scope (Public Documentation)

The following are intentionally not documented publicly:
- Circuit security review details
- Parameter generation pipeline
- Prover availability guarantees
- Relayer infrastructure hardening specifics
