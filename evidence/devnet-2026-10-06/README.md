# Devnet evidence: 2026-10-06

Runs against the root program `35GMe13ExGB1JGp1wZGrEvHfQnENKADroDQApeziKuwV` (devnet, upgrade authority
`4cTBfB8vJK8YiCBcVrvZV4wx89AFzGEbm7LLghJsNUyD`, last deployed in slot 487918755). Every run below is later
than that slot, so it exercised the bytes deployed today. Scripts ran from a `git archive` of `57e353f` in a
tmpfs container (`npm ci --ignore-scripts`); signatures and slots were re-read from the ledger after the run.
Raw logs are not published.

| Suite | Result | Pass/Total | File |
|---|---|---|---|
| Canonical proof cycle (`scripts/ox_atomic.mjs`): over-claim, spent-note replay, fresh deposit, `update_root`, Groth16 withdraw | PASS | 3/3 | [darknull-canonical-proof-cycle.json](./darknull-canonical-proof-cycle.json) |
| `npm run check:x402:devnet`: cited settlement `3wXv6wGS…` finalized, program account executable | PASS | 1/1 | [darknull-check-x402-devnet.json](./darknull-check-x402-devnet.json) |

Canonical cycle, transaction by transaction:

| Step | Outcome | Signature | Slot |
|---|---|---|---|
| Withdraw twice the committed deposit | Rejected `6013 InsufficientCommittedDeposit` at preflight | none (not landed) | — |
| Re-submit the already-spent payout note | Rejected `6000 DoubleSpend` at preflight | none (not landed) | — |
| Fresh deposit | Landed | `7LSFx3jQ…` | 508036692 |
| `update_root` | Landed | `HKgabjg1…` | 508036696 |
| Groth16 withdraw (`WITHDRAW_OK`, 50,000,000 lamports paid) | Landed | `2GfxoE9r…` | 508036706 |

Totals: 4 pass, 0 fail ([`summary.json`](./summary.json)).

Not shown by these runs: unlinkability (amount, receiver, mint and note commitment stay public inputs, so the
withdrawal is linkable to its deposit; see [`../../docs/PRIVACY_PROPERTIES.md`](../../docs/PRIVACY_PROPERTIES.md)),
a build hash tying the deployed bytes to a commit, and a multi-party trusted setup.
