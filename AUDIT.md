# Security Review Status

**Last Updated**: March 15, 2026

Dark Null Protocol does **not** have a completed third-party audit in this public repo.

## Current Status

| Track | Status | Notes |
|---|---|---|
| Internal technical review | Complete | See [`INTERNAL_REVIEW.md`](./INTERNAL_REVIEW.md) |
| Third-party audit | Not started | No funded external engagement has been completed yet |
| Public repo consistency checks | Shipped | Run `npm run check:public` |
| Core source publication | Shipped | Rust, Circom, and Python client code now live in-tree |
| Historical devnet artifact catalog | Shipped | See [`docs/PROGRAM_IDS.md`](./docs/PROGRAM_IDS.md) |

## What This Page Means

- the repo publishes internal review notes
- the repo publishes historical devnet artifacts and interface materials
- the repo does **not** claim independent external certification

## What This Page Does Not Mean

- this is **not** a third-party audit report
- this is **not** a mainnet readiness sign-off
- this is **not** proof that every historical doc in the repo references one canonical deployment
- this is **not** proof that the published verifier or circuit is production-grade

## Published Review Materials

- [`INTERNAL_REVIEW.md`](./INTERNAL_REVIEW.md): internal technical review summary for the public repo
- [`VERIFICATION.md`](./VERIFICATION.md): what can be verified from the repo today
- [`SECURITY.md`](./SECURITY.md): disclosure and security policy

## External Audit Policy

If a real third-party audit happens, this page should include all of the following before the repo claims it:

1. Auditor name
2. Exact audit date
3. Scope
4. Final signed report or immutable report hash
5. Remediation status

Anything less is not a completed third-party audit.

## Historical Deployment Notes

Dark Null materials in this repo reference multiple historical devnet deployments. They are mapped in [`docs/PROGRAM_IDS.md`](./docs/PROGRAM_IDS.md) to reduce document drift and stop reviewers from guessing.
