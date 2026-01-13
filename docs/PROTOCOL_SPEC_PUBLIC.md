# Dark Null Protocol v1.22 — Public Protocol Spec

## Goals

- Minimize on-chain proof payload for withdraws
- Keep challenge permissionless
- Prevent griefing and payout exploits
- Maintain clean trust boundaries

## Actors

| Actor | Role |
|-------|------|
| **User** | Wants private transfer |
| **Relayer** | Optional helper for UX / batching |
| **Challenger** | Permissionless verifier during window |

## Core Instructions (public interface)

| Instruction | Purpose |
|-------------|---------|
| `Shield` | Deposit funds into privacy pool |
| `CommitUnshieldV20` | Start withdraw via 32B claim hash |
| `ChallengeCommitV20` | Prove/verify during challenge window |
| `FinalizeUnshieldV20` | Release funds after window |

## State Machine

```
PendingCommit status transitions:

  PENDING ──┬──► REJECTED (invalid challenge)
            │
            └──► CONFIRMED (valid challenge) ──► FINALIZED
            │
            └──► FINALIZED (window expired, unchallenged)
```

### Rules

- **Finalize** only allowed if:
  - Status is `PENDING` and challenge window expired, OR
  - Status is `CONFIRMED`
- **Reject** if challenge proves invalid claim
- Status transitions are **one-way** (no rollback)

## Bonds

| Bond Type | Purpose |
|-----------|---------|
| **Commit bond** | Anti-grief deposit on commit |
| **Challenger bond** | Anti-spam for challenges |

Bond amounts are configured at protocol level and returned/slashed based on outcome.

## Security Boundary

### Happy path relies on:
- Correct state constraints and account binding
- Bonds + challenge window economics
- Solvency checks and checked arithmetic

### Challenge path:
- Is permissionless
- Does **not** depend on proprietary optimizations
- Anyone can submit standard proof encoding

## PDAs (high level)

| PDA | Seeds | Purpose |
|-----|-------|---------|
| Vault | Protocol-defined | Holds deposited funds |
| PendingCommit | Commitment-based | Stores withdraw claim state |
| NullifierPage | Nullifier-based | Tracks spent nullifiers |

Exact seed construction is part of the on-chain program interface (see IDL).
