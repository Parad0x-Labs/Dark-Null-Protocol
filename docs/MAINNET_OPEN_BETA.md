# Mainnet Open Beta Gate

This page defines the only acceptable unaudited mainnet beta posture for Dark Null.

Open beta is not production. Open beta is not an audited release. Open beta is allowed only as a capped, explicitly disclosed, pauseable deployment with public evidence.

Run:

```bash
npm run check:mainnet:beta
npm run check:claims
npm run test:all
```

`npm run check:mainnet:beta` is expected to fail until `MAINNET_BETA_EVIDENCE.json` exists and binds a real mainnet-beta deployment.

## Required Beta Evidence

| Gate | Required evidence |
|---|---|
| Deployment | mainnet-beta program id, deployment transaction, pause authority, and upgrade-authority policy |
| Explicit beta status | `beta.status` is `open-beta`, `risk_disclosure` is `unaudited-open-beta`, and production claims are disabled |
| Caps | TVL cap, per-deposit cap, and daily withdraw cap are published; beta TVL cap may not exceed 100 SOL |
| Payout | `prepare_phantom_withdraw_v2` is enabled and binds amount, receiver token account, and mint |
| Proof artifacts | eight-public-input artifact set is promoted for the beta release commit |
| Setup boundary | development setup evidence may be accepted only for open beta, never as production setup evidence |
| Release integrity | checksums and SBOM exist and match hashes in the beta evidence file |
| Operations | direct user submission is available, relayer use is optional, and pause/rollback paths are documented |
| Audit boundary | audit status remains pending and an external audit is required before production |

## Operating Rules

- Keep `npm run check:mainnet` blocked until final audit and production evidence exist.
- Keep beta caps low enough that a full loss is survivable.
- Pause first, investigate second.
- Do not increase caps in the same commit that changes circuit, verifier, IDL, or payout logic.
- Do not publish production copy while `audit.status` is `pending`.
- Do not imply that development setup evidence is final setup evidence.

## Incident Response

1. Pause the beta path or disable relayer submission if anomalous proof, payout, nullifier, or vault behavior appears.
2. Publish the paused state, affected program id, release commit, observed transactions, and next action.
3. Keep direct evidence links immutable: deployment transaction, release commit, artifact checksums, and SBOM.
4. Resume only after reproducing the issue and rerunning `npm run test:all`, `npm run check:mainnet:beta`, and release verification.

## Rollback

Rollback means stopping new beta use and returning to a documented safe state. It does not mean pretending the beta was production.

Required rollback evidence:

- paused or disabled beta entry point
- published reason
- current vault exposure
- affected release commit
- fixed or reverted release commit
- full validation output for the replacement release
