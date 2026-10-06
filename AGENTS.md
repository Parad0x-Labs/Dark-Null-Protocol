# AGENTS.md

Build and test guidance for coding agents working in this repository.

## Review path

Read [REVIEW.md](./REVIEW.md) first when you need to know what each component does, what has been
demonstrated, and where it runs. The machine-readable source for that table is
[`evidence/claims.json`](./evidence/claims.json); the human claim boundary is
[`docs/CLAIMS_LEDGER.md`](./docs/CLAIMS_LEDGER.md). If you change a capability or a deployment, update the
registry in the same change and run:

```bash
node scripts/check-claims-registry.mjs          # validate the registry and the REVIEW.md table
node scripts/check-claims-registry.mjs --write  # regenerate the REVIEW.md table after editing the registry
```

## Build and test

Node.js 22. Install with lifecycle scripts disabled.

```bash
npm ci --ignore-scripts
npm test                 # repo checks plus SDK, config, x402, artifact and frontier suites
npm run test:proof       # proof encoding, malformed proofs, readiness and evidence gates
npm run release:verify   # MANIFEST.json hash pins
cargo test --locked      # root Anchor program
```

## Pinned files

`MANIFEST.json` pins the SHA-256 and size of the files listed in its `artifacts` array (circuit, zkey,
wasm, `vk.json`, `src/lib.rs`, `package.json`, several docs and scripts). If you intentionally change a
pinned file, re-pin only that entry using `readStableBytes` from `scripts/release-artifacts.mjs`, keep the
file's 2-space JSON formatting with no trailing newline, and confirm `npm run release:verify` passes.

## Rules for changes

- The canonical program ID is in `NETWORKS.json`, `Anchor.toml`, `declare_id!` in `src/lib.rs` and
  `docs/PROGRAM_IDS.md`; keep them consistent.
- Do not weaken commitment-based accounting (`credit_deposit` / `debit_withdrawal`), nullifier replay
  protection or payout binding to make another test pass.
- Privacy properties are described in `SECURITY_MODEL.md` and `PROTOTYPE_STATUS.md`; keep public wording
  consistent with what the circuit and program expose.
