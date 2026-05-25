# Internal Review Notes

**Date**: March 15, 2026
**Review Type**: Internal security and consistency review
**Scope**: Public repository contents only
**Not a Third-Party Audit**

## Scope

This review covered the materials currently published in this repository:

- top-level documentation and repo framing
- public IDL and interface files
- historical test harnesses and result artifacts
- security, verification, and audit-status docs

This review did **not** certify unpublished relayer operations or any external infra that is still outside this public tree.

## Findings Summary

| Area | Finding | Status |
|---|---|---|
| Repo framing | Public docs overstated confidence relative to published code | Fixed |
| Audit posture | Audit language implied more than an internal review | Fixed |
| Program IDs | Historical IDs were scattered without a manifest | Mitigated with [`docs/PROGRAM_IDS.md`](./docs/PROGRAM_IDS.md) |
| Package docs | Primary docs referenced unpublished npm packages as if they were available here | Fixed |
| Public verification | Placeholder hashes and impossible verification claims reduced trust | Fixed |
| Source availability | Real Rust, Circom, and Python client code existed outside the repo | Fixed by curated source import |

## Main Corrections

1. Switched the repository license to MIT.
2. Added `sh scripts/bootstrap.sh` for one-command public setup.
3. Added `npm run check:public` to catch stale proprietary wording, placeholder audit copy, and obvious local-path leaks.
4. Replaced misleading audit framing with explicit internal-review wording.
5. Added a program-ID manifest so historical deployments are documented instead of implied to be one release.
6. Imported the recoverable Rust core, circuit source, and Python client code from the local source archive into the public repo.

## Residual Risks

- No third-party audit has been completed yet.
- This repo still does not ship full relayer operations or every historical app wrapper that existed outside the public tree.
- Historical result bundles should not be treated as a formal release manifest.
- Anyone evaluating protocol security still needs to distinguish published materials from unpublished implementation.
- The public verifier and public circuit are still prototype-grade and should not be marketed as secure production cryptography.

## Why This Repo Looked Like Larp

Because the public presentation used protocol, audit, and verification language that sounded stronger than the public evidence bundle. Once the core implementation was not in the repo, the only safe path was to tighten claims and publish exactly what could be defended.
