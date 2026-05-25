# Mainnet Runbook

This runbook is the release path. It is not evidence that mainnet is ready today.

## Release Order

1. Promote the payout-bound v2 circuit.
2. Generate the v2 r1cs, wasm, zkey, verification key, Rust verifier, manifest, IDL, SDK metadata, and proof-flow tests as one artifact set.
3. Remove fail-closed payout errors only after the v2 proof verifies amount, receiver token account, and mint.
4. Run `npm run test:all` from a clean dependency install.
5. Complete a third-party audit against the exact release commit.
6. Deploy the audited release to mainnet-beta.
7. Publish `MAINNET_EVIDENCE.json` from `MAINNET_EVIDENCE.example.json`.
8. Run `npm run check:mainnet:evidence`.
9. Run `npm run check:mainnet`.
10. Tag the release only after both mainnet checks pass.

## Evidence Required

`MAINNET_EVIDENCE.json` must bind:

- audited release commit
- mainnet program id
- mainnet deployment transaction
- upgrade-authority policy
- payout-bound v2 artifact label
- eight-public-input proof shape
- enabled payout instruction
- final third-party audit report path and SHA-256 hash
- audit scope commit matching the release commit
- accepted residual-risk summary

## Commands

```bash
npm ci
npm run test:all
npm run check:mainnet:evidence
npm run check:mainnet
```

`npm run check:mainnet:evidence` is expected to fail until `MAINNET_EVIDENCE.json` exists and all fields are real.

## Hard Stop Conditions

Do not deploy or announce mainnet if any of these are true:

- the promoted circuit has fewer than eight public inputs
- payout source still contains fail-closed placeholder errors
- the audit report is missing, draft, or scoped to a different commit
- the deployment transaction is not published
- the upgrade-authority policy is unclear
- `npm run test:all` fails
- either mainnet readiness command fails
