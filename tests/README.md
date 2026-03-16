# Dark Null Protocol Test Materials

This repository now has one canonical root validation lane plus historical evidence material.

## What Runs Locally Today

```bash
npm test
python3 -m py_compile client/*.py
npm run test:python:unit
cargo test --offline
```

`npm test` now includes:

- public repo consistency checks
- SDK tests
- network config and PDA tests
- canonical manifest binding
- canonical proof generation + verification against the root circuit/zkey/vk
- root-authority and bounded-window safety tests in the Rust crate
- historical provenance checks for the recovered `null-mint` branch

## Published Test Material

| File | Purpose |
|---|---|
| [`canonical-proof-flow.test.mjs`](./canonical-proof-flow.test.mjs) | active root proof-flow test against `null_proof` artifacts |
| [`canonical-manifest.test.mjs`](./canonical-manifest.test.mjs) | root manifest binding test |
| [`verification-key-consistency.test.mjs`](./verification-key-consistency.test.mjs) | root verifier/vk consistency test |
| [`smoke.rs`](./smoke.rs) | active Rust smoke test for the promoted root crate |
| [`historical-null-mint-consistency.test.mjs`](./historical-null-mint-consistency.test.mjs) | recovered historical branch sanity check |
| [`historical-null-mint-manifest.test.mjs`](./historical-null-mint-manifest.test.mjs) | recovered historical branch manifest binding |
| [`dark_null_v1_full_e2e.ts`](./dark_null_v1_full_e2e.ts) | historical full-cycle harness with explicit unshield path |
| [`full_cycle_e2e.ts`](./full_cycle_e2e.ts) | historical API-driven full-cycle harness |

## Reproduction Limits

- the canonical root proof-flow test proves the current root circuit, zkey, and vk are internally consistent
- it does not prove a mainnet deployment or an external audit
- older historical harnesses still assume external Solana, relayer, or app infrastructure not fully curated in-tree

## Related Files

- [`../MANIFEST.json`](../MANIFEST.json)
- [`../LIVE_TEST_RESULTS.md`](../LIVE_TEST_RESULTS.md)
- [`../VERIFICATION.md`](../VERIFICATION.md)
