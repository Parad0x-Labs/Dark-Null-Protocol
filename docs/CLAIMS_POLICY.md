# Dark NULL v2 Claims Policy

status: design (applies to all public wording about the v2 private payment stack)

Companion to [`DESIGN_2027.md`](./DESIGN_2027.md) and [`PLAN_2027.md`](./PLAN_2027.md). The existing
[`CLAIMS_LEDGER.md`](./CLAIMS_LEDGER.md) remains the ledger of record for v1; this policy defines how
v2 claims enter that ledger.

## 1. The rule

A capability may be stated publicly only when a named artifact proves it:

| Claim class | Minimum evidence |
|---|---|
| "works" / "supports" | a passing automated test in this repo, named in the claim row |
| "on devnet" | a replayable devnet transaction signature plus the script that produced it |
| a number (CU, bytes, ms, lamports) | a benchmark run from `bench/` with machine spec, commit SHA, and raw output committed |
| a privacy property | the property test in `tests/privacy/` (see DESIGN_2027.md section 10) passing on the named commit |
| "no Dark NULL-operated setup" | gate B5: a script any third party can run that re-derives every proving/verifying artifact from public transcripts |
| "compliant" / "compliance exit" | gate B4 devnet transactions for association-set membership and ragequit |
| comparison with another system | a dated, linked source for the other system's property, re-checked within 30 days of publication |

No evidence, no claim. A claim is tied to a commit: a benchmark that passed on an earlier commit
does not cover later code (re-run after the last change, then cite).

## 2. Wording rules

- State what exists, with its evidence link. One short future-tense sentence for what comes next; no
  dwelling on gaps.
- Numbers carry their unit, network, and date: "transact verified in N CU on devnet (bench B2,
  commit abc1234, 2026-MM-DD)".
- Estimates are labelled `estimate` in docs and never appear in launch copy.
- No "first" / "only" / "unique" claims unless a dated survey row in DESIGN_2027.md section 2 shows no
  existing system with the property, and the survey is less than 30 days old at publication.
- No token-value, buy-pressure, or yield language anywhere.
- No statements about third-party security review status beyond what the release evidence files
  record.
- Never call devnet artifacts mainnet artifacts. Devnet proving keys made with a development setup are
  labelled `dev-setup` in `MANIFEST.json` and in every doc that names them.
- Folding, epoch aggregation, or "one proof for many payments" wording requires the specific gate
  (section 3) for the specific mechanism. Session channels (one settlement per merchant-epoch) and
  folding (one proof over many steps) are different mechanisms and are never described with each
  other's evidence.

## 3. What may be claimed at each phase

| Phase | Claimable once its gates pass | Not claimable in this phase |
|---|---|---|
| P0 spec + vectors | "v2 protocol specification and cross-implementation test vectors published"; "Poseidon parameters match the Solana `sol_poseidon` syscall (vector test V-POS)" | any privacy property; any CU number |
| P1 shielded pool v2 | "unlinkable deposit-to-withdraw on devnet" (privacy test P-UNLINK + devnet signatures); "hidden amounts for in-pool transfers" (P-AMOUNT); "arbitrary amounts"; "transact verified in N CU on devnet" (B2); "proof generated in T s on <machine>" (B1); "trustless on-chain Merkle root" (test T-ROOT) | anything about x402, sessions, compliance, or setup provenance beyond `dev-setup` |
| P2 private x402 payer | "agents pay x402 endpoints from a shielded balance on devnet"; "private receipts bound to x402 quotes" (tests X-BIND, X-REPLAY); measured end-to-end latency (B6-lat) | amortization or per-payment cost claims (those need P3/B3) |
| P3 session channels + epoch settlement | "one on-chain settlement per merchant per epoch"; "per-payment on-chain cost of X lamports at N payments per epoch" (B3, rent included); "per-agent spend limits enforced inside the proof" (tests POL-*) | "folding" wording, unless gate F1-F3 passed for the folding accountability proof |
| P4 association sets + viewing keys | "association-set membership proofs on Solana devnet" (B4); "ragequit exit for depositors" (B4-RQ); "scoped viewing keys" (tests VK-*) | statements that an operator or regulator approves the design |
| P5 benchmarks | the B1-B6 table as published with raw data | anything not in the table |
| Setup track (parallel) | "no Dark NULL-operated trusted setup" only after B5 passes on the release artifacts | that claim for any artifact still marked `dev-setup` |

## 4. Mainnet wording

Nothing in phases P0-P5 is a mainnet capability. Mainnet wording follows the existing
`MAINNET_EVIDENCE.json` gate in this repository (release commit, artifact hashes, setup provenance,
external security review report) and is out of scope for this plan.

## 5. Enforcement

- `scripts/check-claims-evidence.mjs` already rejects unqualified mainnet/production/review claims in
  `docs/`. P0 extends it with a v2 rule: any line in `README.md` or `docs/` that names a v2 gate ID
  (`B1`-`B6`, `P-*`, `X-*`, `POL-*`, `VK-*`, `F1`-`F3`) must link a file under `bench/results/` or
  `tests/`.
- Every v2 row in `CLAIMS_LEDGER.md` carries: claim, gate ID, evidence path, commit SHA, date.
- A claim whose evidence test is deleted or starts failing is moved back to "not claimable" in the
  same commit.
