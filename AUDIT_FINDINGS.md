# Historical Security Findings

This file is retained for historical continuity. It is not a third-party audit report, and it is not the assurance source for the current canonical public root.

Use the current root files instead:

- [`src/lib.rs`](./src/lib.rs)
- [`idl/paradox.json`](./idl/paradox.json)
- [`MANIFEST.json`](./MANIFEST.json)
- [`SECURITY_MODEL.md`](./SECURITY_MODEL.md)
- [`AUDIT.md`](./AUDIT.md)

## Historical Finding: Payout Binding

Earlier withdrawal designs allowed payout recipient data to remain outside the proven public inputs. That is unsafe because a valid proof could be paired with attacker-controlled payout accounts.

Current status:

- `prepare_phantom_withdraw` verifies the promoted `[commitment, nullifier, root]` proof shape, then fails closed before payout.
- **v2 withdraw is LIVE (unaudited).** `prepare_phantom_withdraw_v2` in the canonical program ([`src/lib.rs`](./src/lib.rs)) binds all 8 payout-bound public inputs, verifies the 8-signal NullProofV2 ([`circuits/vk.json`](./circuits/vk.json) `nPublic=8`), appends the nullifier, and transfers funds on a valid proof (`ZK_VERIFY_V2: payout-bound proof verified and withdrawal paid`). There is **no** `WithdrawV2CircuitNotPromoted` gate in the current code. This payout path is **UNAUDITED** — treat it as experimental; do not use it with funds you cannot afford to lose.

## Historical Finding: Maturity Binding

Earlier maturity designs allowed timing arguments to sit outside the proof or outside root metadata. That is weak because a caller can pass stale timing data unless the program binds it to verified state.

Current status:

- The canonical root still relies on a trusted root updater.
- The repo does not claim append-only on-chain root derivation.
- The repo does not claim mainnet release readiness.

## Historical Finding: Source Transparency

The current repo publishes the canonical Rust source, IDL, manifest, circuit, zkey, wasm, and verification key. Build outputs and local caches remain ignored.

## Current Verification

Run:

```bash
npm test
npm run test:proof
npm run test:security
npm run release:verify
```

Run Rust validation in CI or on a machine with `cargo` installed:

```bash
cargo test --offline
```
