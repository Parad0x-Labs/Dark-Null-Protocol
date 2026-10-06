# Security Model

This file describes the **current public root source model**. It is not an external audit and it is not a mainnet sign-off.

## Assets Protected

- deposited funds held in the vault token account
- valid Merkle roots accepted by the withdrawal verifier path
- nullifier uniqueness within the live canonical state window

## Trusted Components

- the Groth16 circuit artifacts published in [`circuits`](./circuits)
- the generated verifying key in [`src/verifying_key.rs`](./src/verifying_key.rs)
- the setup process documented in [`CEREMONY.md`](./CEREMONY.md)
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
- `prepare_phantom_withdraw_v2` public inputs must match commitment, nullifier, root, amount, receiver token account, and mint arguments
- v2 payout transfers only from a token account owned by the vault PDA and only into the signed receiver's token account
- the legacy `prepare_phantom_withdraw` path remains fail-closed because its old three-signal proof shape does not bind payout semantics

## Known Trust Seams

- root evolution is still off-chain: deposits append commitments, but the Merkle root is still computed externally and then published via `update_root`
- the canonical public root keeps a bounded live state window rather than paged append-only history
- the hardened root source is stronger than the earlier public devnet snapshot, but still depends on a trusted root updater
- the v2 note commitment binds the receiver token account and mint at note creation time; that is safer for payout authorization but less flexible than recipient-chosen withdrawals
- the current setup evidence is development-grade; mainnet needs final ceremony evidence or explicit audit acceptance of the setup path

## Privacy Boundary

The root program is a devnet prototype for proof-verified withdrawals. The payout fields (amount, receiver token account, mint) and the note commitment are public, so a withdrawal is linkable to its deposit in the current construction. Unlinkable withdrawals are planned protocol work. The full property matrix is [`docs/PRIVACY_PROPERTIES.md`](./docs/PRIVACY_PROPERTIES.md).

- the promoted proof's public inputs are `[commitment, nullifier, root, amount, receiver_token_part_0, receiver_token_part_1, mint_part_0, mint_part_1]`
- the deposit publishes the same `commitment` as an instruction argument and stores it in `Vault.leaves`; `debit_withdrawal` debits the record for `public_inputs[0]`, so commitment equality (and the changed `deposited_amounts` slot) identifies the spent deposit; reproduced from public data by [`tests/privacy_linkage.rs`](./tests/privacy_linkage.rs)
- deposit amount, withdrawal amount, depositor, receiver token account and mint are public
- `receiver` is a required signer of `prepare_phantom_withdraw_v2`; this program has no relayer path
- the depth-7 tree has 128 leaf positions; that is storage capacity, not an anonymity set
- what the prototype does protect: knowledge of the note opening is required to withdraw, each nullifier is accepted once, payouts cannot be redirected, withdrawals cannot exceed the deposit recorded for the commitment, and note secrets (`blinding`, `nullifier_secret`) stay off-chain
- encrypted note distribution (`PDX_WHISPER` logs) is outside the proof system itself
- off-chain timing, RPC patterns, fee payers, and note delivery can leak further information

## Review Checklist

1. Verify the root updater path in [`src/lib.rs`](./src/lib.rs).
2. Verify the live artifact binding in [`MANIFEST.json`](./MANIFEST.json).
3. Run `npm test`, `npm run check:ceremony`, and `cargo test --offline`.
4. Read [`SECURITY.md`](./SECURITY.md) and [`PROTOTYPE_STATUS.md`](./PROTOTYPE_STATUS.md).
