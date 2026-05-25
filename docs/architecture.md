# Architecture Overview

This page describes the canonical public devnet root. Older diagrams and roadmap-only infrastructure have been removed from this page on purpose: if a feature is not backed by the root source, artifacts, manifest, SDK, and tests, it belongs in the claims ledger as blocked or roadmap.

Start with:

- [`../MANIFEST.json`](../MANIFEST.json)
- [`../NETWORKS.json`](../NETWORKS.json)
- [`../src/lib.rs`](../src/lib.rs)
- [`../src/verifying_key.rs`](../src/verifying_key.rs)
- [`../idl/paradox.json`](../idl/paradox.json)
- [`../sdk/index.mjs`](../sdk/index.mjs)
- [`CLAIMS_LEDGER.md`](./CLAIMS_LEDGER.md)

## Current Shape

```text
Client / SDK
  |
  | public inputs + Groth16 proof
  v
Dark Null Solana program
  |
  | verifies promoted public-input shape
  | records nullifier
  | transfers only through payout-bound v2 path
  v
Vault token account -> receiver token account
```

The canonical release surface is intentionally small:

- one program id in `MANIFEST.json`, `NETWORKS.json`, `Anchor.toml`, IDL, and Rust source
- one promoted circuit bundle: circuit, R1CS, zkey, wasm, witness helper, and verifying key
- one JavaScript SDK entry point with artifact metadata and public-input encoders
- one Rust verifier path
- one mainnet gate that stays blocked until deployment, audit, and setup evidence exist

## Proof Path

The current promoted proof shape has eight public inputs:

```text
commitment
nullifier
root
amount
receiver_token_part_0
receiver_token_part_1
mint_part_0
mint_part_1
```

Encoding rules:

- `amount` is `24` zero bytes followed by a `u64` big-endian value
- each Solana public key is split into two 16-byte chunks
- each chunk is left-padded to a 32-byte scalar so it remains below the BN254 scalar field
- the current `groth16-solana` verifier ABI is 256 bytes
- the compressed proof target/artifact class is 128 bytes

## Program Behavior

The current root program is a settlement prototype, not a generic network.

Delivered behavior:

- shield records commitments
- root updates are authority-controlled and bounded
- legacy proof-unbound withdraw fails closed
- `prepare_phantom_withdraw_v2` verifies the promoted eight-input proof shape
- payout v2 binds amount, receiver token account, and mint before transfer
- nullifier recording prevents replay

Known limits:

- root derivation is not append-only in-program yet
- root updates still rely on a privileged updater
- final mainnet setup evidence is not published
- no completed third-party audit is published
- mainnet deployment evidence is not published

## Trust Boundaries

| Boundary | Current trust assumption | Required before mainnet |
|---|---|---|
| Solana runtime | Solana consensus and token program behavior | audited deployment configuration |
| Root updates | privileged root updater | stronger root derivation or accepted operational controls |
| Groth16 artifacts | manifest-bound devnet artifact set | final setup evidence and external audit acceptance |
| Payout path | v2 proof-bound transfer path | audited release commit and mainnet evidence |
| Relayer, if used | censorship only; direct submission must remain possible | documented fallback and operating limits |

## Not Current Claims

Dark Null does not currently claim a validator network, BFT consensus layer, private compute engine, separate bridge product, completed external audit, completed public ceremony, or mainnet-ready deployment.

Those ideas may be evaluated later, but they are not part of the current canonical root.

## Verification

Run the cumulative validation lane:

```bash
npm run test:all
```

For launch gates:

```bash
npm run check:mainnet:evidence
npm run check:mainnet
```

Those launch gates are expected to fail until the evidence in [`MAINNET_READINESS.md`](./MAINNET_READINESS.md) exists.
