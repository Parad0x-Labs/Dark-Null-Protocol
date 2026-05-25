# Mainnet Readiness Gate

Dark Null must not be launched on mainnet from the current public repo. This page defines the release gate that must pass before mainnet language or deployment claims are allowed.

Run:

```bash
npm run check:mainnet
npm run check:mainnet:evidence
```

Those commands are expected to fail until every blocker below is cleared.

## Required Evidence

| Gate | Required evidence |
|---|---|
| Rust validation | `cargo test --offline` passes on the release commit |
| Payout-bound proof | v2 circuit, zkey, wasm, vk, Rust verifier, IDL, manifest, SDK, and tests all bind `[commitment, nullifier, root, amount, receiver_token_part_0, receiver_token_part_1, mint_part_0, mint_part_1]` |
| Public payout | fail-closed placeholder errors removed only after the promoted proof actually authorizes payout |
| Mainnet manifest | mainnet program id, deployment transaction, artifact hashes, cluster, and upgrade-authority policy are published |
| Mainnet evidence | `MAINNET_EVIDENCE.json` binds the audited commit, program id, deployment transaction, upgrade policy, v2 artifact label, payout enablement, and audit report hash |
| Third-party audit | external audit report with scope, commit hash, findings, fixes, residual risk, and auditor identity |
| Runtime security | strict npm audit is clean for runtime and dev dependencies |
| Release integrity | checksums, SBOM, and GitHub artifact attestations produced for release artifacts |
| Operations | relayer/direct fallback, rate limits, health checks, key custody, pause/upgrade policy, and incident response are documented |
| End-to-end flow | deposit, root update, proof generation, v2 withdraw, replay rejection, malformed proof rejection, and packaging all pass together |

## Architecture Ideas Worth Evaluating

The strongest adjacent ideas to evaluate before mainnet are:

- split claim and withdraw so the proof-bearing transaction does not move value
- use credit-note style commitments for delayed payout
- add preimage-verified revoke or recovery only if the privacy tradeoff is explicit
- increase root-history usability or publish snapshot-staleness warnings
- test wrong recipient, fake note, wrong opening, replay, stale root, and malformed proof paths as first-class regression cases
- make relayer trust boundaries explicit: censorship only, direct fallback always available

These are design directions, not current Dark Null claims.

## Promotion Files

- [`MAINNET_EVIDENCE.example.json`](../MAINNET_EVIDENCE.example.json) defines the evidence schema.
- [`MAINNET_RUNBOOK.md`](./MAINNET_RUNBOOK.md) defines the release order.
- [`EXTERNAL_AUDIT_SCOPE.md`](./EXTERNAL_AUDIT_SCOPE.md) defines the audit scope required before launch language changes.
