# Mainnet Runbook

This runbook is the release path. It is not evidence that mainnet is ready today.

## Release Order

1. Run `npm run test:all` from a clean dependency install.
2. Publish final trusted setup evidence for the exact artifact set or have the setup path explicitly accepted in the third-party audit.
3. Complete a third-party audit against the exact release commit.
4. Deploy the audited release to mainnet-beta.
5. Publish `MAINNET_EVIDENCE.json` from `MAINNET_EVIDENCE.example.json`.
6. Run `npm run check:mainnet:evidence`.
7. Run `npm run check:mainnet`.
8. Tag the release only after both mainnet checks pass.

## Evidence Required

`MAINNET_EVIDENCE.json` must bind:

- audited release commit
- mainnet program id
- mainnet deployment transaction
- upgrade-authority policy
- payout-bound v2 artifact label
- eight-public-input proof shape
- final trusted setup report path and SHA-256 hash
- enabled payout instruction
- final third-party audit report path and SHA-256 hash
- audit scope commit matching the release commit
- accepted residual-risk summary

## Commands

```bash
npm ci
npm run check:ceremony
npm run test:all
npm run check:mainnet:evidence
npm run check:mainnet
```

`npm run check:mainnet:evidence` is expected to fail until `MAINNET_EVIDENCE.json` exists and all fields are real.

## Hard Stop Conditions

Do not deploy or announce mainnet if any of these are true:

- the promoted circuit has fewer than eight public inputs
- the trusted setup report is missing, still devnet-only, or not accepted by audit
- v2 payout source does not verify the promoted eight-signal proof before transfer
- the audit report is missing, draft, or scoped to a different commit
- the deployment transaction is not published
- the upgrade-authority policy is unclear
- `npm run test:all` fails
- either mainnet readiness command fails
