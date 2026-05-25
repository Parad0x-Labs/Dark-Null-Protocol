# Launch Narrative

Dark Null is the evidence-first Solana privacy settlement root: a compact Groth16 proof stack, a published verifier path, canonical artifacts, and a repo-level refusal to claim more than the proofs and tests support.

## Short Positioning

Dark Null is built for teams that want private settlement primitives on Solana without inheriting a validator network, a vague audit story, or a pile of unverifiable claims.

The public root is intentionally narrow:

- publish the circuit, zkey, wasm, verification key, Rust verifier, IDL, SDK, and manifest together
- prove the current canonical Groth16 flow locally
- document the exact proof byte story: 256-byte current verifier ABI, 128-byte compressed proof target
- fail closed where payout semantics are not yet proven
- keep historical branches visible, but separate from the canonical integration path

## Hard Claims We Can Make

- The canonical root is bound by `MANIFEST.json`, `NETWORKS.json`, `Anchor.toml`, `src/lib.rs`, `src/verifying_key.rs`, and `idl/paradox.json`.
- The current proof and release gate flow is reproducible with `npm run test:all`.
- The current verifier ABI is 256 bytes: `proof_a[64] + proof_b[128] + proof_c[64]`.
- The compressed proof target is 128 bytes.
- The SDK exposes canonical artifact paths, proof encoding metadata, and v2 public-input encoders.
- The public payout path is fail-closed until the promoted circuit proves amount, receiver token account, and mint.
- Release integrity scripts generate and verify checksums and SBOM material.
- CI now includes public checks, proof hardening, strict npm audit gating, CodeQL, and release integrity workflows.

## Claims We Must Not Make Yet

- completed third-party audit
- mainnet launch
- production security
- payout-enabled public withdrawals
- append-only on-chain root derivation
- that historical deployments are equivalent to the current canonical root
- that switching a config value from devnet to mainnet is a release plan

## Public Copy

Use these lines when describing the project publicly:

```text
Dark Null is an evidence-first Solana privacy settlement root with a published Groth16 verifier path, canonical artifact manifest, reproducible proof tests, and fail-closed payout semantics until v2 amount/recipient binding is promoted.
```

```text
256-byte current verifier ABI. 128-byte compressed proof target. Public artifacts. Public tests. No fake audit or mainnet claims.
```

```text
Dark Null is not a generic privacy network. It is a compact settlement root that makes every serious claim traceable to code, artifacts, or tests.
```

## Competitive Edge

Dark Null should press the edge that weaker privacy repos avoid: proof, verifier, manifest, IDL, and SDK must agree before a claim is public.

The advantage is not just smaller proof positioning. The advantage is discipline:

- artifact-bound proof claims
- platform-neutral test behavior
- explicit security model
- fail-closed payout path
- release checksums and SBOM generation
- public mainnet readiness gate

## Mainnet Launch Sequence

Before launch language changes, clear [`MAINNET_READINESS.md`](./MAINNET_READINESS.md):

1. Promote payout-bound v2 artifacts as one set.
2. Remove fail-closed payout placeholders only after v2 proofs authorize payout semantics.
3. Run Rust validation on the release commit.
4. Publish a real third-party audit.
5. Publish mainnet manifest, deployment transaction, upgrade-authority policy, and artifact hashes.
6. Publish `MAINNET_EVIDENCE.json` and pass `npm run check:mainnet:evidence`.
7. Pass public, proof, security, release integrity, Python, Rust, packaging, and end-to-end checks together.

Until then, the correct public line is simple: strong devnet evidence, not mainnet launch.
