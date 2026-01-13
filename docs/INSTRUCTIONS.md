# Dark Null v1.22 — Instructions (Public Interface)

## Overview

Dark Null v1.22 uses four main instructions for the privacy transfer flow.

---

## Shield

**Purpose:** Deposit funds into the privacy pool.

Creates a note commitment in the anonymity set. The depositor receives a secret that can later be used to withdraw.

**Effects:**
- Transfers SOL from user to vault
- Creates deposit metadata on-chain
- Commitment added to the set

---

## CommitUnshieldV20

**Purpose:** Start a withdraw using a **32-byte claim hash** + metadata.

Initiates the challenge window. The submitter posts a compact claim instead of full proof bytes.

**Inputs (conceptual):**
- `commitment_hash` — 32B claim hash
- `nullifier_hash` — Unique spend identifier
- `blinded_recipient` — Privacy-preserving recipient binding
- `proof_reference` — Data availability reference (hash/CID)
- `amount` — Withdrawal amount
- `root_reference` — Merkle root hash
- `recipient_pubkey` — Expected destination
- `relayer_pubkey` — Expected relayer (if any)

**Effects:**
- Creates PendingCommit PDA
- Transfers commit bond into vault
- Starts challenge window countdown

---

## ChallengeCommitV20

**Purpose:** Allow anyone to challenge a pending commit during the window.

Permissionless verification path. Challenger submits a proof; the program verifies correctness.

**Inputs:**
- `proof_bytes` — Standard proof encoding
- `public_inputs` — Minimal input set matching the claim

**Effects (if proof invalid):**
- Commit status → REJECTED
- Bonds redistributed per rules
- Challenger rewarded

**Effects (if proof valid):**
- Commit status → CONFIRMED
- Challenger bond slashed
- Early finalization enabled

---

## FinalizeUnshieldV20

**Purpose:** Release funds after challenge window expiry (or early confirmation).

Completes the withdrawal and marks the nullifier as spent.

**Requirements:**
- Status is PENDING and window expired, OR
- Status is CONFIRMED

**Effects:**
- Marks nullifier as spent (prevents double-spend)
- Returns commit bond to submitter
- Transfers net amount to recipient
- Transfers protocol fee to treasury
- Transfers relayer fee to relayer
- Closes PendingCommit PDA

---

## Account Validation

All instructions validate that destination accounts match the stored commit state:
- Recipient must match `recipient_pubkey` from commit
- Relayer must match `relayer_pubkey` from commit
- Submitter must match original commit signer
- Treasury must be the protocol treasury

This prevents account substitution attacks at finalize time.
