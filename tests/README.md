# Dark Null Protocol Test Materials

This repository now has one canonical root validation lane plus historical evidence material.

## What Runs Locally Today

```bash
npm run test:all
```

`npm run test:all` now includes:

- public repo consistency checks
- SDK tests
- network config and PDA tests
- canonical manifest binding
- canonical proof generation + verification against the root circuit/zkey/vk
- malformed-proof rejection
- mainnet-readiness gate regression
- Python compile and unit tests
- root-authority and bounded-window safety tests in the Rust crate
- strict npm audit
- SBOM, checksum, release verification, and package dry-run checks

## Published Test Material

| File | Purpose |
|---|---|
| [`canonical-proof-flow.test.mjs`](./canonical-proof-flow.test.mjs) | active root proof-flow test against `null_proof` artifacts |
| [`canonical-manifest.test.mjs`](./canonical-manifest.test.mjs) | root manifest binding test |
| [`verification-key-consistency.test.mjs`](./verification-key-consistency.test.mjs) | root verifier/vk consistency test |
| [`smoke.rs`](./smoke.rs) | active Rust smoke test for the promoted root crate |

## Reproduction Limits

- the canonical root proof-flow test proves the current root circuit, zkey, and vk are internally consistent
- it does not prove a mainnet deployment or an external audit

## Related Files

- [`../MANIFEST.json`](../MANIFEST.json)
- [`../VERIFICATION.md`](../VERIFICATION.md)
