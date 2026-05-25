# Claims Ledger

This ledger separates delivered claims from blocked claims and roadmap ideas. It exists to prevent public documentation from drifting into the same trap as larger privacy repos: impressive labels without matching artifacts.

## Delivered Claims

| Claim | Status | Evidence |
|---|---|---|
| Current verifier ABI is 256 bytes | Delivered | `MANIFEST.json` proof encoding plus SDK metadata/tests |
| Compressed proof target is 128 bytes | Delivered | `MANIFEST.json` proof encoding plus SDK metadata/tests |
| Canonical public-input shape has eight signals | Delivered | `MANIFEST.json`, `circuits/vk.json`, SDK encoders, Rust source, IDL, proof-flow tests |
| Legacy withdraw fails closed | Delivered | `src/lib.rs`, IDL, Rust tests |
| Payout v2 binds amount, receiver token account, and mint | Delivered | `src/lib.rs`, SDK encoders, IDL, proof-flow tests |
| Public artifact hashes are stable across platforms | Delivered | `.gitattributes`, `MANIFEST.json`, release verification scripts |
| Full local validation lane exists | Delivered | `npm run test:all` |

## Blocked Claims

| Claim | Status | Required evidence |
|---|---|---|
| Mainnet ready | Blocked | `MAINNET_EVIDENCE.json`, mainnet manifest, deployment transaction, audit report hash, setup evidence |
| Completed third-party audit | Blocked | external audit report with scope, commit, findings, fixes, residual risk, and auditor identity |
| Final trusted setup evidence | Blocked | public ceremony transcript or explicit audit acceptance of the setup path |
| Production release | Blocked | mainnet gate passing on the audited release commit |

## Roadmap Or Not Claimed

| Label | Current status |
|---|---|
| Generic L2 | Not a current claim |
| Validator network | Not a current claim |
| BFT consensus layer | Not a current claim |
| Private compute | Not a current claim |
| Separate bridge product | Not a current claim |
| Sigstore-signed public release | Not a current claim until tagged release evidence exists |

## Rule

If a claim is not in the delivered table, public docs must either mark it as blocked/roadmap or omit it.
