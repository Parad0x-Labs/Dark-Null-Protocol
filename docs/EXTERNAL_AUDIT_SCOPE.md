# External Audit Scope

Use this as the audit brief for a real third-party review. It is not an audit report.

## Required Scope

- `src/lib.rs`
- `src/verifying_key.rs`
- `circuits/null_proof.circom`
- promoted v2 circuit artifacts
- `MANIFEST.json`
- `NETWORKS.json`
- `idl/paradox.json`
- SDK and Python public-input encoders
- proof packing and `groth16-solana` encoding assumptions
- root authority and upgrade controls
- payout enablement logic
- replay, malformed proof, stale root, wrong receiver, wrong mint, and wrong amount paths
- CI, release checksums, SBOM, and artifact provenance

## Required Auditor Deliverables

- auditor identity
- audited commit hash
- audit dates
- exact files and artifacts reviewed
- methodology
- findings with severity
- fix validation
- remaining risk
- final report hash

## Required Release Linkage

The audited commit must match:

- `MAINNET_EVIDENCE.json.release_commit`
- `MAINNET_EVIDENCE.json.audit.scope_commit`
- the release tag
- the mainnet deployment source commit

Anything less is not a completed third-party audit for launch purposes.
