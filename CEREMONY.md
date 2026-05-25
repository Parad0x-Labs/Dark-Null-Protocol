# Trusted Setup Evidence

**Last Updated**: May 25, 2026

This file documents the trusted-setup state for the current canonical root artifact set. It is release evidence for the public repo, not a mainnet launch sign-off.

## Current Setup Status

The current `canonical-devnet-root-2` artifacts use a local development setup for `circuits/null_proof_final.zkey`.

This is not a public multi-party ceremony. It is not enough by itself for mainnet trust. Before mainnet launch, the final artifact set must have either a public ceremony transcript or a third-party audit record that explicitly accepts the setup path, contribution process, and verifier binding.

## Current Canonical Artifacts

| Artifact | Path |
|---|---|
| Circuit | `circuits/null_proof.circom` |
| R1CS | `circuits/null_proof.r1cs` |
| Final zkey | `circuits/null_proof_final.zkey` |
| Verification key | `circuits/vk.json` |
| Rust verifier constants | `src/verifying_key.rs` |
| Artifact manifest | `MANIFEST.json` |

## Recorded zkey Evidence

These values are the snarkjs output recorded for the promoted v2 artifact set.

| Field | Value |
|---|---|
| Circuit hash | `15a49437 3e8e5577 bd946a51 e85cb0b2 f0eb6610 b5522077 428e1a5b 9ea90f1a 544aa9a6 4ce56ceb 41c7d229 96ebc03c 3cbb31fa a7994ba0 d0950e53 c4c46472` |
| Contribution label | `sls_0x` |
| Contribution hash | `5dad2bc5 4534f335 ce8c4852 3f69b34c b517f1e8 b148bc24 211eb99f 15bef63c 7153d694 227a110c 7b2dc64c 41a29fe1 a45bbfe7 fdaab594 2df11cb1 972a3172` |

## Local Verification

Run the structural evidence check:

```bash
npm run check:ceremony
```

If the matching Powers of Tau file is available locally, set `DARK_NULL_PTAU_PATH` and the same command will also run `snarkjs zkey verify`:

```bash
DARK_NULL_PTAU_PATH=/path/to/pot14_final.ptau npm run check:ceremony
```

Without `DARK_NULL_PTAU_PATH`, the check verifies this report, manifest binding, and the required artifact files, then skips external PTAU verification.

## Mainnet Requirement

Mainnet evidence must include:

- final setup report path and SHA-256 hash
- exact release commit
- final circuit, zkey, wasm, vk, Rust verifier, IDL, SDK, and manifest hashes
- public ceremony transcript or explicit third-party audit acceptance of the setup path
- confirmation that the promoted artifact label is no longer devnet-oriented

Anything less is development evidence, not mainnet readiness.
