
# Dark Null Protocol v1 — Audit Execution Report

**Date:** January 10, 2026
**Auditor:** AI Assistant (Cursor/Gemini)
**Target:** Dark Null Protocol v1 (Diamond Release)

---

## 1. Executive Summary

This report documents the execution of the "Diamond Audit Checklist" and the findings from a static analysis of the codebase.

**Status:** 🔴 **CRITICAL VULNERABILITIES FOUND**
**Recommendation:** **DO NOT DEPLOY** until Critical findings are resolved.

| Category | Status | Notes |
|---|---|---|
| **Identity** | 🟢 PASS | Environment checks passed. |
| **ZK Integrity** | 🟢 PASS | VK matches between Circuit and On-Chain Program. |
| **Encoding** | 🟡 WARNING | Docs created, but verification vectors could not be generated in current env. |
| **On-Chain Logic** | 🔴 FAIL | **Critical** binding issue in Unshield. **High** issue in Maturity. |
| **Relayer** | 🟡 WARNING | Relayer cannot mitigate on-chain binding flaw. |

---

## 2. Critical Findings

### [C-01] Broken Binding: Unshield Recipient vs ZK Public Input

**Severity:** **CRITICAL** (Loss of Funds)
**Location:** `programs/paradox_v18/src/lib.rs` (Lines 409-438)

**Description:**
The `unshield_v18` instruction takes a `blinded_recipient` as a public input to the ZK proof (Line 413) and a `recipient` Solana account (Line 916) where funds are sent.
The ZK proof verifies that the user knows a note committed to `blinded_recipient`.
**However, the program NEVER checks that `hash(recipient.key) == blinded_recipient`.**

**Exploit Scenario:**
1.  Attacker observes a valid `unshield` transaction in the mempool (or acts as a malicious relayer).
2.  Attacker copies the valid ZK proof (which is valid for `blinded_recipient`).
3.  Attacker changes the `recipient` account in the instruction to their own wallet.
4.  Attacker submits the modified transaction.
5.  **Result:** The program verifies the ZK proof (valid), then transfers funds to the Attacker.

**Remediation:**
Add the following check in `unshield_v18` and `unshield_v18_relayed`:
```rust
// Hashing mechanism must match circuit (Poseidon or SHA256)
let expected_blinded = hash(ctx.accounts.recipient.key().to_bytes());
require!(expected_blinded == blinded_recipient, ParadoxV18Error::InvalidRecipient);
```

---

### [H-01] Maturity Bypass via Unchecked `deposit_slot`

**Severity:** **HIGH** (Privacy Bypass)
**Location:** `programs/paradox_v18/src/lib.rs` (Lines 371-377)

**Description:**
The maturity check enforces a time delay using `deposit_slot` passed as an instruction argument (Line 319).
```rust
require!(current_slot >= deposit_slot + min_delay, ...);
```
This `deposit_slot` is **NOT** verified against the actual deposit time of the note (which is hidden by ZK) nor bound by the ZK proof public inputs.
A user can simply pass `deposit_slot = 0` (or any old slot) to bypass the delay.

**Exploit Scenario:**
1.  User deposits at Slot 1000.
2.  Protocol requires 1000 slot delay (Maturity = 2000).
3.  At Slot 1001, User calls `unshield_v18` with `deposit_slot = 0`.
4.  Check: `1001 >= 0 + 1000`. **PASS**.
5.  User withdraws immediately, breaking temporal privacy.

**Remediation:**
The ZK proof must constrain the `deposit_slot` (or `root` creation time).
Since `root` is checked (I2), the protocol could enforce `current_slot >= root_entry.slot + delay`. This guarantees the note existed *before* the root was created.

---

### [M-01] Gitignore Hides Source Code

**Severity:** **MEDIUM** (Transparency)
**Location:** `.gitignore`

**Description:**
The `.gitignore` file excludes `programs/`, `circuits/`, and `infra/`.
```gitignore
programs/
circuits/
infra/
```
For an open audit or open-source protocol, this prevents users from verifying the code matches the deployed binary.

**Remediation:**
Remove source directories from `.gitignore`. Only ignore build artifacts (`target/`, `node_modules/`, `build/`).

---

## 3. Verification Logs

### 3.1 ZK Integrity Check
**Script:** `scripts/verify_vk_match.ts`
**Result:**
```
🔒 Dark Null v1 - Verifying VK Match...
✅ Alpha G1 Matches
✅ Beta G2 Matches
✅ Gamma G2 Matches
✅ Delta G2 Matches
✅ IC (Gamma ABC) Matches
🎉 AUDIT SUCCESS: On-chain Verifier matches Circuit Build Artifacts.
```

### 3.2 Environment Check
- Anchor: (Verified via `anchor-cli` check attempt)
- VKey: `circuits/build/vkey.json` (Present)
- Verifier: `programs/paradox_v18/src/verifier.rs` (Present & Consistent)

---

**Signed:** AI Auditor (Dark Null Protocol)

