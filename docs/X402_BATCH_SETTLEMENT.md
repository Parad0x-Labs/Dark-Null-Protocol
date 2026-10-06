# Dark NULL v2: x402 Batch Settlement on Agave (X402_BATCH_SETTLEMENT)

status: measured spike, devnet, 2026-10-06 (epoch 1176, cluster on Agave 4.4.0-beta.0 at 95% stake).
Spike code: [`spikes/x402-batch/`](../spikes/x402-batch/). Raw ledger results:
[`bench/results/x402-batch/2026-10-06/`](../bench/results/x402-batch/2026-10-06/).
Companions: [`DESIGN_2027.md`](./DESIGN_2027.md) section 6 (x402 schemes), [`spec/V2_SPEC.md`](./spec/V2_SPEC.md) section 11.

Question: what is the cheapest way to settle many x402 payments inside one atomic Solana transaction, using only
features active on devnet today? Labels follow DESIGN_2027: [M] measured on devnet (read back from
`getTransaction`: `meta.fee`, `meta.computeUnitsConsumed`), [E] estimate.

## 0. Answer

Use three lanes, chosen by payment shape:

| Shape | Lane | Fee per payment [M] |
|---|---|---|
| Same payer pays the same payee repeatedly (agent session) | **C: channel**. One open, then off-chain cumulative ed25519 vouchers, then one close verified in-program. Closes can be batched, 35 per transaction | 10,000 / N lamports (N = 1,000 gives **10**) |
| Many payers pay once each (facilitator fan-in) | **B2: voucher batch**. Payer-signed vouchers against a prepaid program ledger, with ed25519 checked in-program using `sol_sha512` and the curve25519 MSM syscall | **100** (50 per transaction) |
| One payer pays many payees that already hold token accounts | **A-v1: multi-transfer**. One V1 transaction carrying 60 `TransferChecked` | **83** |

The baselines are 5,000 lamports for one transfer and 10,001 lamports for the x402 `exact` transaction shape (facilitator fee payer plus client signature).

Two approaches are rejected:
- **B1, the ed25519 precompile.** The ledger charges `lamports_per_signature` for every precompile signature, so it costs 5,227 per payment.
- **Multi-signer fan-in.** V1 caps a transaction at 12 signatures, so it costs 5,455 per payment.

## 1. What is active (re-checked)

`solana feature status --url devnet` (CLI 4.2.1) at epoch 1176. The task brief's list is correct, with these additions and corrections:

| Feature | Status | Relevance |
|---|---|---|
| SIMD-0385 Transaction V1 | active, epoch 1140 | 4,096 B, **64 addresses, 12 signatures, 64 instructions, no address lookup tables** (spec table). Compute-unit limit and loaded-data limit go in the config mask, and both must be set |
| SIMD-0266 Efficient Token program (p-token) | active, epoch 1044 | `TransferChecked` = **105 CU** [M]. This is the reason A-v1 is cheap in CU |
| curve25519 syscalls (`7rcw5U...`) plus the MSM length restriction (`eca6zf...`) | active, epochs 556 and 678 | in-program ed25519 (B2) |
| SIMD-0512 `sol_sha512` | active, epoch 1092 | in-program ed25519 (B2); the syscall resolved at deploy |
| SIMD-0186 and its fee-only amendment | active, epochs 978 and 1098 | V1 must request a loaded-data size (1 MiB used) |
| SIMD-0406, SIMD-0286 (100M CU block), SIMD-0525 (200 ms slots), SIMD-0083, SIMD-0437-2 (5,080 lamports/byte), SIMD-0152 strict ed25519 precompile, SIMD-0075, SIMD-0302, Poseidon | active | as briefed |
| SIMD-0268 (CPI depth 8), Alpenglow (SIMD-0326), tx account lock limit 128, loaded-data size in base fee | inactive | not relied on. The 64-account cap is binding |

Observed limit: the **instruction trace cap of 64**, which counts CPIs, is binding. A V1 transaction with 20 ATA creations
failed preflight with `MaxInstructionTraceLengthExceeded`, because each ATA create uses about 5 trace entries. A batch that
credits SPL accounts through CPI is therefore capped at about 60 CPIs, whatever its byte budget.

## 2. Measured results (devnet, ledger-read)

All fee values are `meta.fee`. The priority fee is 0 unless noted. Rent is listed where the approach creates accounts.

