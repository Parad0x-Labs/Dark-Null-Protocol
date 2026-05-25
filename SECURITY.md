# Security Policy

**Effective Date**: March 15, 2026  
**Contact**: security@parad0xlabs.com

## Current Assurance Status

| Track | Status |
|---|---|
| Third-party audit | Not completed |
| Internal technical review | Completed for the public repo |
| Public consistency checks | Available via `npm run check:public` |
| Root canonical verifier path | Published and compile-tested |
| Root canonical proof flow | Published and locally reproducible via `tests/canonical-proof-flow.test.mjs` |
| Public withdraw payout path | Disabled/fail-closed until amount+recipient binding is promoted into the canonical proof bundle |
| Withdraw v2 payout-bound interface | Published in IDL/source, argument binding checked, still fails closed pending v2 artifacts |
| Root update authority | Restricted by `RootAuthorityConfig` in the current root source |
| Mainnet release assurance | Not established |

## Reporting Security Issues

Send reports to `security@parad0xlabs.com` with:

- a clear description of the issue
- reproduction steps
- impact assessment
- proof-of-concept material if safe to share

## Scope

This repository currently publishes:

- the canonical root devnet program, IDL, and proving artifacts
- the canonical root program, IDL, and proving artifacts
- Python and JavaScript integration helpers
- historical branches and result bundles
- review and verification documentation
- a public security model in [`SECURITY_MODEL.md`](./SECURITY_MODEL.md)

If you report an issue that depends on unpublished infrastructure or unpublished source code, say so explicitly.

If your report depends on a historical branch or artifact bundle, say which track you mean:

- canonical root
- [`historical/null-mint`](./historical/null-mint)
- [`historical/root-toy-prototype`](./historical/root-toy-prototype)

## No Funded Bug Bounty Yet

There is currently no funded public bug bounty program attached to this repository.

## Disclosure Expectations

1. Report privately first.
2. Give reasonable time to assess the issue.
3. Avoid harming users or third-party infrastructure.
4. Do not claim a completed external audit where none exists.

## Related Documents

- [`AUDIT.md`](./AUDIT.md)
- [`INTERNAL_REVIEW.md`](./INTERNAL_REVIEW.md)
- [`VERIFICATION.md`](./VERIFICATION.md)
- [`MANIFEST.json`](./MANIFEST.json)
- [`SECURITY_MODEL.md`](./SECURITY_MODEL.md)
