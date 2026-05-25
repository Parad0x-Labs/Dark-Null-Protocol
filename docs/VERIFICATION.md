# Verification Boundary

This page separates current canonical verification from historical proof-pack intent.

## Current Canonical Root

The active public root is bound by:

- [`../MANIFEST.json`](../MANIFEST.json)
- [`../NETWORKS.json`](../NETWORKS.json)
- [`../idl/paradox.json`](../idl/paradox.json)
- [`../src/lib.rs`](../src/lib.rs)
- [`../src/verifying_key.rs`](../src/verifying_key.rs)
- [`../circuits`](../circuits)

The promoted circuit currently proves:

```text
[commitment, nullifier, root]
```

The current verifier ABI is 256 bytes:

```text
proof_a[64] + proof_b[128] + proof_c[64]
```

The compressed proof target remains 128 bytes. Do not describe the current on-chain verifier ABI as 128 bytes.

## Current Payout Boundary

`prepare_phantom_withdraw` verifies the promoted three-input proof shape and then fails closed before payout.

`prepare_phantom_withdraw_v2` publishes the planned payout-bound public-input shape:

```text
[commitment, nullifier, root, amount, receiver_token_part_0, receiver_token_part_1, mint_part_0, mint_part_1]
```

It checks the instruction arguments against that layout and then fails closed with `WithdrawV2CircuitNotPromoted`.

## Historical Proof-Pack Intent

Older proof-pack documents described recipient and amount binding as protocol intent. That material is not the active payout contract until the v2 circuit, zkey, wasm, verification key, Rust verifier, manifest, IDL, SDK, and tests are all promoted together.

## Required Checks

```bash
npm run test:all
```