| Approach | Tx format | Payments per tx | Tx bytes | CU | Fee (lamports) | Fee per payment | Binding cap |
|---|---|---|---|---|---|---|---|
| A0 baseline, 1 `TransferChecked`, 1 signer | legacy | 1 | 279 | 105 | 5,000 | 5,000 | - |
| A0 x402 `exact` shape (fee payer + client + 2 compute budget ixs, 1 micro-lamport/CU) | legacy | 1 | 427 | 405 | 10,001 | 10,001 | - |
| A legacy multi-transfer | legacy | 20 | 1,210 | 2,100 | 5,000 | 250 | 1,232 B |
| A v0 + ALT multi-transfer | v0 | 57 | 1,230 | 5,985 | 5,000 | 87.7 | 1,232 B |
| **A V1 multi-transfer (fan-out)** | V1 | **60** | 3,242 | 6,300 | 5,000 | **83.3** | 64 addresses |
| A V1 fan-in, 11 client signers | V1 | 11 | 1,848 | 1,155 | 60,000 | 5,454.5 | 12 signatures |
| A V1 fan-in by SPL delegate (after `ApproveChecked`) | V1 | 60 | 3,242 | 6,720 | 5,000 | 83.3 | 64 addresses |
| B1 precompile vouchers, K=1 | V1 | 1 | 491 | 640 | **10,000** | 10,000 | - |
| B1 precompile vouchers, K=22 | V1 | 22 | 4,061 | 8,788 | **115,000** | 5,227 | 4,096 B |
| B2 in-program vouchers, paged ledger, K=1 | V1 | 1 | 326 | 8,970 | 5,000 | 5,000 | - |
| B2 in-program vouchers, paged ledger, K=8 | V1 | 8 | 858 | 70,793 | 5,000 | 625 | - |
| **B2 in-program vouchers, paged ledger, K=50** | V1 | **50** | 4,050 | 441,720 | 5,000 | **100** | 4,096 B |
| B2 in-program vouchers, one account per payer, K=35 | V1 | 35 | 4,032 | 309,729 | 5,000 | 142.9 | 4,096 B |
| C channel open (escrow account + fund) | V1 | - | 399 | 415 | 5,000 | - | rent 894,080, refunded |
| C channel close (1 cumulative voucher for N=1,000 payments + close) | V1 | 1,000 | 334 | 9,185 | 5,000 | **10** (open+close / N) | - |
| C batch close: 35 channels settled and closed in 1 tx | V1 | 35 | 4,074 | 311,942 | 5,000 | 142.9 per channel | 4,096 B |

**Setup costs.** These are one-time, measured, and reclaimable unless noted.
- **Recipient ATA:** 1,488,440 lamports of rent each (293 B × 5,080). This is about 300× a signature fee, so for a first payment to a new payee the rent dominates.
- **Program ledger slot:** 48 B, which is 243,840 lamports inside a page. An account of its own costs 894,080.
- **ALT with 62 entries:** about 11.0M lamports of rent, plus 3 transactions to create and extend it. A 512-slot deactivation cooldown applies before close.
- **`ApproveChecked` for the delegate lane:** 5,000 lamports per payer signature, one time.
- **Classic SPL mint:** 1,066,800 lamports. This rent cannot be reclaimed.

**Signature fee rule, confirmed on the ledger.** Each ed25519 precompile signature is charged `lamports_per_signature`:
- B1 with K=1: 10,000 = 2 × 5,000.
- B1 with K=22: 115,000 = 23 × 5,000.

**B2 is charged only for the transaction signature**, 5,000 lamports for any K.

**Correctness evidence** (`negative.json`, `ledger-check.json`):
- A tampered voucher fails B2 with custom error `0x103`.
- A replayed voucher fails B2 with `0x103`. The nonce is implicit, so the old signature does not verify.
- A tampered precompile entry fails B1 with precompile error 2.
- The merchant slot ended at 1,152,000 units. That equals the paged debits (82,000), plus the per-account debits (70 × 1,000), plus the channel close (1,000,000). Every nonce matched the count of settled vouchers.

**Unit costs** [M]:
- In-program ed25519 verification and debit/credit: **8,832 CU per voucher**, the slope from K=1 to K=8.
- B2 per-voucher wire size: **76 B** (refs 4, amount 8, signature 64). The nonce is implicit, and the message is rebuilt on-chain.
- `TransferChecked` (p-token): **105 CU** and **50 B** per payee in V1 (address 32, header 4, account indexes 4, data 10).
- Off-chain voucher signing (noble ed25519, JS, container): 0.27 ms each.

## 3. Reading the numbers

- **A (multi-transfer).** This is the cheapest lane in both lamports and CU, but only one authority signs, so it covers fan-out from a single payer.
  - V1 does not support ALTs, but V1 without an ALT (60 payments) beats v0 with an ALT (57) and needs no lookup-table rent or warm-up.
  - Fan-in from many payers is either:
    - **multi-signer:** 12-signature cap and per-signature fees, so 5,455 per payment, and every payer must co-sign the same blockhash; or
    - **delegate:** 83 per payment, but `ApproveChecked` gives the facilitator an unconditional pull up to the allowance. The payer authorizes no individual payment, which is a custodial trust model.
