# Dark Null v1.22 — Account Structures (Public Notes)

> Historical note: `PendingCommit` and the finalize/challenge fields below describe the older v1.22 design track. The current canonical public root only uses the bounded `Vault` plus `RootAuthorityConfig`, and it fails closed before payout.

## PendingCommit

Stores the state of a pending withdrawal claim during the challenge window.

### Fields (conceptual)

| Field | Type | Description |
|-------|------|-------------|
| `commitment_hash` | `[u8; 32]` | 32B claim hash |
| `nullifier_hash` | `[u8; 32]` | Unique spend identifier |
| `blinded_recipient` | `[u8; 32]` | Privacy-preserving recipient binding |
| `proof_reference` | `[u8; 32]` | Data availability reference (CID/hash) |
| `root_hash` | `[u8; 32]` | Merkle root at commit time |
| `amount` | `u64` | Withdrawal amount in lamports |
| `bond_lamports` | `u64` | Commit bond amount |
| `commit_slot` | `u64` | Slot when commit was created |
| `deadline_slot` | `u64` | Challenge window end slot |
| `status` | `u8` | Current status (Pending/Confirmed/Rejected/Finalized) |
| `submitter` | `Pubkey` | Original commit signer |
| `recipient_pubkey` | `Pubkey` | Expected destination |
| `relayer_pubkey` | `Pubkey` | Expected relayer |

### Status Values

| Value | Meaning |
|-------|---------|
| 0 | Pending (in challenge window) |
| 1 | Confirmed (valid challenge received) |
| 2 | Rejected (invalid challenge received) |
| 3 | Finalized (funds released) |

### Validated at Finalize

The following fields are validated when `FinalizeUnshieldV20` is called:

- `recipient_pubkey` must match the provided recipient account
- `relayer_pubkey` must match the provided relayer account
- `submitter` must match the provided submitter account
- `status` must be Pending (with expired window) or Confirmed
- `deadline_slot` must be in the past (if status is Pending)

### Validated at Challenge

The following are validated when `ChallengeCommitV20` is called:

- `status` must be Pending
- `deadline_slot` must be in the future
- Public inputs must match stored values (root, nullifier, amount, blinded_recipient)

---

## Vault

The canonical root vault holds the live bounded state window.

| Field | Type | Description |
|-------|------|-------------|
| `roots` | `[[u8; 32]; 20]` | Live accepted Merkle roots |
| `root_count` | `u32` | Number of live roots currently stored |
| `nullifier_count` | `u32` | Number of spent nullifiers currently stored |
| `leaf_count` | `u64` | Number of deposits accepted into the current bounded window |
| `next_index` | `u32` | Next deposit slot in the bounded leaf window |
| `leaves` | `[u8; 4096]` | 128 commitment slots |
| `nullifiers` | `[u8; 4096]` | 128 nullifier slots |

The current public root now hard-fails when these bounded windows are full. It does not silently overwrite old entries anymore.

---

## RootAuthorityConfig

Stores the privileged signer that is allowed to publish new Merkle roots.

| Field | Type | Description |
|-------|------|-------------|
| `authority` | `Pubkey` | Root updater authority |

---

## NullifierPage

Stores spent nullifiers to prevent double-spend.

| Field | Type | Description |
|-------|------|-------------|
| `nullifiers` | `[[u8; 32]; N]` | Array of spent nullifier hashes |
| `count` | `u64` | Number of entries used |

Nullifier is added at finalize. Duplicate nullifiers are rejected.
