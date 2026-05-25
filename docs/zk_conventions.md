# ZK Conventions for the Canonical BN254 Root

This document describes the current canonical root in this repository. Historical proof-pack and v17/v18 material can still be useful for context, but it is not the active integration target.

## Current Proof Shape

The promoted circuit exposes eight public signals:

```text
[commitment, nullifier, root, amount, receiver_token_part_0, receiver_token_part_1, mint_part_0, mint_part_1]
```

The verifier ABI passed to `groth16-solana` is:

| Section | Bytes | Meaning |
|---|---:|---|
| `proof_a` | 64 | G1 point `[x, y]` |
| `proof_b` | 128 | G2 point `[x.c1, x.c0, y.c1, y.c0]` |
| `proof_c` | 64 | G1 point `[x, y]` |
| Total | 256 | Current verifier ABI |

The compressed proof target remains 128 bytes. Keep the two claims separate: 256 bytes is the current public verifier ABI, 128 bytes is the compressed target/artifact class.

## Public Inputs

All public inputs are 32-byte big-endian BN254 Fr scalars.

```typescript
const FR = BigInt("21888242871839275222246405745257275088548364400416034343698204186575808495617");

function assertFr(name: string, bytes: Uint8Array) {
  const value = BigInt(`0x${Buffer.from(bytes).toString("hex")}`);
  if (value >= FR) {
    throw new Error(`${name} must be less than Fr`);
  }
}
```

The same integer value must be used in the Circom witness, SDK encoding, IDL payload, and Rust verifier path.

## G2 Encoding

`snarkjs` emits G2 points as `[[x.c0, x.c1], [y.c0, y.c1]]`. The Solana verifier path expects:

```text
[x.c1, x.c0, y.c1, y.c0]
```

Each limb is 32-byte big-endian.

## Withdraw V2 Encoding

`prepare_phantom_withdraw_v2` is the promoted payout-bound withdrawal path. The legacy three-signal withdraw path remains fail-closed.

The public-input order is:

```text
[
  commitment,
  nullifier,
  root,
  amount,
  receiver_token_part_0,
  receiver_token_part_1,
  mint_part_0,
  mint_part_1
]
```

Encoding rules:

- `amount` is `24` zero bytes followed by `u64_be`
- `receiver_token` and `mint` are each split into two 16-byte chunks
- each pubkey chunk is left-padded with 16 zero bytes to form one 32-byte Fr scalar
- every scalar must be less than the BN254 Fr modulus

Use the SDK helpers:

```typescript
import {
  encodeU64PublicInput,
  encodeBytes32PublicInputParts,
  encodeWithdrawV2PublicInputs,
  getProofEncoding,
} from "@dark-null/protocol";
```

## Regression Checks

Run the canonical checks before publishing proof claims:

```bash
npm run test:all
```

`cargo` is required for local Rust verification and is included in `npm run test:all`.

## Rotation Rule

`canonical-devnet-root-2` is promoted only when all of these agree:

- circuit
- zkey
- wasm
- verification key JSON
- Rust verifying key
- Rust instruction logic
- IDL
- manifest hashes
- SDK helpers
- proof-flow tests

Partial promotion is a security bug, not a release shortcut.