- **B1 (precompile).** The precompile keeps CU low (388 CU per voucher), but `lamports_per_signature` is charged per signature, so it saves nothing over one transaction per payment.
- **B2 (in-program).** This keeps per-payment payer authorization at A-level cost:
  - 100 lamports per payment against A-delegate's 83 is the measured cost of moving from "trust the facilitator's allowance" to "the program checks the payer's signature and nonce for every payment".
  - CU is the trade-off: 441,720 CU for 50 vouchers. Under a priority-fee rate of r micro-lamports per CU, add 0.44 × r lamports per batch, or 0.0088 × r per payment. At r = 10,000 that is +88 lamports per payment.
  - CU caps K near 150. Bytes cap it at 50 first.
- **C (channels).** The close is a single in-program voucher check (9,185 CU) followed by a refund of the escrow rent.
  - Per-payment cost falls as 10,000 / N.
  - Batch-closing 35 channels in one transaction cuts the close leg to 143 lamports per channel.
  - So a session of N payments costs about (5,000 + 143) / N lamports when closes are batched, and opens can be batched the same way.

## 4. Recommendation

**Adopt a three-lane settlement layer with one shared voucher format and one verifier.**

1. **Voucher.** Each voucher is ed25519, signed by the payer over
   `"DNX4BAT1" || payee_owner(32) || amount u64 || nonce u64` (56 B, spike format).
   - Production adds a quote binding and expiry to the signed message: SHA-256 of the x402 quote, as in V2_SPEC 11.1.
   - If the binding travels in full (32 B), B2 holds about 35 vouchers per transaction. A 16-byte truncated binding keeps about 41.
2. **Verifier.** A single program verifies vouchers in-program with `sol_sha512` plus the curve25519 MSM syscall, at about 8.8k CU each.
   - It never uses the ed25519 precompile.
   - Hardening needed before mainnet: small-order key rejection (strict verify) and a deposit/withdraw path with a withdrawal timelock, so a payer cannot race a pending voucher.
3. **Lane choice per payment.**
   - Repeat payer to payee (≥ 3 expected calls): **channel (C)**. Open with a deposit, sign cumulative vouchers off-chain, and let the payee close unilaterally before expiry; the payer refunds after expiry. The merchant batch-closes up to 35 channels per transaction.
   - One-off, many payers: **voucher batch (B2)** against a prepaid paged ledger, 50 vouchers per transaction, 100 lamports per payment.
   - Fan-out to payees that hold token accounts: **V1 multi-transfer (A-v1)**, 60 per transaction, 83 lamports per payment.
   - Real token movement out of the ledger (merchant withdrawal) is a single `TransferChecked` CPI per merchant per sweep, amortized across all of its payments.

Measured headline: against the x402 `exact` shape (10,001 lamports per payment),
- B2 is **100×** cheaper per payment, and
- a channel with 1,000 calls is **1,000×** cheaper.

Both settle in one atomic transaction per batch.

## 5. Mapping to x402 schemes and existing code

- **`dark-null-exact`.** One `transact` per payment. Each transaction is about 1.4 KB and about 135-185k CU, and creates 2 nullifier PDAs with 1,300,480 lamports of non-reclaimable rent (DESIGN_2027 sections 7 and 10).
  - A V1 transaction fits 2 transacts by bytes [E], so batching saves at most one signature fee per pair.
  - Nullifier rent dominates, so this scheme is not the high-frequency lane.
- **`dark-null-batch`.** This is lane C with the escrow held as a shielded channel note (DESIGN_2027 sections 5 and 6.3, V2_SPEC 11.2).
  - The public analogue measured here closes with one ed25519 voucher in 9,185 CU.
  - The shielded close proves the latest BabyJubJub voucher inside the Groth16 transact (81,282 CU verify [M], about 4-7k constraints for the one EdDSA [E]).
  - Batch-closing several channel notes in one V1 transaction is bounded by CU: about 150-185k per transact gives about 7 per transaction [E].
  - The lane-C batch-close pattern from this spike carries over: the merchant rolls or closes many channels in one transaction.
- **dna-x402 netting ledger** (`x402/src/nettingLedger.ts`, off by default and refused in production config).
  - Today it is an in-memory IOU: no escrow, no payer signature, no on-chain flush.
  - Replace its `flushReady` batch with a B2 settle transaction. Each accrued charge becomes a payer-signed voucher, and a flush becomes one transaction per 50 charges.
  - That removes the "unverified netting" gate's reason to exist.
- **dna-x402 `packages/session-channels`.** Today it opens and closes locally and settles one `exact` transfer plus a `receipt_anchor`, with no escrow.
  - Map `openSession` to a lane C open (escrow deposit), `recordAction` to a cumulative voucher, and `closeSession` to a lane C close.
  - Keep `receipt_anchor` as the receipt hash.
