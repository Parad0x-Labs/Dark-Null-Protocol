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

## Six integration programs, redeployed under fresh keys

The six programs in `programs/` were deployed to new program ids on 2026-10-06 (upgrade authority
`9Jkphdpu3UQKgZToacyfDkwM3ZbzPjZYuK3sDyR8pU2q`), each with `--max-len` equal to its `.so` size. After each deploy,
`solana program show` returned the deployer as authority and `dataLen` equal to the `.so` size, and `solana program
dump` returned bytes whose SHA-256 equals the `.so` (record: [darknull-integration-deploy.json](./darknull-integration-deploy.json)).
The e2e scripts (`scripts/e2e-*.mjs`, ids read from `programs/<name>/.program-id`) ran once against the new ids
from a fresh payer in a tmpfs container; every printed signature was read back with `getTransaction` and graded.

| Program | Program id | Deploy slot | Result | Pass/Total | Instructions (CU from the ledger) | File |
|---|---|---:|---|---|---|---|
| silent-pay | `2FvaRhpwX2okeeV4fGuMo6Y3DxEXMZWJYYJBCknJbbED` | 508179935 | PASS | 5/5 | RegisterScanKeys 8,601; RecordPayment 7,040 | [darknull-silent-pay.json](./darknull-silent-pay.json) |
| payment-stream | `EduZQkGvwLGXQPVNp64BPnwCkfeVJghZr2nFKTcXBMTP` | 508179527 | PASS | 6/6 | OpenChannel 9,031; CloseChannel 6,666 (channel PDA closed) | [darknull-payment-stream.json](./darknull-payment-stream.json) |
| threshold-fed | `CjcnLYP1wxfgFPjcBVuEQHTb36UnjNydfngGvYjLUPPZ` | 508179676 | PASS | 5/5 | InitFederation 18,179; RecordIssuance 17,887 | [darknull-threshold-fed.json](./darknull-threshold-fed.json) |
| fiat-oracle | `3VQsCtrq8kgdbUvSqHBqzbRqjuQuFkPYxrZTCBrNB8rw` | 508178279 | PASS | 3/3 | RegisterOracle 6,824; SettleReceipt 37,413 | [darknull-fiat-oracle.json](./darknull-fiat-oracle.json) |
| accumulator | `FX2YSq6jjk49m18dJpQYd7Dw9nLWYxRTDqpdodde1v2Y` | 508179399 | PASS | 10/10 | Init 6,825; Accumulate 3,006 (x5); Finalize 3,704 | [darknull-accumulator.json](./darknull-accumulator.json) |
| inference | `GSkQrJ8hrMW6XLDh4dUv5jCFxdbczeGdm6iX7NvYPLrB` | 508179624 | PASS | 5/5 | RegisterModel 8,507; RecordInference 35,768 | [darknull-inference.json](./darknull-inference.json) |

Devnet (2026-10-06): 34/34 checks across the six programs.

Totals: 38 pass, 0 fail ([`summary.json`](./summary.json)).

Not shown by these runs: unlinkability (amount, receiver, mint and note commitment stay public inputs, so the
withdrawal is linkable to its deposit; see [`../../docs/PRIVACY_PROPERTIES.md`](../../docs/PRIVACY_PROPERTIES.md)),
a build hash tying the deployed bytes to a commit, and a multi-party trusted setup.
