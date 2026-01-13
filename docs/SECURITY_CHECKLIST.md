# Dark Null v1.22 — Security Checklist (Public)

## Protocol Invariants

### State Guards

- [ ] Protocol pause guard enforced for all state-changing instructions
- [ ] Root reference must point to a valid stored root
- [ ] PendingCommit status transitions are one-way (no rollback)

### Nullifier Safety

- [ ] Nullifier is inserted exactly once
- [ ] Duplicate finalize attempts are rejected
- [ ] Nullifier uniqueness enforced at PDA level

### Timing Constraints

- [ ] Finalize only allowed after challenge window expires (unless confirmed)
- [ ] Challenge only allowed during active window
- [ ] Window boundaries use slot-based timing

### Solvency Checks

- [ ] `vault >= bond + amount` before finalize payout
- [ ] `vault >= reward` before challenge payout
- [ ] Balance checks before any transfer

### Arithmetic Safety

- [ ] All fee calculations use checked operations
- [ ] `total_fee <= amount` enforced
- [ ] No underflow possible on payout subtraction
- [ ] No overflow possible on fee accumulation

### Account Binding

- [ ] Recipient validated against stored `recipient_pubkey`
- [ ] Relayer validated against stored `relayer_pubkey`
- [ ] Submitter validated against original signer
- [ ] Treasury validated against protocol treasury

### Challenge Input Binding

- [ ] Public inputs must match stored values:
  - Root hash
  - Nullifier hash
  - Amount
  - Blinded recipient
- [ ] Input ordering must be correct

## Anti-Grief Measures

- [ ] Commit requires bond deposit
- [ ] Challenge requires bond deposit
- [ ] Bond economics discourage spam

## Permissionless Verification

- [ ] Anyone can challenge within the window
- [ ] Challenge path accepts standard proof encoding
- [ ] Security does **not** depend on proprietary compression
- [ ] No trusted party required for verification

## Audit Status

| Auditor | Date | Scope | Status |
|---------|------|-------|--------|
| TBD | Q1 2026 | Full Protocol | ⏳ Scheduled |

---

*This checklist documents security properties. Formal audit pending.*