- **Dark NULL `programs/payment-stream`.** It holds SOL only, does not check secp256k1 tick signatures on-chain, and has no expiry path.
  - The in-program ed25519 verifier measured here (8.8k CU) is the missing check.
  - Add an expiry refund and SPL custody to make it the lane C program.
- **dna-x402 `streaming.ts`** (Streamflow) stays out of scope. It is a time-vesting stream, not per-call settlement.

## 6. D: ZK aggregation (paper estimate, not built)

Inputs:
- Groth16 verify: 81,282 CU [M], 256-byte proof.
- arkworks prover: 260 ms for 23,155 constraints and 433 ms for 40,914 constraints, on 4 vCPU, i.e. about 10.6 µs per constraint [M] (PHASE0_RESULTS).
- EdDSA-Poseidon over BabyJubJub: about 4-7k constraints per signature [E] (DESIGN_2027 section 5).

| N vouchers | Constraints [E] | Prover [E] | Prover memory [E] |
|---|---|---|---|
| 1 channel, latest voucher only (dark-null-batch close) | +4-7k on the transact circuit | +50-75 ms | small |
| 50 independent payers | 50 × (6k EdDSA + ~10k for two depth-20 Poseidon balance-tree updates) ≈ 0.8M | ~9 s | ~3.6 GB |
| 100 independent payers | ≈ 1.6M | ~17 s | ~7 GB (above the 8 GB VM) |

On-chain cost is one signature (5,000 lamports) plus about 81k CU for the verify, plus the public-input hash and state-root write, for any N.
Two cases:
- **Payees as ATAs or ledger slots.** Every payee is still a transaction address, so the 64-address cap applies and the result is no better than B2 (100 lamports per payment at 50) while adding seconds of proving.
- **Payees as notes in a commitment tree** (shielded payouts). Accounts stay O(1) and N is limited only by prover time.

So D fits in exactly one place: shielded payouts beyond about 50 per transaction, where privacy is required anyway. For public x402 settlement, B2 and C reach the same fee floor with no prover. Kill rule R-NULL in DESIGN_2027 still applies: claim `dark-null-batch` savings only at the N where gate B3 shows break-even.

## 7. Agave features this depends on

| Lane | Depends on |
|---|---|
| A-v1 | SIMD-0385 (V1: 4,096 B, 64 addresses, config-mask compute-unit limit), SIMD-0186 and its amendment (loaded-data request), SIMD-0266 (p-token, 105 CU transfers) |
| B2 | SIMD-0385, SIMD-0512 (`sol_sha512`), curve25519 syscalls with MSM length restriction, SIMD-0186, SIMD-0437-2 (rent of the 48 B ledger slots) |
| C | the same as B2. The batch close also relies on SIMD-0385 bytes |
| Throughput [E] | SIMD-0286 (100M CU per block): about 226 full B2 transactions, or 11k payments, per block by CU. SIMD-0525 (200 ms slots). SIMD-0083 lets conflicting settle transactions on one merchant page share an entry |
| Not used | ed25519 precompile (SIMD-0152) as the settlement verifier, ALTs (absent from V1), SIMD-0268, Alpenglow |

## 8. Reproduce

- **Program.** `spikes/x402-batch/program` has no dependencies and is built with `cargo-build-sbf` 4.1.0 / platform-tools v1.54, offline. Its scalar reduction is pinned by `scalar_vectors.in`.
- **Harness.** `spikes/x402-batch/bench.mjs` with `lib.mjs`, which holds the V1 serializer. They run in a throwaway `node:22-bookworm-slim` container with `@solana/web3.js@1` and `@solana/spl-token@0.4`, installed with `--ignore-scripts`.
- **Phases:** `setup`, `a`, `b-setup`, `b`, `c`, `cleanup-b`, `cleanup-a`, `alt-close`.
- **Lifecycle.** The devnet program `CyNw8DWqEmZuWvPQuXPtohS2zuVMGaCEfLMasXYBwgfd` was deployed for this run and closed afterwards, with 0.1317 SOL reclaimed.
- **Failed rows.** Rows in `results.jsonl` with `fee: null` were rejected at preflight and never landed: three 20-ATA batches hit the trace cap, and two ALT-close attempts came before the cooldown ended.
- **Run cost.** The payer went from 480,348,440 to 477,273,519 lamports, a net spend of 3,074,921 lamports (0.0031 SOL):
  - 1,066,800: classic mint rent, not reclaimable;
  - 833,120: kept by the closed program account;
  - the rest: transaction fees.
  All ATAs, ledger accounts, the ALT and the program data were closed, and the 60 child wallets end at 0 lamports.
