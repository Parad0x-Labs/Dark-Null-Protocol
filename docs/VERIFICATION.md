# Dark Null Protocol v1 - Verification Specification

**Version:** 1.0 (Locked)
**Status:** Canonical Source of Truth

This document defines the binary encoding, hashing, and validation rules for Proof Packs, ensuring interoperability between the Dark Null Client (SDK), Relayer, and On-chain Program.

## 1. Proof Pack Schema (V1)

The Proof Pack is the transport container for a confidential withdrawal request. It is defined in `infra/shared/src/proofPack.ts`.

### 1.1 Structure
A valid Proof Pack is a JSON object with the following fields:

| Field | Type | Description |
|---|---|---|
| `version` | string | Constant `"v1"` |
| `protocol` | string | Constant `"dark-null"` |
| `cluster` | string | One of `"devnet"`, `"testnet"`, `"mainnet-beta"` |
| `programId` | string | Base58 Public Key of the Dark Null program |
| `rootRef` | integer | Index (0-255) of the Merkle Root in the on-chain history ring |
| `amountLamports` | string | Numeric string (u64) representing value |
| `denomId` | integer (opt) | ID of the denomination if standard |
| `inputs` | object | ZK Public Inputs (see 1.2) |
| `proof` | object | ZK Proof Bytes (see 1.3) |
| `recipientPubkey` | string (opt) | Base58 Public Key of the recipient (anti-replay binding) |
| `intent` | object (opt) | Signature and replay protection for the Relayer |
| `expirySlot` | integer (opt) | Block slot after which the pack is invalid |
| `packSha256` | hex string | SHA256 integrity hash of the JSON content |

### 1.2 Public Inputs (`inputs`)
All values are **32-byte Hex Strings** (64 hex characters), Big Endian.

| Field | Description |
|---|---|
| `root` | Merkle Root matching `rootRef` |
| `nullifierHash` | Unique nullifier derived from private key |
| `blindedRecipient` | Recipient address hashed/blinded for ZK check |
| `salt1`, `salt2`, `salt3` | Entropy for commitment integrity |

### 1.3 Proof Bytes (`proof`)
Groth16 Proof elements encoded for Solana `alt_bn128` syscalls.

| Field | Bytes | Hex Chars | Format |
|---|---|---|---|
| `A` | 64 | 128 | G1 Point `[x, y]` (Big Endian) |
| `B` | 128 | 256 | G2 Point `[x.c1, x.c0, y.c1, y.c0]` (Big Endian) |
| `C` | 64 | 128 | G1 Point `[x, y]` (Big Endian) |
| `seed` | 16 | 32 | RNG Seed for deterministic regeneration |

**Critical Encoding Rule (G2):**
The Solana syscall expects G2 points as `[x.c1, x.c0, y.c1, y.c0]`.
Standard SnarkJS/Circom export is `[[x0, x1], [y0, y1]]` (where `element = x0 + x1*u`).
**Transformation:** You must swap the coefficients of the extension field elements.
`Solana_G2 = [x1, x0, y1, y0]` (if SnarkJS outputs `[x0, x1]`).

### 1.4 Endianness
- All Scalar Fields (Fr) are **Big Endian** 32-byte arrays.
- All Curve Points (G1, G2) coordinates are **Big Endian** 32-byte arrays.
- `packSha256` is a Hex string of the SHA256 digest.

## 2. Integrity Hashing

### 2.1 `packSha256` Calculation
1. Create a copy of the pack object.
2. Remove `packSha256` field.
3. Sort keys alphabetically (canonical JSON).
4. Serialize to string.
5. Compute SHA256.
6. Store as Hex string.

## 3. Relayer Validation Rules

The Relayer enforces the following **Hard Gates**:

1. **Signature Verification:** If `intent` is present, `signature` must verify against `recipientPubkey` over the `computePackCoreHash(pack)`.
2. **Expiry:** `current_slot <= pack.expirySlot`.
3. **Cluster Match:** `pack.cluster` matches the running Relayer environment.
4. **Program Match:** `pack.programId` matches the deployed Program ID.
5. **Denom Check:** `amountLamports` matches `denomId` (if provided).
6. **Integrity:** `computePackHash(pack) === pack.packSha256`.

## 4. On-Chain Verification

The on-chain program (`programs/paradox_v18/src/lib.rs`) enforces:

1. **Proof Verification:** `groth16_verify(proof, public_inputs) == true`.
2. **Root History:** `inputs.root` exists in the `root_history` ring buffer.
3. **Nullifier Uniqueness:** `inputs.nullifierHash` has not been marked seen.
4. **Recipient Binding:** `inputs.blindedRecipient` matches hash of `transaction.recipient`.
5. **Fee Integrity:** `proof_amount == transfer_amount + fee`.

---

**Audit Status:**
- Encoding Rules: **VERIFIED** (Codebase matches Spec)
- VK Match: **VERIFIED** (Script `scripts/verify_vk_match.ts` passes)

