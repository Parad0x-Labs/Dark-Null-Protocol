# Public Verification Guide

**Last Updated**: March 15, 2026

This guide is intentionally narrow: it describes what an outside reviewer can verify from the public repo without trusting private context.

## Quick Start

```bash
sh scripts/bootstrap.sh
```

## What You Can Verify From This Repo

### 1. Canonical Root Binding

The canonical root is bound by:

- [`MANIFEST.json`](./MANIFEST.json)
- [`Anchor.toml`](./Anchor.toml)
- [`src/lib.rs`](./src/lib.rs)
- [`idl/paradox.json`](./idl/paradox.json)

From those files you can verify:

- the current root program ID is `2stas3cZYnBiWpndcTXQDGLXwfQ7kjEYYrW52DsUAcxF`
- the root IDL and root source match that program ID
- the root proving artifacts are hash-bound in one manifest

### 2. Canonical Root Verifier and Circuit

The root repo now includes:

- [`src/verifying_key.rs`](./src/verifying_key.rs)
- [`circuits/null_proof.circom`](./circuits/null_proof.circom)
- [`circuits/null_proof_final.zkey`](./circuits/null_proof_final.zkey)
- [`circuits/null_proof_js/null_proof.wasm`](./circuits/null_proof_js/null_proof.wasm)
- [`circuits/vk.json`](./circuits/vk.json)

That is enough to verify the current root is no longer a placeholder verifier story.

### 3. Canonical Local Reproducibility

Run:

```bash
npm test
npm run test:proof
npm run test:security
npm run release:verify
```

That now includes:

- public repo consistency checks
- root verifier/vk consistency
- root manifest binding
- root proof generation and Groth16 verification against the canonical artifact set
- proof encoding metadata and planned withdraw v2 public-input encoder checks
- release artifact hash verification against the manifest

### 4. Root Rust and Python Checks

Run:

```bash
cargo test --offline
npm run test:python:unit
```

Those verify the promoted root crate and the canonical Python helper client.

### 5. Historical Provenance

Historical provenance is still published at:

- [`historical/null-mint`](./historical/null-mint)
- [`historical/root-toy-prototype`](./historical/root-toy-prototype)
- [`LIVE_TEST_RESULTS.md`](./LIVE_TEST_RESULTS.md)

Use those to understand how the repo evolved. Do not confuse them with the canonical root.

## What You Still Cannot Verify From This Repo Alone

- third-party audit completion beyond what is explicitly stated in [`AUDIT.md`](./AUDIT.md)
- mainnet operational controls, relayer controls, or release management
- that every historical deployment in this repo used the current canonical root artifact set
- mainnet readiness
- live payout behavior for `prepare_phantom_withdraw_v2`; the interface is published but still fails closed until matching v2 artifacts are promoted

## Honest Verification Standard

The public repo now proves one canonical public-root Groth16 path.

It still does **not** prove:

- external audit completion
- mainnet release quality
- that old historical bundles and the current canonical root are all the same deployment
