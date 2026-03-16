# Security Model

This file describes the **current public root source model**. It is not an external audit and it is not a mainnet sign-off.

## Assets Protected

- deposited funds held in the vault token account
- valid Merkle roots accepted by the withdrawal verifier path
- nullifier uniqueness within the live canonical state window

## Trusted Components

- the Groth16 circuit artifacts published in [`circuits`](./circuits)
- the generated verifying key in [`src/verifying_key.rs`](./src/verifying_key.rs)
- the privileged root updater recorded in the `RootAuthorityConfig` PDA

## Attacker Model

Assume an attacker can:

- submit arbitrary deposits
- submit arbitrary withdrawal attempts
- replay old proofs
- submit malformed public inputs
- attempt unauthorized root updates
- try to exhaust bounded root / leaf / nullifier storage

Assume the attacker cannot:

- forge a valid Groth16 proof for false public inputs
- sign as the configured root authority

## Core Invariants

- a withdrawal root must already exist in the live root set
- a nullifier may not be reused within the live nullifier window
- `update_root` must be signed by the configured `RootAuthorityConfig.authority`
- deposit, root, and nullifier storage now **hard-fail** when the bounded public window is full
- the public inputs `[commitment, nullifier, root]` must match the withdrawal instruction arguments
- the public root must not release funds from proof-unbound instruction arguments; the canonical payout path now fails closed instead

## Known Trust Seams

- root evolution is still off-chain: deposits append commitments, but the Merkle root is still computed externally and then published via `update_root`
- the canonical public root keeps a bounded live state window rather than paged append-only history
- the hardened root source is stronger than the earlier public devnet snapshot, but still depends on a trusted root updater
- the current canonical circuit does not yet expose payout-bound public inputs for withdrawal amount or recipient, so the public root rejects payout rather than trusting those instruction fields

## Privacy Caveats

- encrypted note distribution and relayer behavior are outside the proof system itself
- the proof currently binds `[commitment, nullifier, root]`, not payout amount or recipient
- off-chain timing, RPC patterns, and note delivery can still leak information

## Review Checklist

1. Verify the root updater path in [`src/lib.rs`](./src/lib.rs).
2. Verify the live artifact binding in [`MANIFEST.json`](./MANIFEST.json).
3. Run `npm test` and `cargo test --offline`.
4. Read [`SECURITY.md`](./SECURITY.md) and [`PROTOTYPE_STATUS.md`](./PROTOTYPE_STATUS.md).
